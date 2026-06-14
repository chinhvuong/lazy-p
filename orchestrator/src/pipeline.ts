import { execSync } from 'child_process';
import type { MeetingSession } from './session.js';
import { writeMeetingMd } from './meeting-md.js';
import { NotebookLMExtractor, ClaudeAPIExtractor, type TaskExtractor } from './mcp-client.js';

export interface PipelineEvent {
  type: 'pipeline_started' | 'pipeline_step' | 'pipeline_complete' | 'pipeline_error';
  step?: string;
  message?: string;
  tasks?: string[];
  participants?: string[];
  meetingFile?: string;
  error?: string;
}

export type PipelineEventCallback = (event: PipelineEvent) => void;

export interface PipelineOptions {
  outputDir?: string;
  onEvent?: PipelineEventCallback;
  /** Override the task extractor; defaults to NotebookLM → Claude API fallback chain. */
  extractor?: TaskExtractor;
}

export async function runPipeline(
  session: MeetingSession,
  options: PipelineOptions = {},
): Promise<void> {
  const { outputDir = process.cwd(), onEvent = () => {}, extractor } = options;

  const emit = (event: PipelineEvent) => onEvent(event);
  emit({ type: 'pipeline_started' });

  const transcriptText = session.transcript
    .map(t => `[${t.timestamp}] ${t.speaker}: ${t.text}`)
    .join('\n');

  const chatText = session.chatLog
    .map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`)
    .join('\n');

  // Extract tasks — try provided extractor or default chain
  emit({ type: 'pipeline_step', step: 'extract', message: 'Extracting tasks…' });

  const extractors: TaskExtractor[] = extractor
    ? [extractor]
    : [new NotebookLMExtractor(), new ClaudeAPIExtractor()];

  let taskList: string[] = [];
  for (const ex of extractors) {
    try {
      taskList = await ex.extractTasks(session.id, transcriptText, chatText);
      emit({ type: 'pipeline_step', step: 'extract', message: 'Task extraction complete.' });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'pipeline_step', step: 'extract', message: `Extractor failed (${msg}), trying fallback…` });
    }
  }

  session.taskList = taskList;

  // Write MEETING.md
  emit({ type: 'pipeline_step', step: 'write_md', message: 'Writing MEETING.md…' });
  let meetingFile: string;
  try {
    meetingFile = writeMeetingMd(session, outputDir);
    emit({ type: 'pipeline_step', step: 'write_md', message: `Written: ${meetingFile}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: 'pipeline_error', error: `Failed to write MEETING.md: ${msg}` });
    return;
  }

  // Open Claude Code
  emit({ type: 'pipeline_step', step: 'claude', message: 'Opening Claude Code…' });
  try {
    execSync(`claude "${meetingFile}"`, { stdio: 'ignore', timeout: 5000 });
  } catch {
    // Non-fatal — Claude Code may open asynchronously or not be installed
    emit({
      type: 'pipeline_step',
      step: 'claude',
      message: 'Note: could not auto-launch Claude Code (not installed or timed out). Open manually.',
    });
  }

  emit({
    type: 'pipeline_complete',
    tasks: taskList,
    participants: session.allParticipants,
    meetingFile,
  });
}
