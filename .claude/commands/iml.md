Implement the GitHub issue given as $ARGUMENTS.

## Steps

1. **Parse the issue reference** — $ARGUMENTS may be an issue number (e.g. `1`) or a full URL (e.g. `https://github.com/chinhvuong/lazy-p/issues/1`). Extract the issue number.

2. **Fetch the issue** — run:
   ```
   gh issue view <number> --repo chinhvuong/lazy-p --json title,body,labels
   ```
   Read the full PRD from the issue body.

3. **Load project context** — before writing any code, read:
   - `CONTEXT.md` (domain glossary — use its terminology throughout)
   - All files in `docs/adr/` (architectural decisions — do not contradict them)

4. **Plan the implementation** — identify the components to build based on the Implementation Decisions section of the PRD. Break the work into discrete tasks and complete them one by one, marking each done as you go.

5. **Implement** — write code that satisfies the User Stories and Implementation Decisions. Follow the tech stack defined in the PRD. Do not add features, abstractions, or error handling beyond what the PRD specifies.

6. **Verify** — run any available tests or linters. If none exist yet, implement the tests described in the Testing Decisions section first, then make them pass.

7. **Collect proof of work** — before posting the comment, gather evidence:

   a. **Git diff summary** — run `git diff --stat HEAD` and `git log --oneline -10` to capture exactly what changed.

   b. **Full diff** — run `git diff HEAD` and include the key changed files in the comment (truncate if very long).

   c. **Screenshot** — if the implementation includes any web UI or visual output:
      - Start the dev server (e.g. `npm run dev`) in the background
      - Use the Playwright MCP tool `mcp__playwright__browser_navigate` to open the app
      - Use `mcp__playwright__browser_take_screenshot` to capture the UI
      - Save the screenshot file path for upload

   d. **Upload screenshot to GitHub** — if a screenshot was taken:
      - Commit the screenshot to the repo under `docs/screenshots/<issue-number>-<slug>.png`
      - Push to the remote so it has a public GitHub raw URL
      - Use the raw URL in the comment body: `![screenshot](https://raw.githubusercontent.com/chinhvuong/lazy-p/main/docs/screenshots/<filename>)`

   e. **Test output** — run the test suite and capture stdout to include in the comment.

8. **Post proof-of-work comment** — post a structured comment on the issue:
   ```
   gh issue comment <number> --repo chinhvuong/lazy-p --body "..."
   ```

   The comment must follow this structure:

   ```markdown
   ## ✅ Implemented

   ### What was built
   - <bullet list of user stories satisfied>

   ### Files changed
   <output of git diff --stat>

   ### Key changes
   <brief description of the most important code decisions>

   ### Tests
   <test run output or "no tests yet — test stubs added">

   ### Screenshot
   ![screenshot](<raw github url>) <!-- omit section if no UI -->

   ### Setup
   <commands the user needs to run, e.g. npm install, setup_auth>
   ```
