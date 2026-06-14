/**
 * Background service worker — handles badge updates and cross-tab coordination.
 */

const BADGE_COLORS: Record<string, string> = {
  recording: '#4caf50',
  paused: '#ffc107',
  idle: '#888888',
  disconnected: '#f44336',
};

const BADGE_TEXT: Record<string, string> = {
  recording: '●',
  paused: '⏸',
  idle: '',
  disconnected: '!',
};

chrome.runtime.onMessage.addListener((msg: { type: string; state?: string }) => {
  if (msg.type === 'badge_update' && msg.state) {
    const color = BADGE_COLORS[msg.state] ?? '#888888';
    const text = BADGE_TEXT[msg.state] ?? '';

    chrome.action.setBadgeBackgroundColor({ color });
    chrome.action.setBadgeText({ text });
  }
});
