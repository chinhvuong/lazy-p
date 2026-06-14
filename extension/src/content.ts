/**
 * Content script — runs on https://meet.google.com/*
 *
 * Responsibilities:
 *  1. Detect when we are inside an active Meet call (not just the lobby).
 *  2. Auto-enable live captions if not already on.
 *  3. Observe the captions container and chat panel via MutationObserver.
 *  4. Stream typed events to the Orchestrator over WebSocket at ws://localhost:3000.
 *  5. Handle reconnect if the WebSocket drops (browser refresh, network hiccup).
 */

import { extractCaption, extractChatMessage } from './parser.js';

// ─── Orchestrator WebSocket ───────────────────────────────────────────────────

const ORCHESTRATOR_WS = 'ws://localhost:3000?type=extension';
const RECONNECT_DELAY_MS = 3000;

let ws: WebSocket | null = null;
let sessionId: string | null = null;
let capturing = false;
let paused = false;

function connect() {
  ws = new WebSocket(ORCHESTRATOR_WS);

  ws.onopen = () => {
    // Restore session ID from session storage so reconnects continue the same session
    sessionId = sessionStorage.getItem('lazy-p-session-id');
    send({ type: 'capture_start', sessionId });
    updateBadge('recording');
  };

  ws.onclose = () => {
    ws = null;
    updateBadge('disconnected');
    setTimeout(connect, RECONNECT_DELAY_MS);
  };

  ws.onerror = () => ws?.close();
}

function send(event: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

// ─── Chrome message listener (from popup) ────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: { type: string }) => {
  switch (msg.type) {
    case 'end_meeting':
      send({ type: 'end_meeting' });
      capturing = false;
      updateBadge('idle');
      break;
    case 'pause_capture':
      paused = true;
      updateBadge('paused');
      break;
    case 'resume_capture':
      paused = false;
      updateBadge('recording');
      break;
    case 'get_status':
      chrome.runtime.sendMessage({
        type: 'status_update',
        capturing,
        paused,
        transcriptCount,
        chatCount,
        participantCount,
      });
      break;
  }
});

function updateBadge(state: 'recording' | 'paused' | 'idle' | 'disconnected') {
  chrome.runtime.sendMessage({ type: 'badge_update', state });
}

// ─── Auto-enable captions ─────────────────────────────────────────────────────

const CAPTIONS_BUTTON_SELECTORS = [
  '[data-is-muted="false"][aria-label*="aption"]',
  'button[aria-label*="Turn on captions"]',
  'button[aria-label*="captions"]',
  '[jsname="r8qRAd"]',
];

function tryEnableCaptions() {
  for (const sel of CAPTIONS_BUTTON_SELECTORS) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn) {
      btn.click();
      console.log('[lazy-p] Captions enabled via selector:', sel);
      return true;
    }
  }
  return false;
}

// ─── Caption observation ──────────────────────────────────────────────────────

const CAPTIONS_CONTAINER_SELECTORS = [
  '[jsname="tgaKEf"]',
  '[aria-live="polite"][data-message-text]',
  '.a4cQT',
  '[data-caption-container]',
];

let transcriptCount = 0;
let captionObserver: MutationObserver | null = null;
const seenCaptions = new Set<string>();

function observeCaptions(container: Element) {
  if (captionObserver) return;
  captionObserver = new MutationObserver(() => {
    if (paused) return;
    // Each mutation may add or update caption chunk elements
    const items = container.querySelectorAll('[data-speaker-name], .caption-item, span[jsname]');
    items.forEach(item => {
      const data = extractCaption(item);
      if (!data) return;
      const key = `${data.speaker}|${data.text}`;
      if (seenCaptions.has(key)) return;
      seenCaptions.add(key);
      transcriptCount++;
      send({
        type: 'transcript',
        speaker: data.speaker,
        text: data.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    });
  });
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
  console.log('[lazy-p] Observing captions container');
}

// ─── Chat observation ─────────────────────────────────────────────────────────

const CHAT_CONTAINER_SELECTORS = [
  '[jsname="xySENc"]',
  '[data-chat-container]',
  '.z38b6',
];

let chatCount = 0;
let chatObserver: MutationObserver | null = null;
const seenMessages = new Set<string>();

function observeChat(container: Element) {
  if (chatObserver) return;
  chatObserver = new MutationObserver((mutations) => {
    if (paused) return;
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        const data = extractChatMessage(node);
        if (!data) return;
        const key = `${data.sender}|${data.text}`;
        if (seenMessages.has(key)) return;
        seenMessages.add(key);
        chatCount++;
        send({
          type: 'chat',
          sender: data.sender,
          text: data.text,
          timestamp: data.timestamp,
        });
      });
    });
  });
  chatObserver.observe(container, { childList: true, subtree: true });
  console.log('[lazy-p] Observing chat container');
}

// ─── Participant observation ──────────────────────────────────────────────────

const PARTICIPANT_CONTAINER_SELECTORS = [
  '[data-participant-list]',
  '[jsname="jdgltd"]',
  '.participants-list',
];

let participantCount = 0;
let participantObserver: MutationObserver | null = null;
const currentParticipants = new Set<string>();

function observeParticipants(container: Element) {
  if (participantObserver) return;

  function syncParticipants() {
    const items = container.querySelectorAll('[data-participant-name], [data-participant-item], .participant-item');
    const nowPresent = new Set<string>();
    items.forEach(item => {
      const name =
        item.getAttribute('data-participant-name') ??
        item.querySelector('[data-participant-name]')?.getAttribute('data-participant-name') ??
        item.textContent?.trim();
      if (name) nowPresent.add(name);
    });

    for (const name of nowPresent) {
      if (!currentParticipants.has(name)) {
        currentParticipants.add(name);
        participantCount = currentParticipants.size;
        send({ type: 'participant', name, event: 'join' });
      }
    }
    for (const name of currentParticipants) {
      if (!nowPresent.has(name)) {
        currentParticipants.delete(name);
        participantCount = currentParticipants.size;
        send({ type: 'participant', name, event: 'leave' });
      }
    }
  }

  participantObserver = new MutationObserver(syncParticipants);
  participantObserver.observe(container, { childList: true, subtree: true });
  syncParticipants();
  console.log('[lazy-p] Observing participant list');
}

// ─── DOM scanner — finds Meet UI containers ───────────────────────────────────

function scanDOM() {
  if (!capturing) return;

  // Try to enable captions on each scan until they appear
  tryEnableCaptions();

  for (const sel of CAPTIONS_CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) { observeCaptions(el); break; }
  }

  for (const sel of CHAT_CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) { observeChat(el); break; }
  }

  for (const sel of PARTICIPANT_CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) { observeParticipants(el); break; }
  }

  // Log a warning if none of the expected containers are found — helps diagnose Meet DOM changes
  if (!captionObserver) console.warn('[lazy-p] Captions container not found. Meet DOM may have changed.');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

function isMeetCall(): boolean {
  // Meet call URLs are /abc-defg-hij — at least 8 path characters after the slash
  return /^\/[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/i.test(window.location.pathname);
}

if (isMeetCall()) {
  capturing = true;
  connect();

  // Initial DOM scan
  scanDOM();

  // Re-scan periodically — Meet loads containers lazily after joining
  const scanInterval = setInterval(() => {
    if (!capturing) { clearInterval(scanInterval); return; }
    scanDOM();
  }, 2000);
}
