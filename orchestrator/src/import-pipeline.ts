import { execSync, spawnSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { TranscriptEntry } from './session.js';
import type { MeetingStore } from './meeting-store.js';
import { writeMeetingMd } from './meeting-md.js';
import { NotebookLMExtractor } from './mcp-client.js';

export type ImportSource =
  | { type: 'text'; content: string }
  | { type: 'file'; filename: string; buffer: Buffer }
  | { type: 'audio'; filename: string; buffer: Buffer }
  | { type: 'video'; filename: string; buffer: Buffer };

export interface ImportOptions {
  date: string;
  title?: string;
  outputDir: string;
  store: MeetingStore;
  /** Full NotebookLM URL (e.g. https://notebooklm.google.com/notebook/<uuid>). */
  notebookUrl?: string;
  onProgress?: (message: string) => void;
}

export interface ImportResult {
  meetingId: string;
  meetingFilePath: string;
  recordingPath: string | null;
}

function parseVtt(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i].includes('-->')) {
      const startTime = lines[i].split('-->')[0].trim();
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].trim());
        i++;
      }
      if (textLines.length > 0) {
        const joined = textLines.join(' ');
        const speakerMatch = joined.match(/^([^:]+):\s+(.+)$/);
        if (speakerMatch) {
          entries.push({ speaker: speakerMatch[1].trim(), text: speakerMatch[2].trim(), timestamp: startTime });
        } else {
          entries.push({ speaker: 'Unknown', text: joined, timestamp: startTime });
        }
      }
    }
    i++;
  }
  return entries;
}

function parseSrt(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const blocks = content.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const startTime = lines[1]?.split(' --> ')[0]?.trim() ?? '';
    const textLines = lines.slice(2).join(' ');
    const speakerMatch = textLines.match(/^([^:]+):\s+(.+)$/);
    if (speakerMatch) {
      entries.push({ speaker: speakerMatch[1].trim(), text: speakerMatch[2].trim(), timestamp: startTime });
    } else {
      entries.push({ speaker: 'Unknown', text: textLines, timestamp: startTime });
    }
  }
  return entries;
}

// Convert M:SS or MM:SS inline timestamps to HH:MM:SS
function inlineTimestampToHms(ts: string): string {
  const [mStr, sStr] = ts.split(':');
  const totalSecs = parseInt(mStr) * 60 + parseInt(sStr);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Detects Google Meet caption export: inline timestamps like "0:10" or "1:22" without speaker labels
function isGoogleMeetInlineFormat(content: string): boolean {
  const inlineCount = (content.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length;
  const firstLine = content.trim().split('\n')[0] ?? '';
  const hasSpeakerLabel = /^[A-Z][^:]{0,40}:\s/.test(firstLine);
  return inlineCount >= 3 && !hasSpeakerLabel;
}

function parseGoogleMeetInline(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  // Split on inline timestamps like "0:10", "1:22", "10:08"
  const parts = content.split(/\b(\d{1,2}:\d{2})\b/);
  let currentTs = '';
  let buffer = '';

  for (const part of parts) {
    if (/^\d{1,2}:\d{2}$/.test(part)) {
      if (buffer.trim()) {
        entries.push({ speaker: 'Unknown', text: buffer.trim(), timestamp: inlineTimestampToHms(currentTs || '0:00') });
      }
      currentTs = part;
      buffer = '';
    } else {
      buffer += part;
    }
  }
  if (buffer.trim()) {
    entries.push({ speaker: 'Unknown', text: buffer.trim(), timestamp: inlineTimestampToHms(currentTs || '0:00') });
  }
  return entries.filter(e => e.text.length > 2);
}

function parsePlainText(content: string): TranscriptEntry[] {
  if (isGoogleMeetInlineFormat(content)) {
    return parseGoogleMeetInline(content);
  }
  return content
    .split('\n')
    .filter(l => l.trim())
    .map(line => {
      const speakerMatch = line.match(/^([^:\d][^:]{0,40}):\s+(.+)$/);
      if (speakerMatch) {
        return { speaker: speakerMatch[1].trim(), text: speakerMatch[2].trim(), timestamp: '' };
      }
      return { speaker: 'Unknown', text: line.trim(), timestamp: '' };
    });
}

function transcribeWithWhisper(audioPath: string, onProgress?: (msg: string) => void): string {
  const check = spawnSync('which', ['whisper'], { encoding: 'utf8' });
  if (check.status !== 0) {
    throw new Error(
      'Whisper is not installed. Run: pip install openai-whisper && brew install ffmpeg. ' +
      'See https://github.com/openai/whisper for setup instructions.'
    );
  }

  const tmpOut = mkdtempSync(join(tmpdir(), 'lazy-p-whisper-'));
  try {
    onProgress?.('Transcribing with Whisper (this may take a few minutes)…');
    execSync(`whisper "${audioPath}" --output_format vtt --output_dir "${tmpOut}"`, {
      stdio: 'pipe',
      timeout: 300_000,
    });

    const outFiles = readdirSync(tmpOut).filter(f => f.endsWith('.vtt'));
    if (outFiles.length === 0) throw new Error('Whisper produced no output.');

    return readFileSync(join(tmpOut, outFiles[0]), 'utf8');
  } finally {
    rmSync(tmpOut, { recursive: true });
  }
}

function extractAudioFromVideo(videoPath: string, audioDest: string, onProgress?: (msg: string) => void): void {
  const check = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (check.status !== 0) {
    throw new Error('ffmpeg is not installed. Run: brew install ffmpeg');
  }
  onProgress?.('Extracting audio from video…');
  execSync(`ffmpeg -i "${videoPath}" -vn -acodec mp3 -y "${audioDest}"`, {
    stdio: 'pipe',
    timeout: 120_000,
  });
}

export async function runImportPipeline(source: ImportSource, options: ImportOptions): Promise<ImportResult> {
  const { date, title, outputDir, store, notebookUrl, onProgress } = options;
  const id = uuidv4();

  let transcript: TranscriptEntry[];
  let recordingPath: string | null = null;

  if (source.type === 'text') {
    onProgress?.('Parsing transcript text…');
    transcript = parsePlainText(source.content);
  } else if (source.type === 'file') {
    onProgress?.('Parsing transcript file…');
    const content = source.buffer.toString('utf8');
    const lower = source.filename.toLowerCase();
    if (lower.endsWith('.vtt')) {
      transcript = parseVtt(content);
    } else if (lower.endsWith('.srt')) {
      transcript = parseSrt(content);
    } else {
      transcript = parsePlainText(content);
    }
  } else {
    // audio or video — save to outputDir permanently, then transcribe with Whisper
    const ext = extname(source.filename);
    const savedRecordingPath = join(outputDir, `RECORDING-${id}${ext}`);
    writeFileSync(savedRecordingPath, source.buffer);
    recordingPath = savedRecordingPath;

    let audioPath: string;
    const tmpDir = mkdtempSync(join(tmpdir(), 'lazy-p-import-'));
    try {
      if (source.type === 'video') {
        audioPath = join(tmpDir, `audio-${id}.mp3`);
        extractAudioFromVideo(savedRecordingPath, audioPath, onProgress);
      } else {
        audioPath = savedRecordingPath;
      }

      const vttContent = transcribeWithWhisper(audioPath, onProgress);
      transcript = parseVtt(vttContent).map(e => ({
        ...e,
        // Normalize VTT "HH:MM:SS.mmm" to "HH:MM:SS"
        timestamp: e.timestamp.split('.')[0],
      }));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }

  onProgress?.('Building meeting session…');

  const allParticipants = [...new Set(transcript.map(t => t.speaker).filter(s => s !== 'Unknown'))];
  const session = {
    id,
    startedAt: `${date}T00:00:00.000Z`,
    transcript,
    chatLog: [],
    participants: allParticipants,
    allParticipants,
    taskList: [] as string[],
    status: 'complete' as const,
  };

  // Attempt NotebookLM extraction — only if a notebook URL was provided (v2.x cannot create notebooks)
  const extractor = new NotebookLMExtractor();
  let notebookId: string | undefined;
  const transcriptText = transcript.map(t => `[${t.timestamp}] ${t.speaker}: ${t.text}`).join('\n');
  if (notebookUrl) {
    try {
      onProgress?.('Adding transcript to NotebookLM and extracting tasks…');
      session.taskList = await extractor.extractTasks(id, transcriptText, '', notebookUrl);
      notebookId = extractor.notebookId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onProgress?.(`Warning: NotebookLM task extraction failed (${msg}). Meeting Chat will still use the notebook for Q&A.`);
      notebookId = notebookUrl; // still link the notebook even if extraction failed
    }
  } else {
    onProgress?.('No NotebookLM URL provided — skipping task extraction. Meeting Chat unavailable.');
  }

  onProgress?.('Writing MEETING.md…');
  const meetingFilePath = writeMeetingMd(session, outputDir);

  store.saveMeeting({
    id,
    date,
    title,
    meetingFilePath,
    recordingPath: recordingPath ?? undefined,
    status: 'imported',
    startedAt: session.startedAt,
    participants: allParticipants,
    taskList: session.taskList,
  });

  if (notebookId) {
    store.saveNotebookId(id, notebookId);
  }

  onProgress?.('Import complete.');
  return { meetingId: id, meetingFilePath, recordingPath };
}

// Export parsers for testing
export { parsePlainText, parseVtt, parseSrt };
