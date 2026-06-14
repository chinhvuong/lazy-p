import { describe, it, expect, beforeEach } from 'vitest';
import { extractCaption, extractChatMessage, extractParticipantName } from '../src/parser';

/**
 * DOM parser unit tests.
 * Uses HTML fixture strings that match the ARIA-based structure targeted by the content script.
 * No browser or Chrome APIs required — pure function tests with a DOM environment (happy-dom).
 */

function html(str: string): Element {
  const div = document.createElement('div');
  div.innerHTML = str.trim();
  return div.firstElementChild!;
}

// ─── Caption parser ───────────────────────────────────────────────────────────

describe('extractCaption', () => {
  it('extracts speaker (data-speaker-name) and text (data-caption-text)', () => {
    const el = html(`
      <div class="caption-item">
        <span data-speaker-name="Alice Johnson">Alice Johnson</span>
        <span data-caption-text="Let's start with the agenda.">Let's start with the agenda.</span>
      </div>
    `);
    expect(extractCaption(el)).toEqual({
      speaker: 'Alice Johnson',
      text: "Let's start with the agenda.",
    });
  });

  it('prefers data-speaker-name attribute over text content for speaker', () => {
    const el = html(`
      <div>
        <span data-speaker-name="Bob Smith">Bob</span>
        <span data-caption-text="Hello everyone">Hello everyone</span>
      </div>
    `);
    const result = extractCaption(el);
    expect(result?.speaker).toBe('Bob Smith');
  });

  it('falls back to data-message-text if data-caption-text is absent', () => {
    const el = html(`
      <div>
        <span data-speaker-name="Carol">Carol</span>
        <span data-message-text="Can you share screen?">Can you share screen?</span>
      </div>
    `);
    expect(extractCaption(el)?.text).toBe('Can you share screen?');
  });

  it('returns null when speaker element is missing', () => {
    const el = html(`
      <div>
        <span data-caption-text="No speaker here">No speaker here</span>
      </div>
    `);
    expect(extractCaption(el)).toBeNull();
  });

  it('returns null when text element is missing', () => {
    const el = html(`
      <div>
        <span data-speaker-name="Alice">Alice</span>
      </div>
    `);
    expect(extractCaption(el)).toBeNull();
  });

  it('returns null for an empty element', () => {
    const el = html('<div></div>');
    expect(extractCaption(el)).toBeNull();
  });

  it('extracts from the .speaker-name fallback class selector', () => {
    const el = html(`
      <div>
        <span class="speaker-name">Dave</span>
        <span class="caption-text">Sounds good to me.</span>
      </div>
    `);
    const result = extractCaption(el);
    expect(result?.speaker).toBe('Dave');
    expect(result?.text).toBe('Sounds good to me.');
  });
});

// ─── Chat parser ──────────────────────────────────────────────────────────────

describe('extractChatMessage', () => {
  it('extracts sender (data-sender-name), text (data-message-text), and timestamp', () => {
    const el = html(`
      <div class="chat-message">
        <span data-sender-name="Bob Smith">Bob Smith</span>
        <span data-message-time>10:15 AM</span>
        <span data-message-text="Can everyone see my screen?">Can everyone see my screen?</span>
      </div>
    `);
    const result = extractChatMessage(el);
    expect(result).not.toBeNull();
    expect(result!.sender).toBe('Bob Smith');
    expect(result!.text).toBe('Can everyone see my screen?');
    expect(result!.timestamp).toBe('10:15 AM');
  });

  it('uses the data-sender-name attribute over text content', () => {
    const el = html(`
      <div>
        <span data-sender-name="Carol Nguyen">C</span>
        <span data-message-text="LGTM">LGTM</span>
      </div>
    `);
    expect(extractChatMessage(el)?.sender).toBe('Carol Nguyen');
  });

  it('falls back to .sender-name and .message-text class selectors', () => {
    const el = html(`
      <div>
        <span class="sender-name">Eve</span>
        <span class="message-text">See you in 5.</span>
      </div>
    `);
    const result = extractChatMessage(el);
    expect(result?.sender).toBe('Eve');
    expect(result?.text).toBe('See you in 5.');
  });

  it('returns null when sender is missing', () => {
    const el = html(`
      <div>
        <span data-message-text="No sender here">No sender here</span>
      </div>
    `);
    expect(extractChatMessage(el)).toBeNull();
  });

  it('returns null when message text is missing', () => {
    const el = html(`
      <div>
        <span data-sender-name="Frank">Frank</span>
      </div>
    `);
    expect(extractChatMessage(el)).toBeNull();
  });

  it('provides a fallback timestamp when data-message-time is absent', () => {
    const el = html(`
      <div>
        <span data-sender-name="Grace">Grace</span>
        <span data-message-text="Be right back">Be right back</span>
      </div>
    `);
    const result = extractChatMessage(el);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBeTruthy();
  });
});

// ─── Participant parser ───────────────────────────────────────────────────────

describe('extractParticipantName', () => {
  it('extracts name from data-participant-name attribute', () => {
    const el = html(`
      <div class="participant-item">
        <span data-participant-name="Hank Pym">Hank Pym</span>
      </div>
    `);
    expect(extractParticipantName(el)).toBe('Hank Pym');
  });

  it('falls back to aria-label', () => {
    const el = html(`
      <div class="participant-item">
        <span aria-label="Ivy Chen (Host)">Ivy</span>
      </div>
    `);
    expect(extractParticipantName(el)).toBe('Ivy Chen (Host)');
  });

  it('falls back to .participant-name class', () => {
    const el = html(`
      <div>
        <span class="participant-name">Jack Ma</span>
      </div>
    `);
    expect(extractParticipantName(el)).toBe('Jack Ma');
  });

  it('returns null for an empty element', () => {
    const el = html('<div></div>');
    expect(extractParticipantName(el)).toBeNull();
  });
});
