# ADR 0005: Local Whisper for Audio/Video Import Transcription

## Status
Accepted

## Context
Importing audio and video files requires transcription before the content can be written as MEETING.md and indexed in the Meeting Archive. The choice of transcription method directly affects cost, privacy, and setup friction.

## Decision
Use local Whisper (via the `whisper` Python CLI or `whisper.cpp`) to transcribe audio and video files. For video, extract audio first (via `ffmpeg`) then pass to Whisper.

## Alternatives Considered
- **OpenAI Whisper API** — minimal setup, but costs ~$0.006/min and requires an OpenAI API key in addition to the existing Anthropic key.
- **Deepgram / AssemblyAI** — fast and accurate, but another paid API with another key to manage.
- **Local Whisper** — free after one-time setup (Python + model weights ~1.5 GB). Meeting recordings are private and stay on disk.

## Consequences
- One-time setup: user must install Python, `openai-whisper`, and `ffmpeg`.
- No per-minute cost — important for long recordings.
- Transcription speed depends on hardware (CPU vs GPU). Acceptable for async import.
- The Orchestrator shells out to `whisper` CLI; the result is written to a temp `.txt` file and then processed into MEETING.md format.
