import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { MeetingStore } from '../src/meeting-store.js';
import { createOrchestrator } from '../src/server.js';

// Mock the NotebookLM extractor so import tests don't start the real MCP server
vi.mock('../src/mcp-client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/mcp-client.js')>();
  return {
    ...original,
    NotebookLMExtractor: class {
      notebookId: string | undefined = undefined;
      async extractTasks() { return []; }
    },
  };
});

const PLAIN_TRANSCRIPT = `Alice: We need to implement the login feature.
Bob: I will handle the auth PR review.
Alice: Can you also update the docs?`;

describe('POST /api/meetings/import', () => {
  let tmpDir: string;
  let store: MeetingStore;
  let app: ReturnType<typeof createOrchestrator>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazy-p-import-endpoint-test-'));
    store = new MeetingStore(':memory:');
    app = createOrchestrator('/nonexistent-ui', tmpDir, store);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
    store.close();
  });

  it('returns 202 with a jobId for a plain text import', async () => {
    const res = await request(app)
      .post('/api/meetings/import')
      .send({ date: '2026-06-10', text: PLAIN_TRANSCRIPT });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });

  it('creates a MEETING.md file in OUTPUT_DIR after text import', async () => {
    await request(app)
      .post('/api/meetings/import')
      .send({ date: '2026-06-10', text: PLAIN_TRANSCRIPT });

    // Allow async runImportPipeline to complete
    await new Promise(r => setTimeout(r, 500));

    expect(existsSync(join(tmpDir, 'MEETING-2026-06-10.md'))).toBe(true);
  });

  it('creates a SQLite row after text import', async () => {
    await request(app)
      .post('/api/meetings/import')
      .send({ date: '2026-06-10', text: PLAIN_TRANSCRIPT });

    await new Promise(r => setTimeout(r, 200));

    const meetings = store.getAll();
    expect(meetings).toHaveLength(1);
    expect(meetings[0].date).toBe('2026-06-10');
    expect(meetings[0].status).toBe('imported');
  });

  it('returns 400 when date is missing', async () => {
    const res = await request(app)
      .post('/api/meetings/import')
      .send({ text: 'Alice: hello' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when neither text nor file is provided', async () => {
    const res = await request(app)
      .post('/api/meetings/import')
      .send({ date: '2026-06-10' });

    expect(res.status).toBe(400);
  });

  it('accepts a .vtt file upload', async () => {
    const vttContent = `WEBVTT

00:00:01.000 --> 00:00:03.000
Alice: We need to discuss the roadmap.

00:00:04.000 --> 00:00:06.000
Bob: Agreed.
`;
    const res = await request(app)
      .post('/api/meetings/import')
      .field('date', '2026-06-10')
      .attach('file', Buffer.from(vttContent), { filename: 'transcript.vtt', contentType: 'text/vtt' });

    expect(res.status).toBe(202);

    await new Promise(r => setTimeout(r, 200));
    expect(existsSync(join(tmpDir, 'MEETING-2026-06-10.md'))).toBe(true);
  });

  it('returns 422 for unsupported file type', async () => {
    const res = await request(app)
      .post('/api/meetings/import')
      .field('date', '2026-06-10')
      .attach('file', Buffer.from('data'), { filename: 'meeting.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
  });

  it('recording_path is null after text import', async () => {
    await request(app)
      .post('/api/meetings/import')
      .send({ date: '2026-06-10', text: PLAIN_TRANSCRIPT });

    await new Promise(r => setTimeout(r, 200));

    const meetings = store.getAll();
    expect(meetings).toHaveLength(1);
    expect(meetings[0].recording_path).toBeNull();
  });

  it('recording_path is null after transcript file import', async () => {
    const res = await request(app)
      .post('/api/meetings/import')
      .field('date', '2026-06-10')
      .attach('file', Buffer.from(PLAIN_TRANSCRIPT), { filename: 'transcript.txt', contentType: 'text/plain' });

    expect(res.status).toBe(202);
    await new Promise(r => setTimeout(r, 200));

    const meetings = store.getAll();
    expect(meetings).toHaveLength(1);
    expect(meetings[0].recording_path).toBeNull();
  });
});
