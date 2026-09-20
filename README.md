# CodingFleet for Windows (MVP)

A desktop client for the CodingFleet Agent API. You type a prompt; the agent
runs on CodingFleet, and its coding tools (`run_command`, `execute_code`,
`fs_read`, `fs_write`, `fs_edit`, `fs_glob`) run on this computer, inside the
folder you choose.

## Run it

```bash
npm install
npm start
```

On first start the app asks for your CodingFleet API key (create one on
codingfleet.com/agent-api). It talks to https://codingfleet.com/v1 and keeps
the key encrypted with Windows DPAPI in `%APPDATA%/codingfleet-desktop/credentials.json`.
Settings (the gear in the sidebar, or Ctrl+,) change the key or the server.

For a local server, environment variables override the settings:

```bash
CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 CODINGFLEET_API_KEY=cf_sk_... npm start
```

## Test it

```bash
npm test          # local tools, approval rules and line diffs
npm run e2e       # a real run against the API (needs CODINGFLEET_API_KEY)
npm run dist      # a portable .exe in dist/
```

Development flags: `--open=<session id>`, `--screenshot=out.png`,
`--shot-delay=<ms>`, `--shot-menu=models|permissions|settings`,
`--shot-cwd=<dir>`, `--shot-prompt=<text>`, `--shot-permission=auto`, `--shot-expand`.

## How it fits together

```
src/core/      no Electron; the CLI will reuse it
  config.js    default API address, environment overrides
  api.js       HTTP + server-sent events client for /v1
  tools.js     the client tools, run in Git Bash (or PowerShell without Git)
  runner.js    one run: reads events, asks for approval, runs tools, posts results, tracks edited files
  diff.js      line diffs for the edited-files card
src/main/      Electron main process: window, IPC, credentials, local state, approvals
src/renderer/  the window: sidebar, transcript, composer, settings (no Node access, never sees the key)
```

**Approvals.** Reads inside the project folder run at once. Commands, file
changes and reads outside the folder wait for Allow / Deny, unless the composer
is set to Auto-approve or you allowed that tool for the session.
