# ADR 0003: MEETING.md + Claude Code as Pipeline Output

**Status:** Accepted

## Context

After the Task List is extracted, the app needs to hand the user a Claude session pre-loaded with full Meeting Context. The alternatives were: (A) a local chat UI powered by the Claude API embedded in the Web UI, (B) copy prompt to clipboard for claude.ai, (C) write MEETING.md and open Claude Code.

## Decision

Write a `MEETING.md` file to the project directory containing the full Meeting Context (Participants, Chat Log, Transcript, Task List), then open a Claude Code session pointed at that file.

## Reasons

- The user's end goal is to implement discussed features — Claude Code is a coding environment, not a chat interface. This skips the conversational phase and lands directly in implementation mode.
- MEETING.md persists on disk, so the context is never lost between sessions.
- No extra UI to build — the handoff is a file write + shell command.

## Trade-offs

- Requires Claude Code to be installed locally. Accepted: the user is already a Claude Code user.
- Less interactive than a chat UI for strategy discussions before coding. Accepted: user confirmed implementation (not strategy) is the primary post-meeting activity.
