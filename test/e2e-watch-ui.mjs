// The real app following a run another client started (the web chat, a
// phone), against a stand-in for the server that counts what it is asked.
//
//   node test/e2e-watch-ui.mjs          (npm run e2e:watch)
//
// It needs no account and spends nothing. The app runs with a profile of its
// own (a temp --user-data-dir), never the one of the installed app.
//
// What it is here for: the unit tests of the watch once passed while the real
// app opened one connection after another on the same run, until the server
// refused everything else coming from that network address. So this counts
// connections, in the real app, over real HTTP.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_CDP_PORT || 9337);
const SHOTS = process.env.E2E_SHOTS || '';
const KEY = 'cf_sk_e2e_watch';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? `  - ${String(detail).slice(0, 500)}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

// ── The server's stand-in ──────────────────────────────────────────────────
const SESSION = 'WebChatSession01';
const PROMPT = 'Make a script that sleeps for 60 seconds and run it';
const OPENING = 'I will create a simple script that sleeps for 60 seconds and run it.';
const CLOSING = 'The script ran for 60 seconds and finished.';

const server = {
  busy: false,
  runId: null,
  eventsStatus: 200,
  asked: { events: 0, messages: 0, session: 0, runsStarted: 0 },
  steers: [],            // what was sent into a run: { runId, message }
  open: new Set(),       // event streams held open now
  mostOpen: 0,
  history: [
    { role: 'user', text: 'Hello', files: [], steers: [], created_at: ago(30) },
    { role: 'assistant', text: 'Hello. What shall we build?', model: 'Test model', tools: [], created_at: ago(29) },
  ],
  sent: [],              // the run's events so far: replayed to whoever asks
};

const session = () => ({
  id: SESSION, title: 'Sleep test', executor: 'sandbox', origin: 'web', model: 'test-model',
  created_at: ago(40), last_used_at: ago(1), last_message_at: server.history.at(-1).created_at,
  busy: server.busy, active_run_id: server.runId,
  sandbox_of: null, sandbox_of_title: null, sandbox_reason: '',
});

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
function emit(event, data) {
  server.sent.push(frame(event, data));
  for (const res of server.open) res.write(frame(event, data));
}
function endRun() {
  emit('run.ended', { reason: 'completed' });
  for (const res of server.open) res.end();
}

const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace(/^\/v1/, '');
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${KEY}`) { req.resume(); return json(401, { error: { code: 'invalid_token', message: 'Invalid key.' } }); }
  const steer = route.match(/^\/runs\/([^/]+)\/steer$/);
  if (steer && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      server.steers.push({ runId: steer[1], message: JSON.parse(raw || '{}').message });
      json(200, { status: 'accepted', steer_id: 'steer-1' });
    });
    return undefined;
  }
  req.resume();
  // A second turn while one is going: refused, as the real server does.
  if (route === `/sessions/${SESSION}/runs` && req.method === 'POST') {
    server.asked.runsStarted += 1;
    return json(409, { error: { code: 'run_in_progress', message: 'This session already has a run going.' } });
  }
  if (route === '/credits') {
    return json(200, {
      plan: { name: 'Elite', unlimited_models: true }, credits: 1000, weekly_remaining: 900, weekly_total: 1200,
      account: { username: 'e2e', email: 'e2e@example.com' }, key: { name: 'This computer', hint: 'e2e', client: 'desktop' },
    });
  }
  if (route === '/models') {
    return json(200, { models: [{ id: 'test-model', name: 'Test model', credits_per_20k_tokens: 1, supports_vision: false, unlimited: true, provider: { name: 'Test' } }] });
  }
  if (route === '/settings') return json(200, { preferences: { default_model: 'test-model' } });
  if (route === '/sessions' && req.method === 'GET') return json(200, { sessions: [session()] });
  if (route === `/sessions/${SESSION}`) { server.asked.session += 1; return json(200, session()); }
  if (route === `/sessions/${SESSION}/messages`) {
    server.asked.messages += 1;
    return json(200, { session_id: SESSION, messages: server.history, compactions: [] });
  }
  const events = route.match(/^\/runs\/([^/]+)\/events$/);
  if (events) {
    server.asked.events += 1;
    if (server.eventsStatus !== 200) {
      return json(server.eventsStatus, { error: { code: 'events_unavailable', message: 'The events of this run cannot be read.' } });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(server.sent.join(''));
    if (!server.busy) return res.end();
    server.open.add(res);
    server.mostOpen = Math.max(server.mostOpen, server.open.size);
    res.on('close', () => server.open.delete(res));
    return undefined;
  }
  return json(404, { error: { code: 'not_found', message: `Nothing at ${req.method} ${route}.` } });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const API_BASE = `http://127.0.0.1:${fake.address().port}/v1`;

// ── The app ────────────────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-watch-ui-'));
const electron = require('electron');
const child = spawn(electron, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], {
  cwd: root, env: { ...process.env, CODINGFLEET_API_BASE: API_BASE, CODINGFLEET_API_KEY: KEY }, stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.on('data', () => {});

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('The app did not open its window.');
}

let ws;
let seq = 0;
const pending = new Map();
async function connect() {
  ws = new WebSocket(await target());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
async function js(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result && res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'page error');
  return res.result && res.result.result ? res.result.result.value : undefined;
}
async function waitFor(expression, timeout = 30000, every = 250) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      last = await js(expression);
      if (last) return last;
    } catch (err) { last = err.message; }
    await sleep(every);
  }
  return false;
}
async function shot(name) {
  if (!SHOTS) return;
  const res = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(res.result.data, 'base64'));
}

// What the transcript on screen says, as text.
const TRANSCRIPT = 'document.getElementById("transcript").innerText';
const count = (text, part) => text.split(part).length - 1;
const HINT = '(document.querySelector(".working.remote .hint") || {}).textContent || ""';

async function run() {
  await connect();
  await send('Runtime.enable');
  check('the app signs in and lists the session',
    await waitFor(`typeof S !== "undefined" && S.settings && S.settings.hasKey && S.sessions.some((s) => s.id === "${SESSION}")`, 40000));
  await js(`selectSession("${SESSION}"); true`);
  check('the session opens with its history', await waitFor(`S.loaded.has("${SESSION}") && ${TRANSCRIPT}.includes("What shall we build?")`));

  // ── A turn starts in the web chat ────────────────────────────────────────
  server.history.push({ role: 'user', text: PROMPT, files: [], steers: [], created_at: ago(0) });
  server.busy = true;
  server.runId = 'RunWebTurn000001';
  emit('run.started', { run_id: server.runId });
  emit('status', { kind: 'thinking', state: 'started' });
  emit('text.delta', { text: OPENING });
  await js('checkCurrentSession(); true');
  check('the run is drawn as it goes', await waitFor(`${TRANSCRIPT}.includes(${JSON.stringify(OPENING)})`, 15000), await js(TRANSCRIPT));
  check('the other client\'s message is shown above it', (await js(TRANSCRIPT)).includes(PROMPT));
  check('the window says it is live', await waitFor(`${HINT} === "Live"`, 5000), await js(HINT));
  check('the prompt box is held while it works', await js('S.remoteBusy.has(S.current) && !S.running.has(S.current)'));
  await shot('01-live');

  // The server saves the part done so far, as it does during a turn; a session
  // list that names a newer message makes the window read the history again.
  server.history.push({ role: 'assistant', text: OPENING, partial: true, interrupted: false, tools: [], created_at: ago(0) });
  emit('tool.call', { id: 'call-1', name: 'run_command', arguments: { command: 'python sleep.py' } });
  check('its tool call is shown', await waitFor('Boolean(document.querySelector("#transcript .tool, #transcript .tools"))', 10000));

  // The window looks at the session every few seconds while it is busy (and
  // here eight more times, asked for by hand). Through all of them: one
  // connection on the run.
  const before = { ...server.asked };
  for (let look = 0; look < 8; look++) {
    await js('checkCurrentSession(); true');
    await sleep(1500);
  }
  check('the window kept looking at the session', server.asked.session - before.session >= 8, server.asked.session - before.session);
  check('one connection on the run, however often the window looks', server.asked.events === 1, `asked ${server.asked.events} times`);
  check('never more than one open at a time', server.mostOpen === 1, server.mostOpen);
  const during = await js(TRANSCRIPT);
  check('the opening text is there once, not twice', count(during, OPENING) === 1, count(during, OPENING));
  check('no "still in progress" notice beside the live run', !during.includes('still in progress'));
  check('still live', await js(`${HINT}`) === 'Live', await js(HINT));
  await shot('02-after-many-looks');

  // ── A message typed here steers it ───────────────────────────────────────
  const STEER = 'Make it 30 seconds instead';
  check('the prompt box says a message will steer', /steer/i.test(await js('$("prompt").placeholder')), await js('$("prompt").placeholder'));
  await js(`(() => { const p = $("prompt"); p.value = ${JSON.stringify(STEER)}; p.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  check('the button says Steer', /Steer/.test(await js('$("send").title')), await js('$("send").title'));
  await js('sendMessage(); true');
  check('the message is sent into the followed run', await waitFor('true', 100) && await (async () => {
    for (let i = 0; i < 40 && !server.steers.length; i++) await sleep(100);
    return server.steers.length === 1 && server.steers[0].runId === server.runId && server.steers[0].message === STEER;
  })(), JSON.stringify(server.steers));
  check('no second turn was started', server.asked.runsStarted === 0, server.asked.runsStarted);
  check('it is shown as sent while working', await waitFor(`${TRANSCRIPT}.includes(${JSON.stringify(STEER)}) && ${TRANSCRIPT}.includes("Sent while working")`, 5000), await js(TRANSCRIPT));
  check('the prompt box is empty again', (await js('$("prompt").value')) === '');
  check('still one connection on the run', server.asked.events === 1, server.asked.events);
  await shot('02b-steered');

  // ── It ends ──────────────────────────────────────────────────────────────
  emit('tool.result', { id: 'call-1', ok: true, output: 'done' });
  emit('text.delta', { text: `\n\n${CLOSING}` });
  check('later text arrives', await waitFor(`${TRANSCRIPT}.includes(${JSON.stringify(CLOSING)})`, 10000));
  server.history[server.history.length - 1] = {
    role: 'assistant', text: `${OPENING}\n\n${CLOSING}`, model: 'Test model', created_at: ago(0),
    tools: [{ name: 'run_command', arguments: { command: 'python sleep.py' }, ok: true, state: 'done', text_offset: OPENING.length }],
  };
  server.busy = false;
  endRun();
  check('the session is free again', await waitFor('!S.remoteBusy.has(S.current) && S.watching.size === 0', 15000));
  const after = await js(TRANSCRIPT);
  check('the saved turn replaces what was drawn, once', count(after, OPENING) === 1 && count(after, CLOSING) === 1 && count(after, PROMPT) === 1,
    `${count(after, OPENING)}/${count(after, CLOSING)}/${count(after, PROMPT)}`);
  check('the working line is gone', !(await js('Boolean(document.querySelector(".working.remote"))')));
  check('the prompt box is for a new message again', !/steer/i.test(await js('$("prompt").placeholder')), await js('$("prompt").placeholder'));
  await sleep(4000);
  check('the ended run is not asked for again', server.asked.events === 1, server.asked.events);
  check('its connection is closed', server.open.size === 0, server.open.size);
  await shot('03-ended');

  // ── A run whose events cannot be read ────────────────────────────────────
  // The session still says "busy": the window only waits, and asks a few times at most.
  server.sent = [];
  server.eventsStatus = 404;
  server.asked.events = 0;
  server.history.push({ role: 'user', text: 'Another one', files: [], steers: [], created_at: ago(0) });
  server.busy = true;
  server.runId = 'RunWebTurn000002';
  await js('checkCurrentSession(); true');
  check('the window says it waits', await waitFor(`S.remoteBusy.has(S.current) && ${HINT}.length > 0`, 10000));
  await sleep(30000);
  check('a run that cannot be followed is asked for a few times, not for ever',
    server.asked.events >= 1 && server.asked.events <= 3, `asked ${server.asked.events} times in 30 seconds`);
  check('the window falls back to waiting for the end', await js(HINT) === 'This view updates when it finishes', await js(HINT));
  check('the other client\'s message is still shown', (await js(TRANSCRIPT)).includes('Another one'));
  server.history.push({ role: 'assistant', text: 'Second answer.', model: 'Test model', tools: [], created_at: ago(0) });
  server.busy = false;
  server.runId = null;
  check('and shows the answer when it ends', await waitFor(`${TRANSCRIPT}.includes("Second answer.")`, 15000));
  await shot('04-not-followed');
}

try {
  await run();
} catch (err) {
  check('the test ran to its end', false, err.stack || err.message);
} finally {
  try { ws && ws.close(); } catch { /* closing anyway */ }
  child.kill();
  fake.closeAllConnections();
  fake.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still held by the app for a moment */ }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
