import express from 'express';
import { createServer } from 'http';
import { join, extname } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'fs';
import multer from 'multer';
import type { MeetingSession } from './session.js';
import { ensureActiveSession, getSession, applyExtensionEvent, type ExtensionEvent } from './session.js';
import { runPipeline, type PipelineEvent } from './pipeline.js';
import type { MeetingStore } from './meeting-store.js';
import { MeetingChatHandler } from './meeting-chat.js';
import { runImportPipeline, type ImportSource } from './import-pipeline.js';

const uiClients = new Set<WebSocket>();

function broadcast(event: object): void {
  const msg = JSON.stringify(event);
  for (const ws of uiClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function sessionSnapshot(session: MeetingSession) {
  return {
    id: session.id,
    status: session.status,
    transcript: session.transcript,
    chatLog: session.chatLog,
    participants: session.participants,
    taskList: session.taskList,
  };
}

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

function parseMeetingRow(row: ReturnType<MeetingStore['getById']>) {
  if (!row) return null;
  return {
    ...row,
    participants: JSON.parse(row.participants) as string[],
    task_list: JSON.parse(row.task_list) as string[],
  };
}

async function triggerPipeline(
  sessionId: string,
  outputDir: string,
  store?: MeetingStore,
): Promise<void> {
  const session = getSession(sessionId);
  if (!session || session.status === 'pipeline_running') return;
  session.status = 'pipeline_running';

  await runPipeline(session, {
    outputDir,
    store,
    onEvent: (event: PipelineEvent) => {
      broadcast(event);
      if (event.type === 'pipeline_complete') {
        session.status = 'complete';
        broadcast({ type: 'meeting_saved' });
      }
      if (event.type === 'pipeline_error') session.status = 'error';
    },
  });
}

export function createOrchestrator(
  uiDistPath: string,
  outputDir: string = process.cwd(),
  store?: MeetingStore,
) {
  const app = express();
  app.use(express.json());

  const upload = multer({ storage: multer.memoryStorage() });

  // ── API routes (before static handler so they are not caught by the SPA catch-all) ──

  app.get('/api/meetings', (_req, res) => {
    if (!store) return res.json([]);
    const rows = store.getAll().map(row => parseMeetingRow(row));
    res.json(rows);
  });

  app.get('/api/meetings/:id', (req, res) => {
    if (!store) return res.status(503).json({ error: 'Store not initialised' });
    const row = store.getById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const meeting = parseMeetingRow(row)!;
    const chat = store.getChatMessages(req.params.id);
    res.json({ ...meeting, chat });
  });

  app.get('/api/meetings/:id/chat', (req, res) => {
    if (!store) return res.status(503).json({ error: 'Store not initialised' });
    const row = store.getById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(store.getChatMessages(req.params.id));
  });

  app.post('/api/meetings/:id/chat', async (req, res) => {
    if (!store) return res.status(503).json({ error: 'Store not initialised' });
    const { question } = req.body as { question?: string };
    if (!question?.trim()) return res.status(400).json({ error: 'question is required' });

    const row = store.getById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!row.notebook_id) {
      return res.status(422).json({
        error: 'No NotebookLM notebook for this meeting. Meeting Chat is unavailable.',
      });
    }

    try {
      const handler = new MeetingChatHandler(store);
      const answer = await handler.ask(req.params.id, question.trim());
      res.json({ answer });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/meetings/:id/media', (req, res) => {
    if (!store) return res.status(503).json({ error: 'Store not initialised' });
    const row = store.getById(req.params.id);
    if (!row || !row.recording_path) return res.status(404).json({ error: 'No recording for this meeting' });
    if (!existsSync(row.recording_path)) return res.status(404).json({ error: 'Recording file not found' });

    const ext = extname(row.recording_path).slice(1).toLowerCase();
    const contentType = MEDIA_CONTENT_TYPES[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(row.recording_path);
  });

  app.post(
    '/api/meetings/import',
    upload.single('file'),
    async (req, res) => {
      if (!store) return res.status(503).json({ error: 'Store not initialised' });

      const date = (req.body as Record<string, string>).date;
      const title = (req.body as Record<string, string>).title || undefined;
      const text = (req.body as Record<string, string>).text;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
      }

      let source: ImportSource;
      if (text) {
        source = { type: 'text', content: text };
      } else if (req.file) {
        const lower = req.file.originalname.toLowerCase();
        const audioExts = ['.mp3', '.m4a', '.wav', '.ogg', '.flac'];
        const videoExts = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];
        if (audioExts.some(e => lower.endsWith(e))) {
          source = { type: 'audio', filename: req.file.originalname, buffer: req.file.buffer };
        } else if (videoExts.some(e => lower.endsWith(e))) {
          source = { type: 'video', filename: req.file.originalname, buffer: req.file.buffer };
        } else if (['.txt', '.vtt', '.srt'].some(e => lower.endsWith(e))) {
          source = { type: 'file', filename: req.file.originalname, buffer: req.file.buffer };
        } else {
          return res.status(422).json({
            error: `Unsupported file type: ${req.file.originalname}. Supported: .txt, .vtt, .srt, audio files (mp3, m4a, wav), video files (mp4, mov, mkv).`,
          });
        }
      } else {
        return res.status(400).json({ error: 'Either text or file is required' });
      }

      // Return 202 immediately; progress comes via WebSocket
      const jobId = crypto.randomUUID();
      res.status(202).json({ jobId });

      try {
        const result = await runImportPipeline(source, {
          date,
          title,
          outputDir,
          store,
          onProgress: (msg) => broadcast({ type: 'import_progress', jobId, message: msg }),
        });
        broadcast({ type: 'import_complete', jobId, meetingId: result.meetingId });
        broadcast({ type: 'meeting_saved' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        broadcast({ type: 'import_error', jobId, error: message });
      }
    },
  );

  // ── Static UI (SPA catch-all after API routes) ──

  if (existsSync(uiDistPath)) {
    app.use(express.static(uiDistPath));
    app.get('*', (_req, res) => {
      res.sendFile(join(uiDistPath, 'index.html'));
    });
  }

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const clientType = url.searchParams.get('type') ?? 'ui';

    if (clientType === 'extension') {
      console.log('[orchestrator] Extension connected');

      ws.on('message', async (raw) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const session = ensureActiveSession();
        const typed = event as unknown as ExtensionEvent;

        if (typed.type === 'end_meeting') {
          await triggerPipeline(session.id, outputDir, store);
          return;
        }

        if (typed.type === 'capture_start') {
          broadcast({ type: 'capture_started', sessionId: session.id });
          return;
        }

        const shouldRelay = applyExtensionEvent(session, typed);
        if (shouldRelay) broadcast(event);
      });

      ws.on('close', () => console.log('[orchestrator] Extension disconnected'));
    } else {
      uiClients.add(ws);

      // Send full current state on connect so the UI can hydrate
      const session = ensureActiveSession();
      ws.send(JSON.stringify({ type: 'session_state', session: sessionSnapshot(session) }));

      ws.on('message', async (raw) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (event.type === 'end_meeting') {
          const s = ensureActiveSession();
          await triggerPipeline(s.id, outputDir, store);
        }
      });

      ws.on('close', () => uiClients.delete(ws));
    }
  });

  return httpServer;
}
