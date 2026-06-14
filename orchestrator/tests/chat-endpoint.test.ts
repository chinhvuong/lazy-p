import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { MeetingStore } from '../src/meeting-store.js';
import { createOrchestrator } from '../src/server.js';

// Mock the MeetingChatHandler to avoid hitting the real NotebookLM MCP server
vi.mock('../src/meeting-chat.js', () => ({
  MeetingChatHandler: class {
    constructor(_store: MeetingStore) {}
    async ask(_meetingId: string, _question: string) {
      return {
        id: 'msg-answer',
        meeting_id: _meetingId,
        role: 'assistant' as const,
        text: 'Bob was responsible for reviewing the auth PR.',
        created_at: new Date().toISOString(),
      };
    }
  },
}));

describe('POST /api/meetings/:id/chat', () => {
  let tmpDir: string;
  let store: MeetingStore;
  let app: ReturnType<typeof createOrchestrator>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazy-p-chat-test-'));
    store = new MeetingStore(':memory:');
    app = createOrchestrator('/nonexistent-ui', tmpDir, store);

    // Seed a meeting with a notebook ID
    store.saveMeeting({
      id: 'meeting-with-notebook',
      date: '2026-06-10',
      meetingFilePath: join(tmpDir, 'MEETING-2026-06-10.md'),
      status: 'complete',
      startedAt: '2026-06-10T10:00:00Z',
      participants: ['Alice', 'Bob'],
      taskList: ['- [Bob] Review auth PR'],
    });
    store.saveNotebookId('meeting-with-notebook', 'notebook-abc123');

    // Seed a meeting without a notebook ID
    store.saveMeeting({
      id: 'meeting-no-notebook',
      date: '2026-06-11',
      meetingFilePath: join(tmpDir, 'MEETING-2026-06-11.md'),
      status: 'imported',
      startedAt: '2026-06-11T10:00:00Z',
      participants: [],
      taskList: [],
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
    store.close();
  });

  it('returns answer for a valid question', async () => {
    const res = await request(app)
      .post('/api/meetings/meeting-with-notebook/chat')
      .send({ question: 'Who was responsible for the auth PR?' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('answer');
    expect(res.body.answer.text).toContain('Bob');
  });

  it('returns 404 for unknown meeting', async () => {
    const res = await request(app)
      .post('/api/meetings/no-such-meeting/chat')
      .send({ question: 'Hello?' });

    expect(res.status).toBe(404);
  });

  it('returns 422 when meeting has no notebook', async () => {
    const res = await request(app)
      .post('/api/meetings/meeting-no-notebook/chat')
      .send({ question: 'What was discussed?' });

    expect(res.status).toBe(422);
  });

  it('returns 400 when question is empty', async () => {
    const res = await request(app)
      .post('/api/meetings/meeting-with-notebook/chat')
      .send({ question: '   ' });

    expect(res.status).toBe(400);
  });

  it('GET /api/meetings/:id/chat returns chat history', async () => {
    store.addChatMessage('meeting-with-notebook', 'user', 'Who was responsible?');
    store.addChatMessage('meeting-with-notebook', 'assistant', 'Bob.');

    const res = await request(app).get('/api/meetings/meeting-with-notebook/chat');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].role).toBe('user');
    expect(res.body[1].role).toBe('assistant');
  });
});
