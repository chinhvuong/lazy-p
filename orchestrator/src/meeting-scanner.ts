import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { MeetingStore } from './meeting-store.js';

function parseMeetingMd(content: string, filePath: string): {
  date: string;
  participants: string[];
  taskList: string[];
} {
  const dateFromPath = filePath.match(/MEETING-(\d{4}-\d{2}-\d{2})\.md$/)?.[1];
  const dateFromHeader = content.match(/^# Meeting — (\d{4}-\d{2}-\d{2})/m)?.[1];
  const date = dateFromHeader ?? dateFromPath ?? '1970-01-01';

  const participants: string[] = [];
  const participantsMatch = content.match(/## Participants\n\n([\s\S]*?)(?:\n## )/);
  if (participantsMatch && !participantsMatch[1].includes('_No participants')) {
    for (const line of participantsMatch[1].split('\n')) {
      const name = line.replace(/^- /, '').trim();
      if (name) participants.push(name);
    }
  }

  const taskList: string[] = [];
  const tasksMatch = content.match(/## Tasks\n\n([\s\S]*?)(?:\n## |$)/);
  if (tasksMatch && !tasksMatch[1].includes('_No tasks')) {
    for (const line of tasksMatch[1].split('\n')) {
      const task = line.trim();
      if (task) taskList.push(task);
    }
  }

  return { date, participants, taskList };
}

export function scanOutputDir(outputDir: string, store: MeetingStore): number {
  if (!existsSync(outputDir)) return 0;

  const files = readdirSync(outputDir).filter(f => /^MEETING-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  let count = 0;

  for (const file of files) {
    const filePath = join(outputDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const { date, participants, taskList } = parseMeetingMd(content, filePath);
      store.upsertByFilePath({ date, meetingFilePath: filePath, participants, taskList });
      count++;
    } catch {
      // skip unreadable files
    }
  }

  return count;
}
