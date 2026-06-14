# Context: lazy-p

A local app that eliminates manual steps between a Google Meet meeting and a Claude Code implementation session.

---

## Glossary

**Meeting Session**
A single Google Meet call. The unit of work the app captures from start to finish. Identified by a timestamp and optional meeting title.

**Capture**
The real-time recording of a Meeting Session — collecting Transcript chunks, Chat Messages, and Participant events as they occur, without manual user action.

**Transcript**
The speaker-attributed text record of what was said during a Meeting Session. Each entry carries a speaker name and timestamp. Sourced from Google Meet's live captions DOM.

**Chat Log**
The chronological record of text messages sent in the Google Meet chat panel during a Meeting Session. Includes sender name, timestamp, and message text.

**Participant**
A person present in the Meeting Session. Identified by display name. May or may not appear in the Transcript depending on whether they spoke.

**Meeting Context**
The complete artifact for a Meeting Session: Transcript + Chat Log + Participant list + Task List. The canonical input to a Claude Code session.

**Task List**
The structured list of actionable items extracted from a Meeting Session's Transcript and Chat Log by NotebookLM. Each task has a description and an optional owner (Participant who was assigned it).

**Pipeline**
The automated sequence that runs after a Meeting Session ends: ingest Meeting Context into NotebookLM → extract Task List → write MEETING.md → open Claude Code.

**MEETING.md**
The file artifact written to disk at the end of the Pipeline. Contains the full Meeting Context (Participants, Chat Log, Transcript, Task List). Consumed directly by Claude Code as the starting context for implementation work.

**Orchestrator**
The local Node.js server that runs the Pipeline, receives Capture data from the Extension, and serves the Web UI.

**Extension**
The Chrome browser extension that detects Google Meet sessions, auto-starts Capture, auto-enables live captions in the Meet UI, and streams data to the Orchestrator via WebSocket.

**Web UI**
The React dashboard served by the Orchestrator at `localhost:3000`. Shows the live Transcript and Chat Log during a Meeting Session, displays the Task List after the Pipeline completes, and provides a Meeting Archive screen where past Meeting Sessions can be browsed and discussed via Meeting Chat.

**Meeting Archive**
The persisted collection of all Meeting Sessions — both live-captured and imported. Backed by SQLite. Populated on Orchestrator startup by auto-scanning OUTPUT_DIR for existing MEETING.md files and upserting them into the database.

**Import**
The process of adding a past Meeting Session to the Meeting Archive from an external source. Supported sources: raw transcript text (pasted), transcript file (.txt / .vtt / .srt), audio file, or video file. Audio and video are transcribed locally via Whisper, then written to OUTPUT_DIR as a MEETING.md file using the same naming convention as live-captured meetings (`MEETING-YYYY-MM-DD.md`). A Meeting Session requires at least one of: Recording, Transcript, or raw text — not all are required.

**Recording**
The original video or audio file submitted during Import. Stored as an absolute file path reference in the Meeting Archive (never copied). Displayed in the Web UI as a playable media player after Import completes. If the file is moved or deleted, replay is unavailable.

**Timestamp Reference**
A `[HH:MM:SS]` marker that appears in a Meeting Chat response when the AI cites a moment from the Transcript. Rendered in the Web UI as a clickable link that seeks the Recording player to that point in time. Produced naturally when NotebookLM echoes back Transcript text that was formatted with timestamp prefixes during ingestion.

**Meeting Chat**
The saved Q&A conversation thread tied to a specific Meeting Session. Questions are answered by the Meeting Session's NotebookLM notebook (identified by its stored notebook ID) via the NotebookLM MCP server. Responses may contain Timestamp References when the source Transcript includes timestamp prefixes. The full conversation history is persisted in SQLite and restored when the user reopens the meeting.
