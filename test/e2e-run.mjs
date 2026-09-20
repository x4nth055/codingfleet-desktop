// Live end-to-end test of the desktop core against a running API: a real model
// asks this computer to write, edit and read a file, and to run a command.
//   CODINGFLEET_API_KEY=cf_sk_... npm run e2e                  (production)
//   CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 CODINGFLEET_API_KEY=... npm run e2e
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

const MODEL = process.env.E2E_MODEL || 'deepseek-v4-flash-instant';
const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

async function runTurn(sessionId, cwd, message, approve) {
  const events = [];
  let text = '';
  const run = new Run({
    sessionId,
    cwd,
    approve,
    onEvent: (event, data) => {
      events.push({ event, data });
      if (event === 'text.delta') text += data.text;
    },
  });
  await run.start({ message, model: MODEL });
  return { events, text, of: (name) => events.filter((e) => e.event === name).map((e) => e.data) };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-desktop-e2e-'));
console.log(`api: ${api.API_BASE}\nfolder: ${cwd}\nshell: ${tools.SHELL.name}\nmodel: ${MODEL}\n`);

const session = await api.createSession({
  executor: 'client',
  model: MODEL,
  system_message: `You are a coding agent working on the user's computer. Working directory: ${cwd}. `
    + `Shell: ${tools.SHELL.name}. Use relative paths. Be terse.`,
  capabilities: { code_execution: true },
});
check('client session created', session.executor === 'client', session.id);

// ── Turn 1: everything allowed ─────────────────────────────────────────────
const asked = [];
const first = await runTurn(
  session.id,
  cwd,
  'Do these steps with your tools, one at a time: 1) fs_write notes/hello.txt with the content HELLO_DESKTOP. '
  + '2) fs_edit that file to replace HELLO_DESKTOP with HELLO_EDITED. 3) run_command `cat notes/hello.txt`. '
  + 'Then tell me exactly what the command printed.',
  (call) => {
    asked.push(call.name);
    return 'allow';
  },
);
const calls = first.of('tool.call').filter((c) => c.executor === 'client');
const names = calls.map((c) => c.name);
const outs = new Map(first.of('tool.result').map((r) => [r.id, r]));
check('the model called fs_write, fs_edit and run_command', ['fs_write', 'fs_edit', 'run_command'].every((n) => names.includes(n)), names.join(', '));
check('every client call got a result', calls.every((c) => outs.has(c.id)), `${outs.size} results`);
check('every client call succeeded', calls.every((c) => outs.get(c.id)?.ok), calls.map((c) => `${c.name}:${outs.get(c.id)?.ok}`).join(' '));
const file = path.join(cwd, 'notes', 'hello.txt');
check('the file exists on this computer with the edit', fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === 'HELLO_EDITED',
  fs.existsSync(file) ? JSON.stringify(fs.readFileSync(file, 'utf8')) : 'missing');
const command = calls.find((c) => c.name === 'run_command');
check('the command output came back', command && JSON.stringify(outs.get(command.id)?.output).includes('HELLO_EDITED'));
check('the answer quotes the output', first.text.includes('HELLO_EDITED'), first.text.trim().slice(0, 120));
check('the run completed', first.of('run.ended')[0]?.reason === 'completed', JSON.stringify(first.of('run.ended')[0]));
check('the client reported the end', first.of('client.finished').length === 1);
check('no client errors', first.of('client.error').length === 0, JSON.stringify(first.of('client.error')));
check('approval was asked for each client call', asked.length === calls.length, `${asked.length}/${calls.length}`);
const changed = first.of('client.files_changed')[0]?.files || [];
const hello = changed.find((f) => f.path === 'notes/hello.txt');
check('the run reports the file it changed, as a new file with one line',
  hello && hello.created && hello.added === 1 && hello.removed === 0, JSON.stringify(changed).slice(0, 160));
check('files_changed comes before client.finished',
  first.events.findIndex((e) => e.event === 'client.files_changed') < first.events.findIndex((e) => e.event === 'client.finished'));

// ── Turn 2: the user declines the command ──────────────────────────────────
const second = await runTurn(
  session.id,
  cwd,
  'Use run_command to run `rm notes/hello.txt`. If it is declined, reply with the single word DECLINED.',
  (call) => (call.name === 'run_command' ? 'deny' : 'allow'),
);
const denied = second.of('tool.call').filter((c) => c.name === 'run_command');
const deniedResults = second.of('tool.result').filter((r) => denied.some((c) => c.id === r.id));
check('a declined call is reported to the model as failed', denied.length >= 1 && deniedResults.every((r) => r.ok === false), `${deniedResults.length} results`);
check('the file is still there', fs.existsSync(file));
check('the model knows it was declined', /declin/i.test(second.text), second.text.trim().slice(0, 120));

// ── History and listing ────────────────────────────────────────────────────
const history = await api.messages(session.id);
check('messages returns both turns', history.messages.length === 4, `${history.messages.length} messages`);
const toolNames = history.messages[1]?.tools?.map((t) => t.name) || [];
check('the transcript lists the tools of the first turn', ['fs_write', 'fs_edit', 'run_command'].every((n) => toolNames.includes(n)), toolNames.join(', '));
check('tool arguments in the transcript carry no executor field', history.messages.every((m) => (m.tools || []).every((t) => !('executor' in t.arguments))));
const listed = (await api.listSessions(20)).sessions.find((s) => s.id === session.id);
check('the session is listed with a title field', listed && 'title' in listed, listed ? String(listed.title) : 'not listed');

// ── Cancel while a call waits for approval ─────────────────────────────────
let cancelledAt = 0;
let runRef;
const cancelEvents = [];
runRef = new Run({
  sessionId: session.id,
  cwd,
  approve: () => new Promise(() => {
    // Never answered: the user walks away. Cancel instead.
    setTimeout(async () => {
      cancelledAt = Date.now();
      try { await runRef.cancel(); } catch (err) { cancelEvents.push({ event: 'cancel-failed', data: err.message }); }
    }, 3000);
  }),
  onEvent: (event, data) => cancelEvents.push({ event, data }),
});
const t0 = Date.now();
await runRef.start({ message: 'Use run_command to run `ls`.', model: MODEL });
const ended = cancelEvents.find((e) => e.event === 'run.ended')?.data;
check('cancel ends a run that waits for approval', ended?.reason === 'cancelled', JSON.stringify(ended));
check('...quickly', cancelledAt && Date.now() - cancelledAt < 30000, `${Math.round((Date.now() - (cancelledAt || t0)) / 1000)}s after cancel`);

console.log(`\nsession: ${session.id}`);
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
