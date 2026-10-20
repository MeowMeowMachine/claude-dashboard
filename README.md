# claude-dashboard

A modification for Claude to show token usage, rate limits and the live progress of every open session in one dashboard.

- **Usage pane** in Claude Code at session start: tokens per day (last 14 days), tokens per session today, active sessions.
- **Live web dashboard** at `http://127.0.0.1:8765/` (loopback only): 5-hour and weekly limit gauges, token split (input / output / cache), models, and a board of all sessions (waiting for input, busy, idle, recently closed) with progress bars, sub-agent pool, context size and the last published artifact.
- **Progress reports**: each session reports its own progress with one command; the dashboard shows it at once.
- **Close idle sessions** from the pane (never the current or a busy one; transcripts stay, the app can resume them).

All data comes from local files in `~/.claude` (transcripts, session files). Nothing is sent anywhere.

## Requirements

- Claude Code with mod support (`~/.claude/mods/`), desktop app or CLI.
- Node.js 23.6+ on `PATH`. The scripts import `hooks/page.ts` directly, so Node must run TypeScript files (default since 23.6).
- Windows: the server start and "close session" use PowerShell / `taskkill`. On macOS/Linux the dashboard works, but replace those two calls (`serve` in `hooks/register.tsx`, `scripts/close.mjs`).

## Install

1. Clone into the mods folder. The folder name must be `usage-dashboard` (scripts use that path):

   ```bash
   git clone https://github.com/MeowMeowMachine/claude-dashboard.git ~/.claude/mods/usage-dashboard
   ```

2. Start a new Claude Code session. On `session.start` the mod:
   - registers the `/dashboard` command,
   - starts the web server (hidden, detached; a second start exits when port 8765 is taken),
   - opens the **Usage** pane and refreshes the data.

   Claude Code generates the mod SDK types into `.claude-plugin/types/` itself; they are not in the repo.

3. Open the dashboard:
   - `/dashboard` - show it in the pane
   - `/dashboard tab` - open it in your default browser
   - `/dashboard app` - open it in Claude's in-app browser pane
   - or browse to `http://127.0.0.1:8765/`

   If the page does not load, start the server by hand:

   ```bash
   powershell -NoProfile -Command "Start-Process node -ArgumentList '\"$HOME/.claude/mods/usage-dashboard/scripts/serve.mjs\"' -WindowStyle Hidden"
   ```

Data refreshes when a session starts and after each main turn of any session. The web page reloads itself every few seconds.

## Send progress to the dashboard (CLAUDE.md)

Sessions do not report progress on their own: Claude must be told to. Add this block to your global `~/.claude/CLAUDE.md` (all projects) or to a project `CLAUDE.md`:

```markdown
# Dashboard progress
After finishing each part of a feature (a planned section or task-list step), report your estimated overall progress of the user's request to the usage dashboard with one Bash call:
`node ~/.claude/mods/usage-dashboard/scripts/progress.mjs <0-100> "<what you just finished, under 80 chars>"`
Send 100 when the task is done and verified. Main session only: subagents skip it. Skip it for pure Q&A and one-line fixes. If the command fails, carry on without retrying.
When the user asks to open the dashboard (in the app), open `http://127.0.0.1:8765/` in the built-in browser pane with `preview_start`. If it does not load, start the server first: `powershell -NoProfile -Command "Start-Process node -ArgumentList '\"$HOME/.claude/mods/usage-dashboard/scripts/serve.mjs\"' -WindowStyle Hidden"`.
```

How it works: `scripts/progress.mjs` reads the session id from `CLAUDE_CODE_SESSION_ID` (set by Claude Code in every Bash call), writes `progress/<session id>.json` and re-renders the page. It fails on purpose when run outside a Claude session. Example call:

```bash
node ~/.claude/mods/usage-dashboard/scripts/progress.mjs 40 "API routes done"
```

A progress report wins over the session's task list. Without either, a busy session shows an animated bar.

## Optional: estimate log

The dashboard can also show each session's planned sections (tier, estimate, which sections are done) from a Markdown log. Set the environment variable `CLAUDE_DASHBOARD_LOG_DIR` to a folder of `<tier>.md` files (e.g. `easy.md`, `medium.md`, `complex.md`). Blocks use this format, keyed by the first 8 chars of the session id:

```
## <id> | <session> | <date> | <title> | status
est: <k> tok / <n> min | act: <k> tok / <n> min
- S1 <keyword> | <what was done> | est 10m | act 14m
```

A section counts as done once its `act` value has a number. A `status` containing `done` marks the block done. To have Claude write the log, add a rule like this to your CLAUDE.md:

```markdown
# Estimate log
For every task that changes files: before starting, append a block to `<log dir>/<tier>.md` (tier = easy, medium or complex; id = first 8 chars of the session id; start time from `date`).
Block format:
## <id> | <session> | <date> | <title> | started
est: <k> tok / <n> min | act: - / -
- S1 <keyword> | <what> | est 10m | act -
At the end of each section fill in its `act` minutes; on finish set the status to `done`. Edit only your own block.
```

Without the folder the dashboard just leaves this part out.

## Files

| Path | Purpose |
| --- | --- |
| `hooks/register.tsx` | Mod entry: session start, `/dashboard` command, refresh after each main turn, Usage pane |
| `hooks/page.ts` | Renders the pane rows and the HTML page (shared by the hooks and the scripts) |
| `hooks/rows.test.ts` | Tests for the rendering helpers |
| `scripts/usage.mjs` | Reads `~/.claude/projects/**/*.jsonl` and `~/.claude/sessions/*.json`, prints the dashboard JSON (cached per file in `cache.json`) |
| `scripts/serve.mjs` | Serves `usage.html` on `127.0.0.1:8765`, re-rendered per request |
| `scripts/progress.mjs` | Progress report from a session |
| `scripts/close.mjs` | Ends idle sessions by process id (checks the process start time first) |
| `types/index.d.ts` | Data types |

Generated at runtime and git-ignored: `cache.json`, `limits.json` (last rate-limit reading), `usage.html`, `progress/`.
