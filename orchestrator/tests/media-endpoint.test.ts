import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { MeetingStore } from '../src/meeting-store.js';
import { createOrchestrator } from '../src/server.js';

describe('GET /api/meetings/:id/media', () => {
  let tmpDir: string;
  let store: MeetingStore;
  let app: ReturnType<typeof createOrchestrator>;
  let recordingPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazy-p-media-test-'));
    store = new MeetingStore(':memory:');
    app = createOrchestrator('/nonexistent-ui', tmpDir, store);

    recordingPath = join(tmpDir, 'RECORDING-meeting-with-rec.mp4');
    writeFileSync(recordingPath, Buffer.from('fake-video-data'));

    store.saveMeeting({
      id: 'meeting-with-rec',
      date: '2026-06-10',
      meetingFilePath: join(tmpDir, 'MEETING-2026-06-10.md'),
      recordingPath,
      status: 'imported',
      startedAt: '2026-06-10T00:00:00Z',
      participants: [],
      taskList: [],
    });

    store.saveMeeting({
      id: 'meeting-no-rec',
      date: '2026-06-11',
      meetingFilePath: join(tmpDir, 'MEETING-2026-06-11.md'),
      status: 'imported',
      startedAt: '2026-06-11T00:00:00Z',
      participants: [],
      taskList: [],
    });

    store.saveMeeting({
      id: 'meeting-missing-file',
      date: '2026-06-12',
      meetingFilePath: join(tmpDir, 'MEETING-2026-06-12.md'),
      recordingPath: join(tmpDir, 'RECORDING-does-not-exist.mp4'),
      status: 'imported',
      startedAt: '2026-06-12T00:00:00Z',
      participants: [],
      taskList: [],
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
    store.close();
  });

  it('returns 200 with video/mp4 Content-Type when recording exists', async () => {
    const res = await request(app).get('/api/meetings/meeting-with-rec/media');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/video\/mp4/);
  });

  it('returns 404 when meeting has no recording_path', async () => {
    const res = await request(app).get('/api/meetings/meeting-no-rec/media');
    expect(res.status).toBe(404);
  });

  it('returns 404 when recording_path points to a missing file', async () => {
    const res = await request(app).get('/api/meetings/meeting-missing-file/media');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown meeting', async () => {
    const res = await request(app).get('/api/meetings/no-such-meeting/media');
    expect(res.status).toBe(404);
  });

  it('returns audio/mpeg Content-Type for mp3 recording', async () => {
    const mp3Path = join(tmpDir, 'RECORDING-mp3-meeting.mp3');
    writeFileSync(mp3Path, Buffer.from('fake-audio-data'));
    store.saveMeeting({
      id: 'meeting-mp3',
      date: '2026-06-13',
      meetingFilePath: join(tmpDir, 'MEETING-2026-06-13.md'),
      recordingPath: mp3Path,
      status: 'imported',
      startedAt: '2026-06-13T00:00:00Z',
      participants: [],
      taskList: [],
    });

    const res = await request(app).get('/api/meetings/meeting-mp3/media');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
  });
});
