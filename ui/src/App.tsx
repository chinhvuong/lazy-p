import { useEffect, useRef, useState, useCallback } from 'react';

interface TranscriptEntry { speaker: string; text: string; timestamp: string }
interface ChatMessage { sender: string; text: string; timestamp: string }

type AppStatus = 'idle' | 'capturing' | 'paused' | 'pipeline_running' | 'complete' | 'error';

interface AppState {
  status: AppStatus;
  sessionId: string | null;
  transcript: TranscriptEntry[];
  chatLog: ChatMessage[];
  participants: string[];
  taskList: string[];
  meetingFile: string | null;
  pipelineLog: string[];
}

const INITIAL: AppState = {
  status: 'idle',
  sessionId: null,
  transcript: [],
  chatLog: [],
  participants: [],
  taskList: [],
  meetingFile: null,
  pipelineLog: [],
};

const WS_URL = `ws://${window.location.host}?type=ui`;

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL);
  const wsRef = useRef<WebSocket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as Record<string, unknown>;

      setState(prev => {
        switch (event.type) {
          case 'session_state': {
            const s = event.session as AppState & { id: string };
            return { ...prev, ...s, sessionId: s.id, pipelineLog: [] };
          }
          case 'capture_started':
            return { ...prev, status: 'capturing', sessionId: event.sessionId as string };
          case 'transcript':
            return { ...prev, transcript: [...prev.transcript, event as unknown as TranscriptEntry] };
          case 'chat':
            return { ...prev, chatLog: [...prev.chatLog, event as unknown as ChatMessage] };
          case 'participant': {
            const name = event.name as string;
            const evt = event.event as 'join' | 'leave';
            return {
              ...prev,
              participants: evt === 'join'
                ? prev.participants.includes(name) ? prev.participants : [...prev.participants, name]
                : prev.participants.filter(p => p !== name),
            };
          }
          case 'pipeline_started':
            return { ...prev, status: 'pipeline_running', pipelineLog: ['Pipeline started…'] };
          case 'pipeline_step':
            return { ...prev, pipelineLog: [...prev.pipelineLog, event.message as string] };
          case 'pipeline_complete':
            return {
              ...prev,
              status: 'complete',
              taskList: (event.tasks as string[]) ?? [],
              meetingFile: (event.meetingFile as string) ?? null,
              pipelineLog: [...prev.pipelineLog, 'Done.'],
            };
          case 'pipeline_error':
            return {
              ...prev,
              status: 'error',
              pipelineLog: [...prev.pipelineLog, `Error: ${event.error as string}`],
            };
          default:
            return prev;
        }
      });
    };

    ws.onclose = () => {
      setTimeout(connect, 2000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.transcript.length]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.chatLog.length]);

  function endMeeting() {
    wsRef.current?.send(JSON.stringify({ type: 'end_meeting' }));
  }

  const canEnd = state.status === 'capturing' || state.status === 'paused';
  const showSummary = state.status === 'complete' || state.status === 'error';

  return (
    <>
      <header className="header">
        <h1>lazy-p</h1>
        <div className="header-right">
          <span className={`status-badge ${state.status}`}>{state.status.replace('_', ' ')}</span>
          <button className="btn-end" onClick={endMeeting} disabled={!canEnd}>
            End Meeting
          </button>
        </div>
      </header>

      {showSummary ? (
        <Summary state={state} />
      ) : (
        <LiveView state={state} transcriptEndRef={transcriptEndRef} chatEndRef={chatEndRef} />
      )}
    </>
  );
}

function LiveView({
  state,
  transcriptEndRef,
  chatEndRef,
}: {
  state: AppState;
  transcriptEndRef: React.RefObject<HTMLDivElement>;
  chatEndRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="layout">
      <div className="panel">
        <div className="panel-title">Participants ({state.participants.length})</div>
        <div className="panel-body">
          {state.participants.length === 0 ? (
            <p className="empty-state">Waiting for participants…</p>
          ) : (
            state.participants.map(p => (
              <div key={p} className="participant-item">{p}</div>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Transcript ({state.transcript.length})</div>
        <div className="panel-body">
          {state.transcript.length === 0 ? (
            <p className="empty-state">Transcript will appear when captions are active…</p>
          ) : (
            state.transcript.map((t, i) => (
              <div key={i} className="transcript-entry">
                <div className="speaker">{t.speaker}<span className="ts">{t.timestamp}</span></div>
                <div className="text">{t.text}</div>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Chat Log ({state.chatLog.length})</div>
        <div className="panel-body">
          {state.chatLog.length === 0 ? (
            <p className="empty-state">Chat messages will appear here…</p>
          ) : (
            state.chatLog.map((m, i) => (
              <div key={i} className="chat-message">
                <div className="sender">{m.sender}<span className="ts">{m.timestamp}</span></div>
                <div className="text">{m.text}</div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>
      </div>
    </div>
  );
}

function Summary({ state }: { state: AppState }) {
  return (
    <div className="summary">
      <div className="summary-header">
        <h2>Meeting complete</h2>
        <div className="meta">
          {state.sessionId && <span>Session {state.sessionId.slice(0, 8)}</span>}
        </div>
        {state.meetingFile && (
          <div className="meeting-file-path">MEETING.md → {state.meetingFile}</div>
        )}
      </div>

      <div className="summary-body">
        <div className="summary-section">
          <h3>Tasks ({state.taskList.length})</h3>
          {state.taskList.length === 0 ? (
            <p className="empty-state">No tasks extracted.</p>
          ) : (
            state.taskList.map((t, i) => (
              <div key={i} className="task-item">{t}</div>
            ))
          )}
        </div>
        <div className="summary-section">
          <h3>Participants ({state.participants.length})</h3>
          {state.participants.map(p => (
            <div key={p} className="participant-item">{p}</div>
          ))}
        </div>
      </div>

      {state.pipelineLog.length > 0 && (
        <div className="pipeline-log">
          {state.pipelineLog.map((line, i) => (
            <div key={i} className={`log-line${i === state.pipelineLog.length - 1 ? ' active' : ''}`}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
