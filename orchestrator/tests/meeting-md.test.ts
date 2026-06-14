import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { renderMeetingMd, writeMeetingMd } from '../src/meeting-md.js';
import { resetSessions, createSession, applyExtensionEvent, type MeetingSession } from '../src/session.js';

function makeFixtureSession(): MeetingSession {
  resetSessions();
  const session = createSession();
  // Fix startedAt for deterministic date in output
  session.startedAt = '2026-06-14T09:00:00.000Z';

  applyExtensionEvent(session, { type: 'participant', name: 'Alice', event: 'join' });
  applyExtensionEvent(session, { type: 'participant', name: 'Bob', event: 'join' });
  applyExtensionEvent(session, { type: 'participant', name: 'Carol', event: 'join' });
  applyExtensionEvent(session, { type: 'transcript', speaker: 'Alice', text: 'Let\'s start.', timestamp: '09:00' });
  applyExtensionEvent(session, { type: 'transcript', speaker: 'Bob', text: 'Agreed.', timestamp: '09:01' });
  applyExtensionEvent(session, { type: 'chat', sender: 'Carol', text: 'Can you share the doc?', timestamp: '09:02' });
  session.taskList = ['- [Alice] Set up CI pipeline', '- [Bob] Review the auth PR'];

  return session;
}

describe('renderMeetingMd — MEETING.md content', () => {
  it('includes all four required sections', () => {
    const md = renderMeetingMd(makeFixtureSession());
    expect(md).toContain('## Participants');
    expect(md).toContain('## Chat Log');
    expect(md).toContain('## Transcript');
    expect(md).toContain('## Tasks');
  });

  it('lists all participants', () => {
    const md = renderMeetingMd(makeFixtureSession());
    expect(md).toContain('- Alice');
    expect(md).toContain('- Bob');
    expect(md).toContain('- Carol');
  });

  it('includes transcript entries with speaker and timestamp', () => {
    const md = renderMeetingMd(makeFixtureSession());
    expect(md).toContain('**Alice** (09:00): Let\'s start.');
    expect(md).toContain('**Bob** (09:01): Agreed.');
  });

  it('includes chat log entries with sender and timestamp', () => {
    const md = renderMeetingMd(makeFixtureSession());
    expect(md).toContain('**Carol** (09:02): Can you share the doc?');
  });

  it('includes the task list', () => {
    const md = renderMeetingMd(makeFixtureSession());
    expect(md).toContain('- [Alice] Set up CI pipeline');
    expect(md).toContain('- [Bob] Review the auth PR');
  });

  it('includes the meeting date in the heading', () => {
    const md = renderMeetingMd(makeFixtureSession());
    expect(md).toContain('# Meeting — 2026-06-14');
  });

  it('includes the session ID', () => {
    const session = makeFixtureSession();
    const md = renderMeetingMd(session);
    expect(md).toContain(session.id);
  });

  it('shows placeholder text for empty sections', () => {
    resetSessions();
    const empty = createSession();
    empty.startedAt = '2026-06-14T09:00:00.000Z';
    const md = renderMeetingMd(empty);
    expect(md).toContain('_No participants recorded._');
    expect(md).toContain('_No chat messages._');
    expect(md).toContain('_No transcript captured._');
    expect(md).toContain('_No tasks extracted._');
  });
});

describe('writeMeetingMd — file output', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazy-p-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('writes MEETING-YYYY-MM-DD.md to the output directory', () => {
    const session = makeFixtureSession();
    const filepath = writeMeetingMd(session, tmpDir);

    expect(filepath).toContain('MEETING-2026-06-14.md');
    const content = readFileSync(filepath, 'utf8');
    expect(content).toContain('## Participants');
    expect(content).toContain('## Tasks');
  });
});
