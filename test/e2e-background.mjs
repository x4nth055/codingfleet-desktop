// Live end-to-end test of background commands on this computer, against a
// running API: the user moves a command the agent waits for to the background
// (as the "Run in background" button does), and the agent starts one with
// stop_after and reads why it ended.
//   CODINGFLEET_API_KEY=cf_sk_... node test/e2e-background.mjs
//   E2E_MODEL=... to pick the model
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../src/core/api.js');
const { Run } = require('../src/core/runner.js');
const tools = require('../src/core/tools.js');
const { BackgroundJobs } = require('../src/core/background.js');

const MODEL = process.env.E2E_MODEL || 'deepseek-v4-flash';
// stop_after is offered from 1.2 on.
api.configure({ client: 'desktop/1.2.0' });
const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-desktop-bg-'));
console.log(`api: ${api.API_BASE}\nfolder: ${cwd}\nshell: ${tools.SHELL.name}\nmodel: ${MODEL}\n`);
assert.ok(tools.SHELL.unix, 'this test writes bash loops: it needs Git Bash or a Unix shell');

const session = await api.createSession({ executor: 'client', model: MODEL, capabilities: { code_execution: true } });
const sessionId = session.id;
const jobs = new BackgroundJobs({ shell: tools.SHELL, env: tools.commandEnv, kill: tools.killTree });
// The same handlers as the app's (main.js handlersFor).
const clientHandlers = new Map([
  ['run_command', (args, context) => (args.background
    ? jobs.start(sessionId, String(args.command || ''), context.cwd, { stopAfter: args.stop_after })
    : tools.executeTool('run_command', args, { ...context, callId: context.call.id, adopt: (h) => jobs.adopt(sessionId, h) }))],
  ['read_background', (args, context) => jobs.read(sessionId, args.id, args.wait, context.signal)],
  ['stop_background', (args) => jobs.stop(sessionId, args.id)],
]);

async function turn(message, onEvent = () => {}) {
  const events = [];
  const run = new Run({
    sessionId, cwd, approve: () => 'allow', clientHandlers,
    adopt: (handoff) => jobs.adopt(sessionId, handoff),
    onEvent: (event, data) => { events.push({ event, data }); onEvent(event, data); },
  });
  await run.start({ message, model: MODEL });
  return events;
}

// ── 1. The user moves a waiting command to the background ──────────────────
let movedId = null;
const first = await turn(
  'Use run_command (do not set background) with timeout 110 to run exactly: '
  + 'for i in $(seq 1 60); do echo tick $i; sleep 1; done\nThen reply with one short sentence.',
  (event, data) => {
    if (event === 'client.tool_running' && !movedId) {
      movedId = data.id;
      setTimeout(() => check('the waiting command moved', tools.moveToBackground(data.id)), 4000);
    }
  },
);
const result = first.find((e) => e.event === 'tool.result' && e.data.id === movedId);
const background = result && result.data.output && result.data.output.background;
check('its result says where it went', background && /^bg_[0-9a-f]{8}$/.test(background.id), JSON.stringify(result?.data.output).slice(0, 200));
check('with what it printed so far', /tick 1/.test(result?.data.output?.stdout || ''));
check('it keeps running here', jobs.list(sessionId).some((j) => j.id === background?.id && j.status === 'running'));
await jobs.stop(sessionId, background?.id);

// ── 2. The agent starts one with stop_after ─────────────────────────────────
const second = await turn(
  'Start this with run_command, background: true and stop_after: 3, exactly: '
  + 'while true; do echo up; sleep 1; done\nThen call read_background on it with wait 0, then again with '
  + 'wait 6 if it still runs, and tell me its status and reason.');
const started = second.find((e) => e.event === 'tool.call' && e.data.name === 'run_command');
check('the agent used stop_after', started && Number(started.data.arguments.stop_after) === 3, JSON.stringify(started?.data.arguments));
// The model may or may not wait long enough to see it end: ask the job itself.
const startedId = second.find((e) => e.event === 'tool.result' && e.data.id === started?.data.id)?.data.output?.id;
await new Promise((resolve) => setTimeout(resolve, 4500));
const last = (await jobs.read(sessionId, startedId)).output;
check('it was stopped by its limit', last && last.reason === 'Stopped after its 3 s limit (stop_after).', JSON.stringify(last).slice(0, 200));
check('nothing is left running', !jobs.list(sessionId).some((j) => j.status === 'running'));

jobs.stopAll();
await api.deleteSession(sessionId).catch(() => {});
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
