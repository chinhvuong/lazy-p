import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';

interface TranscriptEntry { speaker: string; text: string; timestamp: string }
interface ChatMessage { sender: string; text: string; timestamp: string }
interface ChatMessageRow { id: string; meeting_id: string; role: 'user' | 'assistant'; text: string; created_at: string }

type AppStatus = 'idle' | 'capturing' | 'paused' | 'pipeline_running' | 'complete' | 'error';

interface LiveState {
  status: AppStatus;
  sessionId: string | null;
  transcript: TranscriptEntry[];
  chatLog: ChatMessage[];
  participants: string[];
  taskList: string[];
  meetingFile: string | null;
  pipelineLog: string[];
}

interface MeetingListItem {
  id: string;
  date: string;
  title: string | null;
  status: string;
  participants: string[];
  task_list: string[];
  started_at: string;
}

interface MeetingDetail extends MeetingListItem {
  meeting_file_path: string;
  notebook_id: string | null;
  recording_path: string | null;
  chat: ChatMessageRow[];
}

type View = 'loading' | 'onboarding' | 'archive' | 'live' | 'detail' | 'import';

const LIVE_INITIAL: LiveState = {
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
  const [live, setLive] = useState<LiveState>(LIVE_INITIAL);
  const [view, setView] = useState<View>('loading');
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<string[]>([]);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings');
      if (res.ok) setMeetings(await res.json());
    } catch {}
  }, []);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setView('detail');
    try {
      const res = await fetch(`/api/meetings/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as Record<string, unknown>;

      if (event.type === 'notebooklm_authenticated') {
        setView('archive');
        setOnboardingError(null);
      }

      if (event.type === 'notebooklm_auth_error') {
        setOnboardingError(event.error as string);
      }

      if (event.type === 'meeting_saved' || event.type === 'import_complete') {
        fetchMeetings();
      }

      if (event.type === 'import_progress') {
        setImportProgress(prev => [...prev, event.message as string]);
      }

      if (event.type === 'import_complete') {
        setImportProgress(prev => [...prev, 'Import complete.']);
        setTimeout(() => {
          setView('archive');
          setImportProgress([]);
        }, 1500);
      }

      if (event.type === 'import_error') {
        setImportProgress(prev => [...prev, `Error: ${event.error as string}`]);
      }

      setLive(prev => {
        switch (event.type) {
          case 'session_state': {
            const s = event.session as LiveState & { id: string };
            return { ...prev, ...s, sessionId: s.id, pipelineLog: [] };
          }
          case 'capture_started':
            setView('live');
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
            setView('archive');
            return {
              ...prev,
              status: 'complete',
              taskList: (event.tasks as string[]) ?? [],
              meetingFile: (event.meetingFile as string) ?? null,
              pipelineLog: [...prev.pipelineLog, 'Done.'],
            };
          case 'pipeline_error':
            setView('archive');
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

    ws.onclose = () => setTimeout(connect, 2000);
  }, [fetchMeetings]);

  useEffect(() => {
    connect();
    fetchMeetings();

    fetch('/api/health/notebooklm')
      .then(r => r.json())
      .then((data: { authenticated: boolean }) => setView(data.authenticated ? 'archive' : 'onboarding'))
      .catch(() => setView('onboarding'));

    return () => wsRef.current?.close();
  }, [connect, fetchMeetings]);

  function endMeeting() {
    wsRef.current?.send(JSON.stringify({ type: 'end_meeting' }));
  }

  const isLive = live.status === 'capturing' || live.status === 'paused' || live.status === 'pipeline_running';

  return (
    <>
      <header className="header">
        <div className="header-left">
          <h1 className="logo" onClick={() => setView('archive')} style={{ cursor: 'pointer' }}>lazy-p</h1>
          {view === 'detail' && detail && (
            <button className="btn-back" onClick={() => setView('archive')}>← Archive</button>
          )}
          {view === 'import' && (
            <button className="btn-back" onClick={() => { setView('archive'); setImportProgress([]); }}>← Archive</button>
          )}
        </div>
        <div className="header-right">
          {isLive && <span className={`status-badge ${live.status}`}>{live.status.replace('_', ' ')}</span>}
          {view === 'archive' && (
            <button className="btn-import" onClick={() => setView('import')}>Import Meeting</button>
          )}
          {isLive && view !== 'onboarding' && view !== 'loading' && (
            <button className="btn-end" onClick={endMeeting} disabled={live.status === 'pipeline_running'}>
              End Meeting
            </button>
          )}
        </div>
      </header>

      {view === 'loading' && <div className="onboarding"><div className="onboarding-card onboarding-loading">Connecting…</div></div>}
      {view === 'onboarding' && (
        <OnboardingView
          error={onboardingError}
          onConnecting={() => setOnboardingError(null)}
        />
      )}
      {view === 'live' && (
        <LiveView live={live} onEndMeeting={endMeeting} />
      )}
      {view === 'archive' && (
        <ArchiveView
          meetings={meetings}
          liveSession={isLive ? live : null}
          onOpenMeeting={openDetail}
          onGoLive={() => setView('live')}
        />
      )}
      {view === 'detail' && (
        <DetailView
          meeting={detail}
          loading={detailLoading}
          onBack={() => setView('archive')}
          onChatSent={(updated) => setDetail(updated)}
        />
      )}
      {view === 'import' && (
        <ImportView
          progress={importProgress}
          onImport={(formData) => {
            setImportProgress(['Starting import…']);
            fetch('/api/meetings/import', { method: 'POST', body: formData })
              .then(res => {
                if (!res.ok) return res.json().then(d => { throw new Error(d.error); });
              })
              .catch(err => setImportProgress(prev => [...prev, `Error: ${err.message}`]));
          }}
          onCancel={() => { setView('archive'); setImportProgress([]); }}
        />
      )}
    </>
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function OnboardingView({ error, onConnecting }: { error: string | null; onConnecting: () => void }) {
  const [status, setStatus] = useState<'idle' | 'connecting'>('idle');

  async function startAuth() {
    setStatus('connecting');
    onConnecting();
    // Server responds with 202 immediately; auth happens in background.
    // WS will broadcast notebooklm_authenticated / notebooklm_auth_error when done.
    await fetch('/api/auth/notebooklm', { method: 'POST' }).catch(() => {});
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-logo">lazy-p</div>
        <h2>Connect NotebookLM</h2>
        <p>lazy-p uses NotebookLM to answer questions about your meetings. A browser window will open for you to sign in with Google.</p>
        {error && <div className="onboarding-error">{error}</div>}
        {status === 'connecting' && !error && (
          <p className="onboarding-hint">Browser is open — sign in with Google. This screen updates automatically when done.</p>
        )}
        <button
          className="btn-connect"
          onClick={startAuth}
          disabled={status === 'connecting' && !error}
        >
          {status === 'connecting' && !error ? 'Waiting for sign-in…' : 'Connect to NotebookLM'}
        </button>
      </div>
    </div>
  );
}

// ── Archive (Meetings List) ────────────────────────────────────────────────────

function ArchiveView({
  meetings,
  liveSession,
  onOpenMeeting,
  onGoLive,
}: {
  meetings: MeetingListItem[];
  liveSession: LiveState | null;
  onOpenMeeting: (id: string) => void;
  onGoLive: () => void;
}) {
  return (
    <div className="archive">
      {liveSession && (
        <div className="archive-item archive-item--live" onClick={onGoLive}>
          <div className="archive-item-date">Live now</div>
          <div className="archive-item-title">
            <span className={`status-badge ${liveSession.status}`}>{liveSession.status.replace('_', ' ')}</span>
          </div>
          <div className="archive-item-meta">{liveSession.participants.length} participant(s)</div>
        </div>
      )}

      {meetings.length === 0 && !liveSession && (
        <div className="archive-empty">
          <p>No meetings yet.</p>
          <p>Start a Google Meet with the Chrome extension or import a past meeting.</p>
        </div>
      )}

      {meetings.map(m => (
        <div key={m.id} className="archive-item" onClick={() => onOpenMeeting(m.id)}>
          <div className="archive-item-date">{m.date}</div>
          <div className="archive-item-title">{m.title ?? 'Meeting'}</div>
          <div className="archive-item-meta">
            {m.participants.length} participant(s) · {m.task_list.length} task(s)
            <span className={`status-badge status-badge--small ${m.status}`}>{m.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Live Capture View ─────────────────────────────────────────────────────────

function LiveView({ live, onEndMeeting }: { live: LiveState; onEndMeeting: () => void }) {
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [live.transcript.length]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [live.chatLog.length]);

  const canEnd = live.status === 'capturing' || live.status === 'paused';

  if (live.status === 'pipeline_running' || live.status === 'complete' || live.status === 'error') {
    return (
      <div className="summary">
        <div className="summary-header">
          <h2>{live.status === 'pipeline_running' ? 'Running pipeline…' : 'Pipeline complete'}</h2>
          {live.meetingFile && <div className="meeting-file-path">MEETING.md → {live.meetingFile}</div>}
        </div>
        {live.pipelineLog.length > 0 && (
          <div className="pipeline-log">
            {live.pipelineLog.map((line, i) => (
              <div key={i} className={`log-line${i === live.pipelineLog.length - 1 ? ' active' : ''}`}>{line}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="layout">
      <div className="panel">
        <div className="panel-title">Participants ({live.participants.length})</div>
        <div className="panel-body">
          {live.participants.length === 0
            ? <p className="empty-state">Waiting for participants…</p>
            : live.participants.map(p => <div key={p} className="participant-item">{p}</div>)
          }
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Transcript ({live.transcript.length})</div>
        <div className="panel-body">
          {live.transcript.length === 0
            ? <p className="empty-state">Transcript will appear when captions are active…</p>
            : live.transcript.map((t, i) => (
              <div key={i} className="transcript-entry">
                <div className="speaker">{t.speaker}<span className="ts">{t.timestamp}</span></div>
                <div className="text">{t.text}</div>
              </div>
            ))
          }
          <div ref={transcriptEndRef} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Chat Log ({live.chatLog.length})</div>
        <div className="panel-body">
          {live.chatLog.length === 0
            ? <p className="empty-state">Chat messages will appear here…</p>
            : live.chatLog.map((m, i) => (
              <div key={i} className="chat-message">
                <div className="sender">{m.sender}<span className="ts">{m.timestamp}</span></div>
                <div className="text">{m.text}</div>
              </div>
            ))
          }
          <div ref={chatEndRef} />
        </div>
      </div>
    </div>
  );
}

// ── Timestamp Reference renderer ──────────────────────────────────────────────

function TimestampText({ text, onTimestampClick }: { text: string; onTimestampClick?: (s: number) => void }) {
  const parts = text.split(/(\[\d{2}:\d{2}:\d{2}\])/);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d{2}):(\d{2}):(\d{2})\]$/);
        if (match && onTimestampClick) {
          const seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
          return (
            <button key={i} className="timestamp-ref" onClick={() => onTimestampClick(seconds)}>
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function AssistantMessage({ text, onTimestampClick }: { text: string; onTimestampClick?: (s: number) => void }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        components={{
          // Render text nodes through TimestampText so [HH:MM:SS] patterns become buttons
          p: ({ children }) => (
            <p>
              {React.Children.map(children, child =>
                typeof child === 'string'
                  ? <TimestampText key={child} text={child} onTimestampClick={onTimestampClick} />
                  : child
              )}
            </p>
          ),
          li: ({ children }) => (
            <li>
              {React.Children.map(children, child =>
                typeof child === 'string'
                  ? <TimestampText key={child} text={child} onTimestampClick={onTimestampClick} />
                  : child
              )}
            </li>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ── Meeting Detail View ───────────────────────────────────────────────────────

function DetailView({
  meeting,
  loading,
  onBack,
  onChatSent,
}: {
  meeting: MeetingDetail | null;
  loading: boolean;
  onBack: () => void;
  onChatSent: (updated: MeetingDetail) => void;
}) {
  const [tab, setTab] = useState<'transcript' | 'chat-log' | 'tasks' | 'chat'>('tasks');
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => { setMediaError(false); }, [meeting?.id]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [meeting?.chat.length]);

  async function sendChat() {
    if (!meeting || !chatInput.trim() || chatSending) return;
    const question = chatInput.trim();
    setChatInput('');
    setChatSending(true);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (res.ok) {
        const updated = {
          ...meeting,
          chat: [
            ...meeting.chat,
            { id: 'u-' + Date.now(), meeting_id: meeting.id, role: 'user' as const, text: question, created_at: new Date().toISOString() },
            { ...data.answer },
          ],
        };
        onChatSent(updated);
      }
    } finally {
      setChatSending(false);
    }
  }

  function seekPlayer(seconds: number) {
    if (mediaRef.current) mediaRef.current.currentTime = seconds;
  }

  const hasRecording = !!meeting?.recording_path;

  if (loading) return <div className="detail-loading">Loading…</div>;
  if (!meeting) return <div className="detail-loading">Meeting not found.</div>;

  const tabs = ['tasks', 'transcript', 'chat-log', 'chat'] as const;

  return (
    <div className="detail">
      <div className="detail-header">
        <h2>{meeting.title ?? `Meeting — ${meeting.date}`}</h2>
        <div className="detail-meta">
          {meeting.date} · {meeting.participants.length} participant(s) · {meeting.task_list.length} task(s)
          <span className={`status-badge status-badge--small ${meeting.status}`}>{meeting.status}</span>
        </div>
        {meeting.meeting_file_path && (
          <div className="meeting-file-path">{meeting.meeting_file_path}</div>
        )}
      </div>

      {hasRecording && (
        <div className="media-player">
          {mediaError ? (
            <div className="media-not-found">Recording not found — the file may have been moved or deleted.</div>
          ) : (
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={`/api/meetings/${meeting.id}/media`}
              controls
              className="media-element"
              onError={() => setMediaError(true)}
            />
          )}
        </div>
      )}

      <div className="detail-tabs">
        {tabs.map(t => (
          <button
            key={t}
            className={`tab-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'chat' ? 'Meeting Chat' : t === 'chat-log' ? 'Chat Log' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="detail-body">
        {tab === 'tasks' && (
          <div className="detail-section">
            {meeting.task_list.length === 0
              ? <p className="empty-state">No tasks extracted.</p>
              : meeting.task_list.map((t, i) => <div key={i} className="task-item">{t}</div>)
            }
          </div>
        )}

        {tab === 'transcript' && (
          <div className="detail-section">
            {meeting.chat.length === 0 && <p className="empty-state">No transcript in archive.</p>}
          </div>
        )}

        {tab === 'chat-log' && (
          <div className="detail-section">
            <p className="empty-state">Chat log stored in MEETING.md on disk.</p>
          </div>
        )}

        {tab === 'chat' && (
          <div className="meeting-chat">
            <div className="meeting-chat-messages">
              {meeting.chat.length === 0 && (
                <p className="empty-state">
                  {meeting.notebook_id
                    ? 'Ask a question about this meeting.'
                    : 'Meeting Chat is unavailable — no NotebookLM notebook was created for this meeting.'}
                </p>
              )}
              {meeting.chat.map((msg) => (
                <div key={msg.id} className={`chat-bubble chat-bubble--${msg.role}`}>
                  <div className="chat-bubble-role">{msg.role === 'user' ? 'You' : 'NotebookLM'}</div>
                  <div className="chat-bubble-text">
                    {msg.role === 'assistant'
                      ? <AssistantMessage text={msg.text} onTimestampClick={hasRecording ? seekPlayer : undefined} />
                      : msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="meeting-chat-input">
              <input
                type="text"
                className="chat-input-field"
                placeholder={meeting.notebook_id ? 'Ask about this meeting…' : 'No notebook available'}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                disabled={!meeting.notebook_id || chatSending}
              />
              <button
                className="btn-send"
                onClick={sendChat}
                disabled={!meeting.notebook_id || !chatInput.trim() || chatSending}
              >
                {chatSending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Import Modal ──────────────────────────────────────────────────────────────

function ImportView({
  progress,
  onImport,
  onCancel,
}: {
  progress: string[];
  onImport: (formData: FormData) => void;
  onCancel: () => void;
}) {
  const [sourceType, setSourceType] = useState<'text' | 'file'>('text');
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [notebookUrl, setNotebookUrl] = useState('');

  const isRunning = progress.length > 0;

  function submit() {
    const fd = new FormData();
    fd.append('date', date);
    if (title) fd.append('title', title);
    if (notebookUrl.trim()) fd.append('notebookUrl', notebookUrl.trim());
    if (sourceType === 'text') {
      fd.append('text', text);
    } else if (file) {
      fd.append('file', file);
    }
    onImport(fd);
  }

  const canSubmit = !!date && !isRunning && (sourceType === 'text' ? !!text.trim() : !!file);

  return (
    <div className="import-view">
      <div className="import-card">
        <h2>Import Past Meeting</h2>

        <div className="form-group">
          <label>Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={isRunning}
          />
        </div>

        <div className="form-group">
          <label>Title (optional)</label>
          <input
            type="text"
            placeholder="e.g. Q2 Planning"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={isRunning}
          />
        </div>

        <div className="form-group">
          <label>NotebookLM URL <span className="optional">(optional)</span></label>
          <input
            type="url"
            placeholder="https://notebooklm.google.com/notebook/..."
            value={notebookUrl}
            onChange={e => setNotebookUrl(e.target.value)}
            disabled={isRunning}
          />
          <p className="hint">Create a notebook at notebooklm.google.com and paste its URL to enable Meeting Chat and task extraction.</p>
        </div>

        <div className="form-group">
          <label>Source</label>
          <div className="source-tabs">
            <button
              className={`source-tab${sourceType === 'text' ? ' active' : ''}`}
              onClick={() => setSourceType('text')}
              disabled={isRunning}
            >
              Paste Text
            </button>
            <button
              className={`source-tab${sourceType === 'file' ? ' active' : ''}`}
              onClick={() => setSourceType('file')}
              disabled={isRunning}
            >
              Upload File
            </button>
          </div>
        </div>

        {sourceType === 'text' && (
          <div className="form-group">
            <label>Transcript</label>
            <textarea
              className="transcript-paste"
              placeholder={'Alice: We discussed the roadmap.\nBob: I will handle the backend.'}
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={isRunning}
            />
          </div>
        )}

        {sourceType === 'file' && (
          <div className="form-group">
            <label>File (.txt, .vtt, .srt, .mp3, .m4a, .wav, .mp4, .mov)</label>
            <input
              type="file"
              accept=".txt,.vtt,.srt,.mp3,.m4a,.wav,.ogg,.flac,.mp4,.mov,.mkv,.webm,.avi"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              disabled={isRunning}
            />
            {file && <div className="file-name">{file.name}</div>}
            {sourceType === 'file' && !file && (
              <p className="hint">Audio/video files are transcribed locally via Whisper. Requires: pip install openai-whisper && brew install ffmpeg</p>
            )}
          </div>
        )}

        {progress.length > 0 && (
          <div className="import-progress">
            {progress.map((line, i) => (
              <div key={i} className={`log-line${i === progress.length - 1 ? ' active' : ''}`}>{line}</div>
            ))}
          </div>
        )}

        <div className="import-actions">
          <button className="btn-cancel" onClick={onCancel} disabled={isRunning && !progress.at(-1)?.includes('complete')}>
            Cancel
          </button>
          <button className="btn-import-submit" onClick={submit} disabled={!canSubmit}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
