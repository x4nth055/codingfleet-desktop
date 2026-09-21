# CodingFleet Desktop

A desktop client for the [CodingFleet](https://codingfleet.com) Agent API.
You type a prompt; the agent thinks on CodingFleet's servers, but its coding
tools run **on your machine**, inside a folder you pick — so it reads your real
code, runs your real test suite, and edits your real files.

Nothing runs without your say-so: reads inside the project folder happen
freely, and anything else — a shell command, a file change, a read outside the
folder — waits for you to approve it.

Windows, macOS and Linux. MIT licensed.

---

## Features

**Agent that works on your code**
- Six client tools run locally: `run_command`, `execute_code`, `fs_read`,
  `fs_write`, `fs_edit`, `fs_glob`
- Every edit is shown as a line diff in an "edited files" card
- Sub-agents: the agent can split work into parallel tasks, which run through
  the same approval rules
- **Steer a run mid-flight** — send a correction without stopping the agent
- Survives a dropped connection: the run continues on the server and the app
  re-attaches and replays the turn

**Two places the tools can run** — your folder, or a cloud sandbox
- Undo a run: put every file back the way it was before the agent started
- Reads `AGENTS.md` from your project, so the agent follows your conventions

**Approvals you control**
- Allow / Deny per call, or allow a kind of action for the rest of the session
- Auto-approve mode in the composer when you want it to just go
- Desktop notification when a run needs you or finishes

**Know what it costs before you send**
- A running estimate in the composer, from what your earlier runs actually cost
- Over 100 credits it stops and offers the smartest models that cost less,
  one click to switch

**MCP support**
- 13 built-in remote connectors: Context7, DeepWiki, Microsoft Learn, AWS
  Knowledge, Cloudflare Docs, GitHub, Hugging Face, Sentry, Semgrep, Supabase,
  Neon, Stripe, Heroku
- Local MCP servers over stdio — any program on your machine that speaks MCP;
  its tools are declared to the model and routed back through approvals

**Input that isn't just text**
- Attach files, drag-and-drop, paste images straight into the composer
- Screenshots from inside the app: drag out a region (Ctrl+Shift+S), pick one
  open window, or take a whole screen — then the model looks at it
- Images the agent makes in your folder are drawn in the conversation, and
  what `view_image` looked at is shown in its step
- The agent can ask for a screenshot itself when the answer is on your screen —
  it asks first, you see the picture it got, and the tool only exists while
  tools run on your computer, never in a cloud sandbox
- Voice input, transcribed by the API

**Sessions and cost**
- Rename, pin, duplicate and delete sessions
- Compact a long session to free up context
- Live token breakdown in the footer (input, output, cache read/write) and
  credit cost per run
- Model picker, billing and subscription management, and BYOK — use your own
  provider keys instead of CodingFleet credits

**Three themes** — Dark, Light, and Hacker (green on black).

---

## Quick start

Requires **Node.js 22 or newer** (`fs.promises.glob` is used by `fs_glob`).

```bash
npm install
npm start
```

On first launch, sign in through your browser, or paste an API key from
[codingfleet.com/agent-api](https://codingfleet.com/agent-api). The key is
encrypted with your OS keystore — DPAPI on Windows, Keychain on macOS,
libsecret/kwallet on Linux — and stored in your user-data folder:

| OS | Location |
|---|---|
| Windows | `%APPDATA%/CodingFleet/` |
| macOS | `~/Library/Application Support/CodingFleet/` |
| Linux | `~/.config/CodingFleet/` |

That folder holds `credentials.json` (the key), `state.json` (sessions, chosen
folders, theme) and `mcp.json` (your MCP servers, encrypted).

**On Windows, install [Git for Windows](https://git-scm.com/download/win).**
The app runs commands in Git Bash when it's available, because models write
Unix shell far more reliably than PowerShell. Without it, commands fall back to
Windows PowerShell 5.1 and the agent is told to use PowerShell syntax.

### Settings

Open Settings with the gear in the sidebar, or `Ctrl+,`. Environment variables
override whatever is saved there — handy for pointing at a local server:

```bash
CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 CODINGFLEET_API_KEY=cf_sk_... npm start
```

---

## Where the tools run

Every session picks one of two places for its tools, when you start it.

**Your folder** (pick a folder) — the six client tools run on this computer,
in that folder. The agent reads your real code, runs your real tests, and
edits your real files. Local MCP servers are available. This is the mode the
approval rules below exist for.

**A cloud sandbox** (pick no folder) — the same tools run on CodingFleet's
servers instead, in a container that starts empty. Nothing on your machine is
read, written, or executed, and no approval prompts appear, because there is
nothing local to protect. Good for throwaway experiments, for code you'd
rather not run locally, and for trying the agent before you trust it with a
repository.

You can attach files to a sandbox session, and they are uploaded into that
sandbox. Local MCP servers are not offered there: they are programs on your
machine, and the sandbox cannot reach them.

| | Your folder | Cloud sandbox |
|---|---|---|
| Tools run on | this computer | CodingFleet's servers |
| Sees your code | yes, in the chosen folder | only what you upload |
| Approvals | yes, per the table below | not needed |
| Local MCP servers | yes | no |
| Undo a run | yes | not applicable |
| `AGENTS.md` | read from the folder | not read |

---

## Approvals

This is the part worth understanding before you hand an agent your filesystem.

| Action | Behavior |
|---|---|
| `fs_read` / `fs_glob` inside the project folder | Runs immediately |
| `fs_read` / `fs_glob` outside the folder | Asks — *"reads outside the project folder"* |
| `run_command`, `execute_code` with a command | Asks — *"runs a command"* |
| `fs_write`, `fs_edit` | Asks — *"changes files"* |
| Any local MCP tool | Asks — *"uses a local MCP tool"* |

Commands are killed as a process tree after their timeout (60s default, 600s
max), output is clipped at 200k characters, and `fs_glob` skips `node_modules`,
`.git`, `__pycache__`, `.venv` and `venv`.

### Ask before changes, or Auto-approve

The shield button in the composer switches between the two modes.

**Ask before changes** (the default) — anything in the table above stops and
waits for you. Each prompt has three answers: **Allow** runs this one call,
**Deny** refuses it and tells the agent so, and **Allow all … this session**
stops asking for that *kind* of action until the session ends.

That third one is worth reading twice: it remembers the **reason**, not the
call. Allowing one `npm test` means every later command in that session runs
unprompted, `rm -rf` included. It is convenient once you trust what a session
is doing, and it is not a per-command allowlist.

**Auto-approve** — nothing is ever asked; every call runs the moment it
arrives. Use it for a folder you can afford to lose, a scratch checkout, or a
run you are watching. In a folder full of work you care about, leave it off.

Either way, the agent stays inside the tools it was given, and **Undo** below
is the way back from a run that went wrong.

### Undoing a run

Every run keeps a copy of each file as it was before the agent touched it —
the same copies that draw the diff card. The **Undo** button on that card puts
them all back: files the run edited return to their earlier version, and files
it created are removed again.

A file you edited yourself after the run is **not** overwritten. It is listed
as skipped, and undoing it again asks whether to discard your later edits.
Binary and very large files were never read, so they cannot be restored and
are reported as skipped rather than guessed at.

Undo lives in memory, for the last 20 runs, and does not survive restarting
the app. It is a way out of a bad run, not a version control system — for that
there is git, and committing before a big run is still a good habit.

---

## Project instructions (`AGENTS.md`)

If the folder has an `AGENTS.md`, the app reads it when the session starts and
appends it to the agent's system message, so the agent follows your project's
conventions without being told each time:

```markdown
# AGENTS.md
- Run `npm test` before you claim a change works.
- This codebase uses tabs. Match the file you are editing.
- Never edit anything under `generated/`.
```

`agents.md` and `.agents.md` work too. It is read when the session starts, so
editing it applies to the next session, not the one already open. Anything
past 32k characters is cut. The transcript says when one is in use.

---

## What a run costs

The composer shows a rough estimate next to the send button, worked out from
what your earlier runs in that session actually cost, or — before there is any
history — the model's published price over an assumed five steps.

If the estimate passes **100 credits**, sending stops and asks first, showing
the two smartest models that cost less than the one you picked, with their
intelligence index and price. One click switches model and sends.

It is an estimate, not a quote: an agentic run makes as many model calls as the
work needs. Sessions on **Auto** are not estimated, since the server picks the
model per message.

---

## How it fits together

```
src/core/      no Electron in here — the CLI will reuse it
  config.js    default API address, environment overrides
  api.js       HTTP + server-sent-events client for /v1
  tools.js     the six client tools, plus the approval rules
  runner.js    one run: reads events, asks for approval, runs tools,
               posts results, tracks changed files
  mcp.js       local MCP servers over stdio (JSON-RPC, tool discovery)
  diff.js      line diffs for the edited-files card
  undo.js      putting a run's files back, and refusing to clobber your edits
src/main/      Electron main process: window, IPC, credentials, state, approvals
src/renderer/  the window: sidebar, transcript, composer, settings
               (no Node access — it never sees your API key)
  cost.js      what a run will cost: plain arithmetic, no state, its own tests
```

The renderer is fully sandboxed: `preload.js` is the only bridge, and it
exposes a fixed list of calls and nothing else. The window can use your
microphone (for voice input) and no other device.

---

## Development

```bash
npm test          # Tools, approvals, reconnects, result retries, MCP, diffs, undo, cost
npm run test:layout # Isolated render checks across themes and window sizes
npm run e2e       # a real run against the API (needs CODINGFLEET_API_KEY)
```

Build installers:

```bash
npm run dist        # Windows portable .exe
npm run dist:mac    # macOS dmg + zip
npm run dist:linux  # Linux AppImage + deb
```

Screenshot and debugging flags:

```
--open=<session id>      open straight into a session
--screenshot=out.png     render, capture, quit
--shot-delay=<ms>        wait before capturing (default 3500)
--shot-menu=models|permissions|settings|attach|shot
--shot-cwd=<dir>         --shot-prompt=<text>    --shot-model=<id>
--shot-permission=auto   --shot-expand           --shot-scroll=<n>
--shot-attach=<path>     --theme=dark|light|hacker
```

---

## License

[MIT](LICENSE)
