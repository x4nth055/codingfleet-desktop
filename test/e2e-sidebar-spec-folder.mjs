// Live check of the sidebar: a cloud session built from a spec sits in a
// folder of its own, named after the spec, with a + that starts a session on it.
//
//   CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 CODINGFLEET_API_KEY=<desktop key> node test/e2e-sidebar-spec-folder.mjs
//
// Makes one spec (standard image, never built) and two sessions that never
// run: no credits. Deletes them after.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../src/core/api.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_CDP_PORT || 9336);
const SHOTS = process.env.E2E_SHOTS || '';
const TAG = `e2e-${Date.now().toString(36)}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  - ${String(detail).slice(0, 300)}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

api.configure({ apiBase: process.env.CODINGFLEET_API_BASE, apiKey: process.env.CODINGFLEET_API_KEY });
const spec = await api.createSandboxSpec({ name: `Spec ${TAG}` });
const onSpec = await api.createSession({ sandbox_spec: spec.id });
const plain = await api.createSession({});

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sidebar-'));
const electron = require('electron');
const child = spawn(electron, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], {
  cwd: root, env: { ...process.env }, stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.on('data', () => {});

let ws;
let seq = 0;
const pending = new Map();
async function connect() {
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    if (!ws) await sleep(500);
  }
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
async function waitFor(expression, timeout = 30000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      last = await js(expression);
      if (last) return last;
    } catch (err) { last = err.message; }
    await sleep(300);
  }
  return last ?? false;
}

const heads = `[...document.querySelectorAll('#sessionList .group-head')]`;
const head = (name) => `${heads}.find((h) => h.querySelector('.group-name').textContent === ${JSON.stringify(name)})`;
const rowsUnder = (name) => `(() => {
  const ids = []; let n = ${head(name)}; if (!n) return null;
  for (n = n.nextElementSibling; n && !n.classList.contains('group-head'); n = n.nextElementSibling) ids.push(n.dataset.id);
  return ids; })()`;

try {
  await connect();
  await send('Runtime.enable');
  await waitFor('typeof S !== "undefined" && S.settings && S.settings.hasKey && S.sessions && S.sessions.length', 40000);
  check('the spec has a folder of its own, named after it', await waitFor(`Boolean(${head(`Spec ${TAG}`)})`, 20000));
  const inSpec = await js(rowsUnder(`Spec ${TAG}`));
  check('its session is in it', Array.isArray(inSpec) && inSpec.includes(onSpec.id), inSpec);
  const inCloud = await js(rowsUnder('Cloud sandbox')) || [];
  check('a session with no spec stays under Cloud sandbox', inCloud.includes(plain.id) && !inCloud.includes(onSpec.id), inCloud);
  check('the folder shows the spec icon and a +', await js(`(() => { const h = ${head(`Spec ${TAG}`)};
    return Boolean(h.querySelector('.group-icon') && h.querySelector('.group-add')); })()`));
  if (SHOTS) {
    await js(`(${head(`Spec ${TAG}`)}).scrollIntoView(); true`);
    const res = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, 'sidebar-spec-folder.png'), Buffer.from(res.result.data, 'base64'));
  }
  await js(`(${head(`Spec ${TAG}`)}).querySelector('.group-add').click(); true`);
  check('+ starts a new cloud session on the spec', await waitFor(
    `S.current === null && S.draftSandbox === true && draftSpecId() === ${JSON.stringify(spec.id)}`, 5000));
  await js(`(${head(`Spec ${TAG}`)}).click(); true`);
  check('the folder folds', await waitFor(`(${rowsUnder(`Spec ${TAG}`)} || [1]).length === 0`, 5000));
  await js(`(${head(`Spec ${TAG}`)}).click(); true`);
} catch (err) {
  check('the run finished', false, err.stack || err.message);
} finally {
  // The draft spec is kept on this computer: put it back to none.
  try { await js('setDraftSpec(null); true'); } catch { /* window gone */ }
  child.kill();
  for (const id of [onSpec.id, plain.id]) await api.deleteSession(id).catch(() => {});
  await api.deleteSandboxSpec(spec.id).catch((err) => console.log('spec cleanup:', err.message));
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
}
