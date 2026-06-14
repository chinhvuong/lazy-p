import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MeetingStore } from '../src/meeting-store.js';
import { scanOutputDir } from '../src/meeting-scanner.js';

const FIXTURE_MD = `# Meeting — 2026-06-10

> Session ID: aaaaaaaa-0000-0000-0000-000000000000

## Participants

- Alice
- Bob

## Chat Log

_No chat messages._

## Transcript

_No transcript captured._

## Tasks

- [Alice] Implement login feature
- [Bob] Review auth PR

`;

describe('scanOutputDir', () => {
  let tmpDir: string;
  let store: MeetingStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'lazy-p-scan-test-'));
    store = new MeetingStore(':memory:');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
    store.close();
  });

  it('discovers fixture MEETING.md files and upserts them', () => {
    writeFileSync(join(tmpDir, 'MEETING-2026-06-10.md'), FIXTURE_MD, 'utf8');
    writeFileSync(join(tmpDir, 'MEETING-2026-06-11.md'), FIXTURE_MD.replace('2026-06-10', '2026-06-11'), 'utf8');
    writeFileSync(join(tmpDir, 'MEETING-2026-06-12.md'), FIXTURE_MD.replace('2026-06-10', '2026-06-12'), 'utf8');

    const count = scanOutputDir(tmpDir, store);
    expect(count).toBe(3);
    expect(store.getAll()).toHaveLength(3);
  });

  it('does not duplicate meetings on a second scan', () => {
    writeFileSync(join(tmpDir, 'MEETING-2026-06-10.md'), FIXTURE_MD, 'utf8');

    scanOutputDir(tmpDir, store);
    scanOutputDir(tmpDir, store);

    expect(store.getAll()).toHaveLength(1);
  });

  it('parses participants from the MEETING.md file', () => {
    writeFileSync(join(tmpDir, 'MEETING-2026-06-10.md'), FIXTURE_MD, 'utf8');
    scanOutputDir(tmpDir, store);

    const row = store.getAll()[0];
    expect(JSON.parse(row.participants)).toEqual(['Alice', 'Bob']);
  });

  it('parses task list from the MEETING.md file', () => {
    writeFileSync(join(tmpDir, 'MEETING-2026-06-10.md'), FIXTURE_MD, 'utf8');
    scanOutputDir(tmpDir, store);

    const row = store.getAll()[0];
    expect(JSON.parse(row.task_list)).toEqual([
      '- [Alice] Implement login feature',
      '- [Bob] Review auth PR',
    ]);
  });

  it('ignores non-MEETING.md files', () => {
    writeFileSync(join(tmpDir, 'README.md'), '# Readme', 'utf8');
    writeFileSync(join(tmpDir, 'notes.txt'), 'notes', 'utf8');
    writeFileSync(join(tmpDir, 'MEETING-2026-06-10.md'), FIXTURE_MD, 'utf8');

    const count = scanOutputDir(tmpDir, store);
    expect(count).toBe(1);
  });

  it('returns 0 for an empty directory', () => {
    expect(scanOutputDir(tmpDir, store)).toBe(0);
    expect(store.getAll()).toHaveLength(0);
  });
});
