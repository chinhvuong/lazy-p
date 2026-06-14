# ADR 0004: SQLite for Meeting Archive Persistence

## Status
Accepted

## Context
Adding a Meeting Archive requires persisting Meeting Sessions across Orchestrator restarts. The system needed to store: meeting metadata (date, title), the path to each MEETING.md file, the NotebookLM notebook ID (to reuse the existing notebook for Meeting Chat), and Meeting Chat history per session.

## Decision
Use SQLite (via `better-sqlite3`) as the persistence layer.

## Alternatives Considered
- **Flat files only** — scan OUTPUT_DIR for MEETING.md files and parse them on each request. Simple, but no place to store notebook IDs or chat history without adding per-meeting sidecar files, which fragments state across the filesystem.
- **PostgreSQL** — overkill for a local personal tool; requires a running server process.

## Consequences
- Single `.db` file in OUTPUT_DIR alongside MEETING.md files — everything in one place.
- Schema migrations required if the data model changes.
- On Orchestrator startup, OUTPUT_DIR is scanned and any MEETING.md files not yet in SQLite are upserted (bootstrap for files that predate this feature).
