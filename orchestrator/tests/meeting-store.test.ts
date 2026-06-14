import { describe, it, expect, beforeEach } from 'vitest';
import { MeetingStore } from '../src/meeting-store.js';

function makeStore() {
  return new MeetingStore(':memory:');
}

describe('MeetingStore', () => {
  let store: MeetingStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('saves and retrieves a meeting', () => {
    store.saveMeeting({
      id: 'meeting-1',
      date: '2026-06-14',
      meetingFilePath: '/out/MEETING-2026-06-14.md',
      status: 'complete',
      startedAt: '2026-06-14T10:00:00.000Z',
      participants: ['Alice', 'Bob'],
      taskList: ['- Do the thing'],
    });

    const row = store.getById('meeting-1');
    expect(row).toBeDefined();
    expect(row!.date).toBe('2026-06-14');
    expect(row!.meeting_file_path).toBe('/out/MEETING-2026-06-14.md');
    expect(JSON.parse(row!.participants)).toEqual(['Alice', 'Bob']);
    expect(JSON.parse(row!.task_list)).toEqual(['- Do the thing']);
  });

  it('saves and retrieves notebook ID', () => {
    store.saveMeeting({
      id: 'meeting-2',
      date: '2026-06-14',
      meetingFilePath: '/out/MEETING-2026-06-14.md',
      status: 'complete',
      startedAt: '2026-06-14T10:00:00.000Z',
      participants: [],
      taskList: [],
    });

    store.saveNotebookId('meeting-2', 'notebook-abc');
    const row = store.getById('meeting-2');
    expect(row!.notebook_id).toBe('notebook-abc');
  });

  it('upserts by file path — second call returns same id', () => {
    const id1 = store.upsertByFilePath({
      date: '2026-06-14',
      meetingFilePath: '/out/MEETING-2026-06-14.md',
      participants: ['Alice'],
      taskList: [],
    });

    const id2 = store.upsertByFilePath({
      date: '2026-06-14',
      meetingFilePath: '/out/MEETING-2026-06-14.md',
      participants: ['Alice'],
      taskList: [],
    });

    expect(id1).toBe(id2);
    expect(store.getAll()).toHaveLength(1);
  });

  it('getAll returns meetings ordered by date descending', () => {
    store.saveMeeting({ id: 'a', date: '2026-06-10', meetingFilePath: '/a.md', status: 'complete', startedAt: '2026-06-10T10:00:00Z', participants: [], taskList: [] });
    store.saveMeeting({ id: 'b', date: '2026-06-14', meetingFilePath: '/b.md', status: 'complete', startedAt: '2026-06-14T10:00:00Z', participants: [], taskList: [] });
    store.saveMeeting({ id: 'c', date: '2026-06-12', meetingFilePath: '/c.md', status: 'complete', startedAt: '2026-06-12T10:00:00Z', participants: [], taskList: [] });

    const all = store.getAll();
    expect(all[0].id).toBe('b');
    expect(all[1].id).toBe('c');
    expect(all[2].id).toBe('a');
  });

  it('saves and retrieves chat messages in order', () => {
    store.saveMeeting({ id: 'meeting-3', date: '2026-06-14', meetingFilePath: '/c.md', status: 'complete', startedAt: '2026-06-14T10:00:00Z', participants: [], taskList: [] });

    store.addChatMessage('meeting-3', 'user', 'Who was responsible for the auth PR?');
    store.addChatMessage('meeting-3', 'assistant', 'Bob was responsible for reviewing the auth PR.');

    const msgs = store.getChatMessages('meeting-3');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].text).toBe('Who was responsible for the auth PR?');
    expect(msgs[1].role).toBe('assistant');
  });

  it('getByFilePath returns the correct meeting', () => {
    store.saveMeeting({ id: 'meeting-4', date: '2026-06-14', meetingFilePath: '/specific/path.md', status: 'imported', startedAt: '2026-06-14T00:00:00Z', participants: [], taskList: [] });
    const row = store.getByFilePath('/specific/path.md');
    expect(row!.id).toBe('meeting-4');
  });

  it('upserted meeting has status imported', () => {
    store.upsertByFilePath({ date: '2026-06-14', meetingFilePath: '/x.md', participants: [], taskList: [] });
    const row = store.getAll()[0];
    expect(row.status).toBe('imported');
  });

  it('recording_path is persisted and retrieved correctly', () => {
    store.saveMeeting({
      id: 'meeting-rec',
      date: '2026-06-14',
      meetingFilePath: '/out/MEETING-2026-06-14.md',
      recordingPath: '/out/RECORDING-meeting-rec.mp4',
      status: 'imported',
      startedAt: '2026-06-14T00:00:00Z',
      participants: [],
      taskList: [],
    });
    const row = store.getById('meeting-rec');
    expect(row!.recording_path).toBe('/out/RECORDING-meeting-rec.mp4');
  });

  it('recording_path is null for text-only meetings', () => {
    store.saveMeeting({
      id: 'meeting-text',
      date: '2026-06-14',
      meetingFilePath: '/out/MEETING-2026-06-14-text.md',
      status: 'imported',
      startedAt: '2026-06-14T00:00:00Z',
      participants: [],
      taskList: [],
    });
    const row = store.getById('meeting-text');
    expect(row!.recording_path).toBeNull();
  });

  it('upsertByFilePath persists recordingPath', () => {
    store.upsertByFilePath({
      date: '2026-06-14',
      meetingFilePath: '/out/MEETING-2026-06-14.md',
      recordingPath: '/out/RECORDING-abc.mp3',
      participants: [],
      taskList: [],
    });
    const row = store.getAll()[0];
    expect(row.recording_path).toBe('/out/RECORDING-abc.mp3');
  });
});
