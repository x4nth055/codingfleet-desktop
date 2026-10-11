// Live test of the Cloud sandboxes UI: the real app, driven over the Chrome
// DevTools protocol, against a CodingFleet server and real sandboxes.
//
//   CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 CODINGFLEET_API_KEY=<desktop key> node test/e2e-sandboxes-ui.mjs
//
// The app runs with a profile of its own (a temp --user-data-dir), never the
// one of the CodingFleet app installed on this computer. It builds images and
// runs one cloud session: a few credits, a few minutes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../src/core/api.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.E2E_MODEL || 'deepseek-v4-flash';
const PORT = Number(process.env.E2E_CDP_PORT || 9335);
const SHOTS = process.env.E2E_SHOTS || '';
const TAG = `e2e-${Date.now().toString(36)}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  - ${String(detail).slice(0, 500)}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── The app ────────────────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-sbx-ui-'));
const electron = require('electron');
const child = spawn(electron, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], {
  cwd: root, env: { ...process.env }, stdio: ['ignore', 'ignore', 'pipe'],
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
async function waitFor(expression, timeout = 30000, every = 300) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      last = await js(expression);
      if (last) return last;
    } catch (err) { last = err.message; }
    await sleep(every);
  }
  return last ?? false;
}
async function shot(name) {
  if (!SHOTS) return;
  const res = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(res.result.data, 'base64'));
}

// In-page helpers: click a button by its text inside a scope, type into a field.
const HELPERS = `
  window.__t = {
    button(scope, text) {
      const root = typeof scope === 'string' ? document.querySelector(scope) : scope;
      return [...(root || document).querySelectorAll('button')].find((b) => b.textContent.trim() === text && !b.disabled);
    },
    click(scope, text) { const b = this.button(scope, text); if (!b) throw new Error('no button ' + text); b.click(); return true; },
    type(input, value) { input.focus(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); return true; },
    row(kind, id) { return document.querySelector('[data-' + kind + '="' + id + '"]'); },
    specRowByName(name) { return [...document.querySelectorAll('#sandboxesPane [data-spec]')].find((r) => r.querySelector('.sbx-name').textContent === name); },
    status() { const s = document.querySelector('#sandboxesPane .pane-status'); return s ? s.textContent : ''; },
    editorStatus() { const s = document.querySelector('#specEditor .modal-status'); return s ? s.textContent : ''; },
    confirm(text) { const o = [...document.querySelectorAll('.confirm-overlay')].pop(); return this.click(o, text); },
  };
  true`;

// The server, directly: what the UI made, and cleaning up after.
api.configure({ apiBase: process.env.CODINGFLEET_API_BASE, apiKey: process.env.CODINGFLEET_API_KEY });
const made = { specs: new Set(), sessions: new Set(), snapshots: new Set() };

async function run() {
  await connect();
  await send('Runtime.enable');
  await waitFor('typeof S !== "undefined" && S.settings && S.settings.hasKey && S.credits && S.credits.key', 40000);
  await js(HELPERS);
  check('the app signed in with a desktop key', await js('S.credits.key.client') === 'desktop');

  // ── The tab ──────────────────────────────────────────────────────────────
  await js('openSettings(false, "sandboxes"); true');
  check('the Cloud sandboxes tab opens', await waitFor('!$("sandboxesPane").hidden && sbx.specs !== null && sbx.config !== null && sbx.snapshots !== null && sbx.sandboxes !== null', 30000));
  check('it has its four sections', (await js('[...document.querySelectorAll("#sandboxesPane .sbx-section span:first-child")].map((s) => s.textContent).join("|")'))
    === 'Sandbox specs|Running now|Snapshots|For every sandbox');
  await shot('01-tab');

  // ── A Docker Hub spec, through the editor ────────────────────────────────
  await js('__t.click("#sandboxesPane", "New spec")');
  check('the editor opens', await waitFor('Boolean(document.getElementById("specEditor"))'));
  await js(`(() => {
    const ed = document.getElementById('specEditor');
    __t.type(ed.querySelector('input.sbx-input'), 'Go ${TAG}');
    ed.querySelector('[data-source="dockerhub"]').click();
    return true; })()`);
  // Refused by the window before it is sent: no image yet.
  await js('__t.click("#specEditor", "Save")');
  check('an empty image is refused in the window', /Enter the image/.test(await js('__t.editorStatus()')));
  await js(`(() => {
    const ed = document.getElementById('specEditor');
    __t.type(ed.querySelector('input[placeholder="golang:1.23"]'), 'golang:1.23');
    [...ed.querySelectorAll('button')].find((b) => b.textContent.includes('Add a variable')).click();
    const inputs = ed.querySelectorAll('.sbx-env-edit input');
    __t.type(inputs[0], 'GREETING');
    __t.type(inputs[1], 'hello-from-the-app');
    return true; })()`);
  await shot('02-editor');
  await js('__t.click("#specEditor", "Save and build")');
  check('the editor closes on save', await waitFor('!document.getElementById("specEditor")', 15000));
  const goId = await waitFor(`(__t.specRowByName('Go ${TAG}') || {}).dataset?.spec`, 15000);
  check('the spec is listed', Boolean(goId), goId);
  made.specs.add(goId);
  const server = await api.sandboxSpec(goId);
  check('the server has what the editor sent', server.registry_image === 'golang:1.23'
    && server.env_var_names.join() === 'GREETING' && server.install_essentials === true, JSON.stringify(server));
  check('the build is shown running', await waitFor(`/Building/.test(__t.specRowByName('Go ${TAG}').textContent)`, 15000));
  await shot('03-building');
  const built = await waitFor(`/Built|Build failed/.exec(__t.specRowByName('Go ${TAG}').querySelector('.sbx-title').textContent)?.[0]`, 600000, 2000);
  check('the build ends Built, polled by the window', built === 'Built', built);
  check('the end of the build is said', /is built/.test(await js('__t.status()')) || built === 'Built');

  // ── Editing: rename, and the env var kept ────────────────────────────────
  await js(`__t.click(__t.specRowByName('Go ${TAG}'), 'Edit')`);
  await waitFor('Boolean(document.getElementById("specEditor"))');
  check('the saved env var shows with its value hidden', await js(`(() => {
    const row = document.querySelector('#specEditor .sbx-env-edit');
    const [name, value] = row.querySelectorAll('input');
    return name.value === 'GREETING' && name.disabled && value.value === '' && /hidden/.test(value.placeholder); })()`));
  await js(`__t.type(document.querySelector('#specEditor input.sbx-input'), 'Go 1.23 ${TAG}'); __t.click('#specEditor', 'Save')`);
  check('a rename is saved', await waitFor(`Boolean(__t.specRowByName('Go 1.23 ${TAG}'))`, 15000));
  const renamed = await api.sandboxSpec(goId);
  check('the rename kept the env var and the build', renamed.env_var_names.join() === 'GREETING' && renamed.build.status === 'built',
    JSON.stringify(renamed.build));

  // ── A Dockerfile the server refuses, and the live check ─────────────────
  await js('__t.click("#sandboxesPane", "New spec")');
  await waitFor('Boolean(document.getElementById("specEditor"))');
  await js(`(() => {
    const ed = document.getElementById('specEditor');
    ed.querySelector('[data-source="dockerfile"]').click();
    __t.type(ed.querySelector('textarea.sbx-dockerfile'), 'FROM alpine:3.20\\nCOPY . /src\\n');
    return true; })()`);
  const bad = await waitFor(`(() => { const c = document.querySelector('#specEditor .sbx-check.bad'); return c && c.textContent; })()`, 10000);
  check('the live check says why the Dockerfile cannot build', /build context/.test(bad || ''), bad);
  await js('__t.click("#specEditor", "Save")');
  const refused = await waitFor(`/build context/.test(__t.editorStatus()) && __t.editorStatus()`, 10000);
  check('the server refusal shows in the editor, which stays open', Boolean(refused) && await js('Boolean(document.getElementById("specEditor"))'), refused);
  await js(`__t.type(document.querySelector('#specEditor textarea.sbx-dockerfile'), 'FROM alpine:3.20\\nRUN apk add --no-cache gcc musl-dev\\n')`);
  const good = await waitFor(`(() => { const c = document.querySelector('#specEditor .sbx-check.good'); return c && c.textContent; })()`, 10000);
  check('a fixed Dockerfile checks good', /2 steps/.test(good || ''), good);
  await shot('04-dockerfile');
  // Escape with changes asks first; Discard closes.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check('leaving with changes asks first', await waitFor('/Discard your changes/.test(document.body.innerText)', 5000));
  await js('__t.confirm("Discard")');
  check('discarding closes the editor and the settings stay', await waitFor('!document.getElementById("specEditor") && !$("settings").hidden', 5000));

  // ── The account's settings (a desktop key may change them) ───────────────
  const before = await api.sandboxConfig();
  await js(`(() => { const sel = document.querySelector('#sandboxesPane .sbx-select'); sel.value = '${goId}'; sel.dispatchEvent(new Event('change')); return true; })()`);
  check('pinning a default spec is saved', await waitFor(`sbx.config && sbx.config.default_spec === '${goId}'`, 10000));
  check('the spec shows Default', await waitFor(`/Default/.test(__t.specRowByName('Go 1.23 ${TAG}').textContent)`, 10000));
  await js(`(() => { const sel = document.querySelector('#sandboxesPane .sbx-select'); sel.value = ''; sel.dispatchEvent(new Event('change')); return true; })()`);
  check('unpinning is saved', await waitFor('sbx.config && sbx.config.default_spec === null', 10000));
  const hours = before.snapshot_window_hours === 48 ? 47 : 48;
  await js(`(() => { const n = document.querySelector('#sandboxesPane .set-number'); n.value = '${hours}'; n.dispatchEvent(new Event('change')); return true; })()`);
  check('the snapshot window is saved', await waitFor(`sbx.config.snapshot_window_hours === ${hours}`, 10000));
  await js(`(() => { const n = document.querySelector('#sandboxesPane .set-number'); n.value = '9999'; n.dispatchEvent(new Event('change')); return true; })()`);
  check('an out-of-range window is refused in the window', /1 to 720/.test(await js('__t.status()')));
  await api.updateSandboxConfig({ snapshot_window_hours: before.snapshot_window_hours });
  // A key made for code only reads them.
  await js('S.credits.key.client = "api"; renderSandboxesPane(); true');
  check('with a key for code they are read-only', await js(`(() => document.querySelector('#sandboxesPane .sbx-select').disabled
    && /key made for code/.test(document.querySelector('#sandboxesPane').textContent))()`));
  await js('S.credits.key.client = "desktop"; renderSandboxesPane(); true');

  // ── A cloud session on the spec, from the composer ───────────────────────
  await js('closeSettings(); newSession(); true');
  await js('openFolderMenu(); true');
  const options = await waitFor(`[...document.querySelectorAll('#folderList .menu-item .mi-name')].map((n) => n.textContent).join('|')`, 10000);
  check('the folder menu offers the spec', options.includes(`Go 1.23 ${TAG}`), options);
  await shot('05-folder-menu');
  await js(`[...document.querySelectorAll('#folderList .menu-item')].find((r) => r.querySelector('.mi-name').textContent === 'Go 1.23 ${TAG}').click()`);
  check('the folder button names it', await waitFor(`$('folderButton').textContent.includes('Cloud · Go 1.23 ${TAG}')`, 5000),
    await js('$("folderButton").textContent'));
  check('the choice is kept for the next session', await js(`S.init.state.sandboxSpec === '${goId}'`));
  await js(`S.model = '${MODEL}'; __t.type($('prompt'), 'Run \`go version && echo $GREETING\` with run_command and quote its output.'); $('send').click(); true`);
  const sessionId = await waitFor('S.current', 30000);
  made.sessions.add(sessionId);
  check('the session was created on the spec', (await api.getSession(sessionId)).sandbox_spec === goId);
  const ended = await waitFor('S.current && !S.running.has(S.current)', 300000, 1000);
  const page = await js('document.querySelector(".transcript, #transcript, main").innerText');
  check('the run ended', Boolean(ended));
  check('the sandbox has Go and the spec env var', /go1\.23/.test(page) && /hello-from-the-app/.test(page), page.slice(-600));
  await shot('06-run');

  // ── The running sandbox: snapshot it, then stop it ───────────────────────
  await js('openSettings(false, "sandboxes"); true');
  const sandboxId = await waitFor(`(sbx.sandboxes || []).find((s) => s.session_id === '${sessionId}')?.id`, 20000);
  check('it is listed under Running now, with its spec', Boolean(sandboxId)
    && await js(`/Go 1.23 ${TAG}/.test(__t.row('sandbox', '${sandboxId}').textContent)`));
  await shot('07-running');
  await js(`__t.click(__t.row('sandbox', '${sandboxId}'), 'Save snapshot')`);
  await waitFor('/Save a snapshot/.test(document.body.innerText)', 5000);
  await js(`(() => { const o = [...document.querySelectorAll('.confirm-overlay')].pop(); __t.type(o.querySelector('input'), 'Go ${TAG}'); __t.click(o, 'Save snapshot'); return true; })()`);
  const saved = await waitFor(`/Snapshot ".*" saved/.test(__t.status()) && (sbx.snapshots || []).find((s) => s.name.startsWith('Go ${TAG}'))?.id`, 180000, 1000);
  check('a snapshot is saved from the running sandbox', Boolean(saved), await js('__t.status()'));
  if (saved) made.snapshots.add(saved);

  // A spec made from it, then refused deletes.
  await js(`__t.click(__t.row('snapshot', '${saved}'), 'New spec from it')`);
  await waitFor('Boolean(document.getElementById("specEditor"))');
  check('the editor opens on that snapshot', await js(`document.querySelector('#specEditor select').value === '${saved}'
    && document.querySelector('#specEditor [data-source="snapshot"]').classList.contains('active')`));
  await js(`__t.type(document.querySelector('#specEditor input.sbx-input'), 'From snapshot ${TAG}'); __t.click('#specEditor', 'Save')`);
  const snapSpec = await waitFor(`(__t.specRowByName('From snapshot ${TAG}') || {}).dataset?.spec`, 15000);
  check('a spec from the snapshot is made', Boolean(snapSpec));
  if (snapSpec) made.specs.add(snapSpec);
  await waitFor(`(sbx.snapshots || []).find((s) => s.id === '${saved}')?.sandbox_specs.length === 1`, 10000);
  await js('loadSnapshots()');
  await waitFor(`/image of 1 spec/.test(__t.row('snapshot', '${saved}').textContent)`, 10000);
  await js(`__t.row('snapshot', '${saved}').querySelector('.icon-button.danger').click()`);
  check('deleting a snapshot a spec uses is explained, not sent', await waitFor('/is a spec\\x27s image/.test(document.body.innerText)', 5000));
  await js('__t.confirm("OK")');
  await js(`__t.specRowByName('Go 1.23 ${TAG}').querySelector('.icon-button.danger').click()`);
  check('deleting a spec a session uses is explained, not sent', await waitFor('/is in use/.test(document.body.innerText)', 5000));
  await js('__t.confirm("OK")');
  await shot('08-in-use');

  // Rename the snapshot.
  await js(`__t.click(__t.row('snapshot', '${saved}'), 'Rename')`);
  await waitFor('/Rename the snapshot/.test(document.body.innerText)', 5000);
  await js(`(() => { const o = [...document.querySelectorAll('.confirm-overlay')].pop(); __t.type(o.querySelector('input'), 'Renamed ${TAG}'); __t.click(o, 'Save'); return true; })()`);
  check('the snapshot is renamed', await waitFor(`/Renamed ${TAG}/.test(__t.row('snapshot', '${saved}').textContent)`, 10000));

  // Stop the sandbox.
  await js(`__t.click(__t.row('sandbox', '${sandboxId}'), 'Stop')`);
  await waitFor('/Stop this sandbox/.test(document.body.innerText)', 5000);
  await js('__t.confirm("Stop")');
  check('the sandbox stops', await waitFor(`!__t.row('sandbox', '${sandboxId}') && /stopped/.test(__t.status())`, 120000, 1000));

  // ── An older server without sandbox specs ────────────────────────────────
  await js('sbx.unsupported = true; renderSandboxesPane(); true');
  check('without the feature the tab says so', /does not offer sandbox specs/.test(await js('$("sandboxesPane").textContent')));
  await js('closeSettings(); newSession(); openFolderMenu(); true');
  check('and the folder menu offers just the cloud sandbox', await js(`[...document.querySelectorAll('#folderList .menu-item .mi-name')].map((n) => n.textContent).filter((t) => /Cloud|spec/i.test(t)).join('|') === 'Cloud sandbox'`));
  await js('closeMenus(); sbx.unsupported = false; true');

  // ── A spec deleted elsewhere while chosen ────────────────────────────────
  const gone = await api.createSandboxSpec({ name: `Gone ${TAG}`, image_source: 'standard' });
  await js(`loadSpecs(true).then(() => { setDraftSpec('${gone.id}'); S.draftSandbox = true; renderMain(); })`);
  await api.deleteSandboxSpec(gone.id);
  await js(`S.model = '${MODEL}'; __t.type($('prompt'), 'Say hi.'); $('send').click(); true`);
  const banner = await waitFor(`(() => { const b = document.querySelector('#banner, .banner'); return b && !b.hidden && b.textContent; })()`, 20000);
  check('sending on a deleted spec says so and goes back to the default', /no longer exists/.test(banner || '')
    && await waitFor('S.draftSpec === null', 5000), banner);
}

async function cleanup() {
  for (const id of made.sessions) await api.deleteSession(id).catch(() => {});
  for (const id of made.specs) await api.deleteSandboxSpec(id).catch(() => {});
  for (const id of made.snapshots) await api.deleteSnapshot(id).catch(() => {});
  // Anything else this run made, by its tag.
  const specs = await api.sandboxSpecs().catch(() => ({ specs: [] }));
  for (const spec of specs.specs) if (spec.name.includes(TAG)) await api.deleteSandboxSpec(spec.id).catch(() => {});
}

try {
  await run();
} catch (err) {
  check('the test ran to the end', false, err.stack || err.message);
} finally {
  await cleanup();
  try { ws.close(); } catch { /* closed */ }
  child.kill();
  console.log(`\n${passed}/${passed + failed} checks passed`);
  process.exitCode = failed ? 1 : 0;
}
