import { writeFileSync } from 'fs';
import { join } from 'path';
import type { MeetingSession } from './session.js';

export function renderMeetingMd(session: MeetingSession): string {
  const date = session.startedAt.split('T')[0];

  const participantsSection =
    session.allParticipants.length > 0
      ? session.allParticipants.map(p => `- ${p}`).join('\n')
      : '_No participants recorded._';

  const chatSection =
    session.chatLog.length > 0
      ? session.chatLog.map(m => `**${m.sender}** (${m.timestamp}): ${m.text}`).join('\n\n')
      : '_No chat messages._';

  const transcriptSection =
    session.transcript.length > 0
      ? session.transcript.map(t => `**${t.speaker}** (${t.timestamp}): ${t.text}`).join('\n\n')
      : '_No transcript captured._';

  const tasksSection =
    session.taskList.length > 0
      ? session.taskList.join('\n')
      : '_No tasks extracted._';

  return [
    `# Meeting — ${date}`,
    '',
    `> Session ID: ${session.id}`,
    '',
    '## Participants',
    '',
    participantsSection,
    '',
    '## Chat Log',
    '',
    chatSection,
    '',
    '## Transcript',
    '',
    transcriptSection,
    '',
    '## Tasks',
    '',
    tasksSection,
    '',
  ].join('\n');
}

export function writeMeetingMd(session: MeetingSession, outputDir: string): string {
  const date = session.startedAt.split('T')[0];
  const filename = `MEETING-${date}.md`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, renderMeetingMd(session), 'utf8');
  return filepath;
}
