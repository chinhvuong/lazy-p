# ADR 0001: Chrome Extension as Primary Capture Mechanism

**Status:** Accepted

## Context

The app needs to capture speaker-attributed transcript, chat messages, and participant data from Google Meet in real-time. The alternatives were: (A) system audio capture + local Whisper STT, (B) post-meeting export of Meet's transcript file, (C) Chrome extension reading the Meet DOM directly.

## Decision

Use a Chrome extension that reads Google Meet's live captions DOM and chat panel via MutationObserver.

## Reasons

- Google Meet's live captions DOM includes speaker names attached to each caption chunk — audio capture + Whisper gives transcription but no speaker attribution without a separate diarization model.
- Post-meeting export still requires a manual download/import step, which is exactly what this app exists to eliminate.
- The extension can also auto-enable captions on the user's behalf, removing the only remaining manual step.

## Trade-offs

- Only works with Google Meet (not Zoom, Teams, etc.). Audio capture would be universal. Accepted for now — Meet is the primary tool, and the extension gives richer data.
- Requires Chrome (not Firefox, Safari). Accepted.
- Google Meet may change its DOM structure, breaking the extension. Risk mitigated by targeting stable semantic elements (aria labels, caption container roles) over class names.
