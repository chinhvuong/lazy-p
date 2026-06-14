import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  applyExtensionEvent,
  resetSessions,
  type MeetingSession,
} from '../src/session.js';

describe('applyExtensionEvent — WebSocket message handler', () => {
  let session: MeetingSession;

  beforeEach(() => {
    resetSessions();
    session = createSession();
  });

  it('appends transcript entries in order', () => {
    applyExtensionEvent(session, { type: 'transcript', speaker: 'Alice', text: 'Hello', timestamp: '10:00' });
    applyExtensionEvent(session, { type: 'transcript', speaker: 'Bob', text: 'Hi there', timestamp: '10:01' });

    expect(session.transcript).toHaveLength(2);
    expect(session.transcript[0]).toEqual({ speaker: 'Alice', text: 'Hello', timestamp: '10:00' });
    expect(session.transcript[1]).toEqual({ speaker: 'Bob', text: 'Hi there', timestamp: '10:01' });
  });

  it('appends chat messages in order', () => {
    applyExtensionEvent(session, { type: 'chat', sender: 'Carol', text: 'Can you share screen?', timestamp: '10:05' });

    expect(session.chatLog).toHaveLength(1);
    expect(session.chatLog[0]).toEqual({ sender: 'Carol', text: 'Can you share screen?', timestamp: '10:05' });
  });

  it('adds joining participants to both lists', () => {
    applyExtensionEvent(session, { type: 'participant', name: 'Alice', event: 'join' });
    applyExtensionEvent(session, { type: 'participant', name: 'Bob', event: 'join' });

    expect(session.participants).toEqual(['Alice', 'Bob']);
    expect(session.allParticipants).toEqual(['Alice', 'Bob']);
  });

  it('removes leaving participant from participants but keeps in allParticipants', () => {
    applyExtensionEvent(session, { type: 'participant', name: 'Alice', event: 'join' });
    applyExtensionEvent(session, { type: 'participant', name: 'Bob', event: 'join' });
    applyExtensionEvent(session, { type: 'participant', name: 'Alice', event: 'leave' });

    expect(session.participants).toEqual(['Bob']);
    expect(session.allParticipants).toEqual(['Alice', 'Bob']);
  });

  it('does not duplicate participants on repeated joins', () => {
    applyExtensionEvent(session, { type: 'participant', name: 'Alice', event: 'join' });
    applyExtensionEvent(session, { type: 'participant', name: 'Alice', event: 'join' });

    expect(session.participants).toHaveLength(1);
    expect(session.allParticipants).toHaveLength(1);
  });

  it('returns true for relay-able events and false for lifecycle events', () => {
    expect(applyExtensionEvent(session, { type: 'transcript', speaker: 'A', text: 'x', timestamp: 't' })).toBe(true);
    expect(applyExtensionEvent(session, { type: 'chat', sender: 'B', text: 'y', timestamp: 't' })).toBe(true);
    expect(applyExtensionEvent(session, { type: 'participant', name: 'C', event: 'join' })).toBe(true);
    expect(applyExtensionEvent(session, { type: 'capture_start' })).toBe(false);
    expect(applyExtensionEvent(session, { type: 'end_meeting' })).toBe(false);
  });

  it('accumulates a multi-event sequence into correct state', () => {
    const events = [
      { type: 'participant' as const, name: 'Alice', event: 'join' as const },
      { type: 'participant' as const, name: 'Bob', event: 'join' as const },
      { type: 'transcript' as const, speaker: 'Alice', text: 'Kick off the sprint', timestamp: '09:00' },
      { type: 'chat' as const, sender: 'Bob', text: 'Tasks in Jira?', timestamp: '09:01' },
      { type: 'transcript' as const, speaker: 'Bob', text: 'Who handles login?', timestamp: '09:02' },
      { type: 'participant' as const, name: 'Carol', event: 'join' as const },
      { type: 'participant' as const, name: 'Bob', event: 'leave' as const },
    ];

    for (const e of events) applyExtensionEvent(session, e);

    expect(session.transcript).toHaveLength(2);
    expect(session.chatLog).toHaveLength(1);
    expect(session.participants).toEqual(['Alice', 'Carol']);
    expect(session.allParticipants).toEqual(['Alice', 'Bob', 'Carol']);
  });
});
