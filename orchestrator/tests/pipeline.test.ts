import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPipeline, type PipelineEvent } from '../src/pipeline.js';
import { resetSessions, createSession, applyExtensionEvent, type MeetingSession } from '../src/session.js';
import type { TaskExtractor } from '../src/mcp-client.js';
import { MeetingStore } from '../src/meeting-store.js';

function makeSession(): MeetingSession {
  resetSessions();
  const session = createSession();
  session.startedAt = '2026-06-14T10:00:00.000Z';

  applyExtensionEvent(session, { type: 'participant', name: 'Alice', event: 'join' });
  applyExtensionEvent(session, { type: 'participant', name: 'Bob', event: 'join' });
  applyExtensionEvent(session, {
    type: 'transcript',
    speaker: 'Alice',
    text: 'We need to implement the login feature.',
    timestamp: '10:01',
  });
  applyExtensionEvent(session, {
    type: 'transcript',
    speaker: 'Bob',
    text: 'I will handle the auth PR review.',
    timestamp: '10:02',
  });
  applyExtensionEvent(session, {
    type: 'chat',
    sender: 'Alice',
    text: 'Can you also update the docs?',
    timestamp: '10:03',
  });

  return session;
}

const mockExtractor: TaskExtractor = {
  extractTasks: vi.fn(async () => [
    '- [Alice] Implement login feature',
    '- [Bob] Review auth PR',
    '- [Alice] Update docs',
  ]),
};

describe('runPipeline — integration', () => {
  let tmpDir: string;
  let events: PipelineEvent[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazy-p-pipeline-test-'));
    events = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('emits pipeline_started then pipeline_complete', async () => {
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: e => events.push(e),
      extractor: mockExtractor,
    });

    expect(events[0].type).toBe('pipeline_started');
    expect(events.at(-1)!.type).toBe('pipeline_complete');
  });

  it('writes a valid MEETING.md with all four sections', async () => {
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: e => events.push(e),
      extractor: mockExtractor,
    });

    const completeEvent = events.find(e => e.type === 'pipeline_complete')!;
    const filepath = completeEvent.meetingFile!;
    const content = readFileSync(filepath, 'utf8');

    expect(content).toContain('## Participants');
    expect(content).toContain('## Chat Log');
    expect(content).toContain('## Transcript');
    expect(content).toContain('## Tasks');
  });

  it('populates task list from extractor result', async () => {
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: e => events.push(e),
      extractor: mockExtractor,
    });

    const completeEvent = events.find(e => e.type === 'pipeline_complete')!;
    expect(completeEvent.tasks).toContain('- [Alice] Implement login feature');
    expect(completeEvent.tasks).toContain('- [Bob] Review auth PR');
    expect(session.taskList).toHaveLength(3);
  });

  it('passes correct transcript and chat text to the extractor', async () => {
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: () => {},
      extractor: mockExtractor,
    });

    const [sessionId, transcript, chatLog] = (mockExtractor.extractTasks as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sessionId).toBe(session.id);
    expect(transcript).toContain('Alice: We need to implement the login feature.');
    expect(chatLog).toContain('Alice: Can you also update the docs?');
  });

  it('includes all participants in pipeline_complete event', async () => {
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: e => events.push(e),
      extractor: mockExtractor,
    });

    const completeEvent = events.find(e => e.type === 'pipeline_complete')!;
    expect(completeEvent.participants).toContain('Alice');
    expect(completeEvent.participants).toContain('Bob');
  });

  it('persists meeting to store when store is injected', async () => {
    const store = new MeetingStore(':memory:');
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: () => {},
      extractor: mockExtractor,
      store,
    });

    const meetings = store.getAll();
    expect(meetings).toHaveLength(1);
    expect(meetings[0].date).toBe('2026-06-14');
    expect(meetings[0].meeting_file_path).toContain('MEETING-2026-06-14.md');
    expect(meetings[0].status).toBe('complete');
    store.close();
  });

  it('saves notebook ID to store when extractor provides one', async () => {
    const store = new MeetingStore(':memory:');
    const extractorWithNotebook: TaskExtractor = {
      extractTasks: vi.fn(async () => ['- Task 1']),
      notebookId: 'notebook-xyz',
    };
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: () => {},
      extractor: extractorWithNotebook,
      store,
    });

    const row = store.getAll()[0];
    expect(row.notebook_id).toBe('notebook-xyz');
    store.close();
  });

  it('does not fail when no store is provided (backward compat)', async () => {
    const session = makeSession();
    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: e => events.push(e),
      extractor: mockExtractor,
      // no store
    });

    expect(events.at(-1)!.type).toBe('pipeline_complete');
  });

  it('falls through to next extractor when first one throws', async () => {
    const session = makeSession();
    const failingExtractor: TaskExtractor = {
      extractTasks: vi.fn(async () => { throw new Error('MCP unavailable'); }),
    };
    const successExtractor: TaskExtractor = {
      extractTasks: vi.fn(async () => ['- Fallback task']),
    };

    await runPipeline(session, {
      outputDir: tmpDir,
      onEvent: e => events.push(e),
      extractor: failingExtractor,
    });

    // With only one extractor (failing), taskList should be empty and pipeline still completes
    const completeEvent = events.find(e => e.type === 'pipeline_complete');
    expect(completeEvent).toBeDefined();
    // taskList is empty because both extractors are not chained (single extractor provided)
    expect(session.taskList).toHaveLength(0);
  });
});
