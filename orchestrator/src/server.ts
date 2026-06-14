import express from 'express';
import { createServer } from 'http';
import { join } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'fs';
import type { MeetingSession } from './session.js';
import { ensureActiveSession, getSession, applyExtensionEvent, type ExtensionEvent } from './session.js';
import { runPipeline, type PipelineEvent } from './pipeline.js';

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

async function triggerPipeline(
  sessionId: string,
  outputDir: string,
): Promise<void> {
  const session = getSession(sessionId);
  if (!session || session.status === 'pipeline_running') return;
  session.status = 'pipeline_running';

  await runPipeline(session, {
    outputDir,
    onEvent: (event: PipelineEvent) => {
      broadcast(event);
      if (event.type === 'pipeline_complete') session.status = 'complete';
      if (event.type === 'pipeline_error') session.status = 'error';
    },
  });
}

export function createOrchestrator(uiDistPath: string, outputDir: string = process.cwd()) {
  const app = express();
  app.use(express.json());

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
          await triggerPipeline(session.id, outputDir);
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
          await triggerPipeline(s.id, outputDir);
        }
      });

      ws.on('close', () => uiClients.delete(ws));
    }
  });

  return httpServer;
}
