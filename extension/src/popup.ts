/**
 * Popup script — rendered when the user clicks the extension icon.
 * Communicates with the active tab's content script via chrome.tabs.sendMessage.
 */

const statusBadge = document.getElementById('status-badge')!;
const btnEnd = document.getElementById('btn-end') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const openUi = document.getElementById('open-ui')!;
const countTranscript = document.getElementById('count-transcript')!;
const countChat = document.getElementById('count-chat')!;
const countParticipants = document.getElementById('count-participants')!;

function setStatus(state: 'idle' | 'recording' | 'paused' | 'pipeline') {
  statusBadge.className = `status ${state}`;
  statusBadge.textContent =
    state === 'recording' ? '● Recording'
    : state === 'paused' ? '⏸ Paused'
    : state === 'pipeline' ? '⟳ Processing'
    : 'Idle';

  btnEnd.disabled = state === 'idle' || state === 'pipeline';
  btnPause.disabled = state === 'idle' || state === 'pipeline';
  btnPause.textContent = state === 'paused' ? 'Resume Capture' : 'Pause Capture';
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function sendToContent(msg: { type: string }) {
  const tab = await getActiveTab();
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch {
      // Content script may not be loaded on this tab
    }
  }
}

btnEnd.addEventListener('click', async () => {
  await sendToContent({ type: 'end_meeting' });
  setStatus('pipeline');
});

btnPause.addEventListener('click', async () => {
  const isPaused = btnPause.textContent?.includes('Resume');
  await sendToContent({ type: isPaused ? 'resume_capture' : 'pause_capture' });
  setStatus(isPaused ? 'recording' : 'paused');
});

openUi.addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:3000' });
});

// Request current status from the content script
async function refreshStatus() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url?.includes('meet.google.com')) {
    setStatus('idle');
    return;
  }

  chrome.runtime.onMessage.addListener(function handler(msg: {
    type: string;
    capturing?: boolean;
    paused?: boolean;
    transcriptCount?: number;
    chatCount?: number;
    participantCount?: number;
  }) {
    if (msg.type !== 'status_update') return;
    chrome.runtime.onMessage.removeListener(handler);

    countTranscript.textContent = String(msg.transcriptCount ?? 0);
    countChat.textContent = String(msg.chatCount ?? 0);
    countParticipants.textContent = String(msg.participantCount ?? 0);

    if (msg.capturing && msg.paused) setStatus('paused');
    else if (msg.capturing) setStatus('recording');
    else setStatus('idle');
  });

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'get_status' });
  } catch {
    setStatus('idle');
  }
}

refreshStatus();
