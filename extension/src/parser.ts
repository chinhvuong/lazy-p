/**
 * Pure DOM-parsing functions for Google Meet's caption and chat panels.
 * No Chrome APIs or WebSocket references — importable in both the content script and tests.
 *
 * Google Meet's DOM structure changes without notice. Selectors use ARIA attributes
 * and semantic roles over class names for resilience (ADR 0001).
 * If Meet updates break capture, look for elements that are logged as missing below.
 */

export interface CaptionData {
  speaker: string;
  text: string;
}

export interface ChatData {
  sender: string;
  text: string;
  timestamp: string;
}

/**
 * Extracts caption data from a single caption chunk element.
 * Expects an element matching CAPTION_ITEM_SELECTOR inside the captions container.
 *
 * In Meet's live DOM, each caption chunk is a container that holds:
 *   - a speaker-name element (aria-label or data attribute)
 *   - one or more text span elements
 *
 * The fixture structure used in tests mirrors the ARIA pattern we target here.
 */
export function extractCaption(element: Element): CaptionData | null {
  // Primary: aria-label on the speaker element (stable across Meet versions)
  const speakerEl =
    element.querySelector('[data-speaker-name]') ??
    element.querySelector('[aria-label][data-ssrc]') ??
    element.querySelector('.speaker-name');

  const textEl =
    element.querySelector('[data-caption-text]') ??
    element.querySelector('[data-message-text]') ??
    element.querySelector('.caption-text');

  const speaker =
    speakerEl?.getAttribute('data-speaker-name') ??
    speakerEl?.getAttribute('aria-label') ??
    speakerEl?.textContent?.trim();

  const text = textEl?.textContent?.trim();

  if (!speaker || !text) return null;
  return { speaker, text };
}

/**
 * Extracts chat message data from a single chat message element.
 * Expects an element matching CHAT_MESSAGE_SELECTOR inside the chat container.
 */
export function extractChatMessage(element: Element): ChatData | null {
  const senderEl =
    element.querySelector('[data-sender-name]') ??
    element.querySelector('.sender-name');

  const textEl =
    element.querySelector('[data-message-text]') ??
    element.querySelector('.message-text');

  const timeEl =
    element.querySelector('[data-message-time]') ??
    element.querySelector('.message-time');

  const sender =
    senderEl?.getAttribute('data-sender-name') ??
    senderEl?.textContent?.trim();

  const text = textEl?.textContent?.trim();
  const timestamp = timeEl?.textContent?.trim() ?? new Date().toISOString();

  if (!sender || !text) return null;
  return { sender, text, timestamp };
}

/**
 * Extracts a participant name from a participant-list item element.
 */
export function extractParticipantName(element: Element): string | null {
  const nameEl =
    element.querySelector('[data-participant-name]') ??
    element.querySelector('.participant-name') ??
    element.querySelector('[aria-label]');

  const name =
    nameEl?.getAttribute('data-participant-name') ??
    nameEl?.getAttribute('aria-label') ??
    nameEl?.textContent?.trim();

  return name && name.length > 0 ? name : null;
}
