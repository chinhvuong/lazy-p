import { v4 as uuidv4 } from 'uuid';

export interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: string;
}

export interface ChatMessage {
  sender: string;
  text: string;
  timestamp: string;
}

export type SessionStatus = 'capturing' | 'paused' | 'pipeline_running' | 'complete' | 'error';

export interface MeetingSession {
  id: string;
  startedAt: string;
  transcript: TranscriptEntry[];
  chatLog: ChatMessage[];
  /** Currently active participants (leaves remove them) */
  participants: string[];
  /** All participants who joined at any point */
  allParticipants: string[];
  taskList: string[];
  status: SessionStatus;
}

export type ExtensionEvent =
  | { type: 'transcript'; speaker: string; text: string; timestamp: string }
  | { type: 'chat'; sender: string; text: string; timestamp: string }
  | { type: 'participant'; name: string; event: 'join' | 'leave' }
  | { type: 'capture_start' }
  | { type: 'end_meeting' };

const sessions = new Map<string, MeetingSession>();
let activeSessionId: string | null = null;

export function createSession(): MeetingSession {
  const session: MeetingSession = {
    id: uuidv4(),
    startedAt: new Date().toISOString(),
    transcript: [],
    chatLog: [],
    participants: [],
    allParticipants: [],
    taskList: [],
    status: 'capturing',
  };
  sessions.set(session.id, session);
  activeSessionId = session.id;
  return session;
}

export function getSession(id: string): MeetingSession | undefined {
  return sessions.get(id);
}

export function getActiveSession(): MeetingSession | null {
  if (!activeSessionId) return null;
  return sessions.get(activeSessionId) ?? null;
}

export function ensureActiveSession(): MeetingSession {
  return getActiveSession() ?? createSession();
}

/** Apply a typed extension event to a session. Returns true if the event should be relayed to UI clients. */
export function applyExtensionEvent(session: MeetingSession, event: ExtensionEvent): boolean {
  switch (event.type) {
    case 'transcript':
      session.transcript.push({ speaker: event.speaker, text: event.text, timestamp: event.timestamp });
      return true;
    case 'chat':
      session.chatLog.push({ sender: event.sender, text: event.text, timestamp: event.timestamp });
      return true;
    case 'participant':
      if (event.event === 'join') {
        if (!session.participants.includes(event.name)) session.participants.push(event.name);
        if (!session.allParticipants.includes(event.name)) session.allParticipants.push(event.name);
      } else {
        session.participants = session.participants.filter(p => p !== event.name);
      }
      return true;
    case 'capture_start':
    case 'end_meeting':
      return false;
  }
}

export function resetSessions(): void {
  sessions.clear();
  activeSessionId = null;
}
