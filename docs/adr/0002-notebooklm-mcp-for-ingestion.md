# ADR 0002: NotebookLM MCP Server for Ingestion and Task Extraction

**Status:** Accepted

## Context

After a Meeting Session ends, the app needs to extract a Task List from the Transcript and Chat Log. The alternatives were: (A) call Claude API directly with a summarization prompt, (B) use the community NotebookLM MCP server to ingest sources and query them.

## Decision

Use the `notebooklm-mcp` community MCP server (`npx notebooklm-mcp@latest`) to ingest meeting data and extract tasks via `add_source` + `ask_question`.

## Reasons

- The user already uses NotebookLM as a trusted step in their existing workflow — this preserves that while automating the manual import.
- NotebookLM's grounded answers cite sources from uploaded documents, making the Task List traceable back to what was actually said.
- The MCP server accepts raw text via `add_source`, so no file conversion is needed.

## Trade-offs

- NotebookLM MCP uses browser automation (Patchright) — it is slower and more fragile than a direct API call. Accepted: reliability is acceptable for a post-meeting pipeline (not latency-sensitive).
- Requires a one-time Google auth setup (`setup_auth`). Accepted: runs headless after that.
- Depends on a community project with no SLA. If it breaks, fallback is direct Claude API summarization.
