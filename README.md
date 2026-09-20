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

**Two execution modes**
- *Folder session* — tools run on this computer, in the folder you chose
- *Cloud sandbox* — pick no folder and the tools run on CodingFleet's servers
  instead; nothing local is read or touched

**Approvals you control**
- Allow / Deny per call, or allow a kind of action for the rest of the session
- Auto-approve toggle in the composer when you want it to just go
- Desktop notification when a run needs you or finishes

**MCP support**
- 13 built-in remote connectors: Context7, DeepWiki, Microsoft Learn, AWS
  Knowledge, Cloudflare Docs, GitHub, Hugging Face, Sentry, Semgrep, Supabase,
  Neon, Stripe, Heroku
- Local MCP servers over stdio — any program on your machine that speaks MCP;
  its tools are declared to the model and routed back through approvals

**Input that isn't just text**
- Attach files, drag-and-drop, paste images straight into the composer
- Capture a screenshot from inside the app and attach it
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

## Approvals

This is the part worth understanding before you hand an agent your filesystem.

| Action | Behavior |
|---|---|
| `fs_read` / `fs_glob` inside the project folder | Runs immediately |
| `fs_read` / `fs_glob` outside the folder | Asks — *"reads outside the project folder"* |
| `run_command`, `execute_code` with a command | Asks — *"runs a command"* |
| `fs_write`, `fs_edit` | Asks — *"changes files"* |
| Any local MCP tool | Asks — *"uses a local MCP tool"* |

Choosing **Allow for the session** remembers that *reason*, not that one call —
approve one command and the rest of the session's commands run unprompted.
The composer's Auto-approve toggle skips every prompt.

Commands are killed as a process tree after their timeout (60s default, 600s
max), output is clipped at 200k characters, and `fs_glob` skips `node_modules`,
`.git`, `__pycache__`, `.venv` and `venv`.

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
src/main/      Electron main process: window, IPC, credentials, state, approvals
src/renderer/  the window: sidebar, transcript, composer, settings
               (no Node access — it never sees your API key)
```

The renderer is fully sandboxed: `preload.js` is the only bridge, and it
exposes a fixed list of calls and nothing else. The window can use your
microphone (for voice input) and no other device.

---

## Development

```bash
npm test          # 23 unit tests: tools, approval rules, MCP, line diffs
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
--shot-menu=models|permissions|settings
--shot-cwd=<dir>         --shot-prompt=<text>    --shot-model=<id>
--shot-permission=auto   --shot-expand           --shot-scroll=<n>
--shot-attach=<path>     --theme=dark|light|hacker
```

---

## License

[MIT](LICENSE)
