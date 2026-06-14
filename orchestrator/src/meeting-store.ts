import Database from 'better-sqlite3';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

export type MeetingStatus = 'capturing' | 'pipeline_running' | 'complete' | 'error' | 'imported';

export interface MeetingRow {
  id: string;
  date: string;
  title: string | null;
  meeting_file_path: string;
  notebook_id: string | null;
  recording_path: string | null;
  status: MeetingStatus;
  started_at: string;
  participants: string; // JSON array
  task_list: string;   // JSON array
}

export interface ChatMessageRow {
  id: string;
  meeting_id: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
}

export class MeetingStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  static openInDir(outputDir: string): MeetingStore {
    return new MeetingStore(join(outputDir, 'meetings.db'));
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        title TEXT,
        meeting_file_path TEXT NOT NULL UNIQUE,
        notebook_id TEXT,
        recording_path TEXT,
        status TEXT NOT NULL DEFAULT 'complete',
        started_at TEXT NOT NULL,
        participants TEXT NOT NULL DEFAULT '[]',
        task_list TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id),
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    // Migration for databases created before recording_path was added
    try {
      this.db.exec(`ALTER TABLE meetings ADD COLUMN recording_path TEXT`);
    } catch {
      // Column already exists — no-op
    }
  }

  saveMeeting(data: {
    id: string;
    date: string;
    title?: string;
    meetingFilePath: string;
    recordingPath?: string;
    status: MeetingStatus;
    startedAt: string;
    participants: string[];
    taskList: string[];
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO meetings
        (id, date, title, meeting_file_path, recording_path, status, started_at, participants, task_list)
      VALUES
        (@id, @date, @title, @meeting_file_path, @recording_path, @status, @started_at, @participants, @task_list)
    `).run({
      id: data.id,
      date: data.date,
      title: data.title ?? null,
      meeting_file_path: data.meetingFilePath,
      recording_path: data.recordingPath ?? null,
      status: data.status,
      started_at: data.startedAt,
      participants: JSON.stringify(data.participants),
      task_list: JSON.stringify(data.taskList),
    });
  }

  saveNotebookId(meetingId: string, notebookId: string): void {
    this.db.prepare(`UPDATE meetings SET notebook_id = ? WHERE id = ?`).run(notebookId, meetingId);
  }

  upsertByFilePath(data: {
    date: string;
    meetingFilePath: string;
    title?: string;
    recordingPath?: string;
    participants: string[];
    taskList: string[];
  }): string {
    const existing = this.db
      .prepare(`SELECT id FROM meetings WHERE meeting_file_path = ?`)
      .get(data.meetingFilePath) as { id: string } | undefined;
    if (existing) return existing.id;

    const id = uuidv4();
    this.saveMeeting({
      id,
      date: data.date,
      title: data.title,
      meetingFilePath: data.meetingFilePath,
      recordingPath: data.recordingPath,
      status: 'imported',
      startedAt: `${data.date}T00:00:00.000Z`,
      participants: data.participants,
      taskList: data.taskList,
    });
    return id;
  }

  getAll(): MeetingRow[] {
    return this.db
      .prepare(`SELECT * FROM meetings ORDER BY date DESC, started_at DESC`)
      .all() as MeetingRow[];
  }

  getById(id: string): MeetingRow | undefined {
    return this.db
      .prepare(`SELECT * FROM meetings WHERE id = ?`)
      .get(id) as MeetingRow | undefined;
  }

  getByFilePath(filePath: string): MeetingRow | undefined {
    return this.db
      .prepare(`SELECT * FROM meetings WHERE meeting_file_path = ?`)
      .get(filePath) as MeetingRow | undefined;
  }

  getChatMessages(meetingId: string): ChatMessageRow[] {
    return this.db
      .prepare(`SELECT * FROM chat_messages WHERE meeting_id = ? ORDER BY created_at ASC`)
      .all(meetingId) as ChatMessageRow[];
  }

  addChatMessage(meetingId: string, role: 'user' | 'assistant', text: string): ChatMessageRow {
    const id = uuidv4();
    const created_at = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO chat_messages (id, meeting_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, meetingId, role, text, created_at);
    return { id, meeting_id: meetingId, role, text, created_at };
  }

  close(): void {
    this.db.close();
  }
}
