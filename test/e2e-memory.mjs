// The real app, end to end, on the sessions it keeps in memory. Its own
// profile and a scripted API (scripts/promo/mock-api.cjs), so no account or
// key is used; the window is driven through the DevTools protocol.
//
// - eight long sessions opened: each read from the server once; the five
//   opened last stay as they are, the others are packed, and opening one
//   again asks the server for nothing;
// - pictures in the folder come through cf-local:, made smaller when large;
// - a real run (files written, the browser tool) in a session that is then
//   packed: reopened, it still has its edited-files card, whose Undo works;
// - the browser pane's page is closed two minutes after the pane is, and
//   loaded again when the pane opens.
//   node test/e2e-memory.mjs            (about three minutes: the pane waits)
//   node test/e2e-memory.mjs --quick    (without the browser pane's wait)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createMock } = require('../scripts/promo/mock-api.cjs');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUICK = process.argv.includes('--quick');
const PORT = 9350 + Math.floor(Math.random() * 40);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

// ── A PNG, written by hand: a chart the agent left in the folder ──────────
function png(width, height, seed) {
  const row = Buffer.alloc(1 + width * 3);
  const rows = [];
  for (let y = 0; y < height; y++) {
    row[0] = 0;
    for (let x = 0; x < width; x++) row.set([(x + seed * 40) % 256, (y * 2) % 256, 160], 1 + x * 3);
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// ── The folder, the sessions, the scripted turn ───────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-e2e-memory-profile-'));
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-e2e-memory-folder-'));
fs.mkdirSync(path.join(folder, 'out'));
for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(folder, 'out', `chart${i}.png`), png(1600, 900, i));

const page = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  // Busy enough that its screenshot is smaller as a JPEG, as a real app's is.
  res.end(`<!doctype html><title>Dev app</title><body style="background:linear-gradient(120deg,#f6a,#6af);font:16px sans-serif">
    <h1>Dev app</h1>${'<p>Running, with a list of things to show and a gradient behind them.</p>'.repeat(12)}
    <script>setInterval(() => {}, 100)</script>`);
});
await new Promise((resolve) => page.listen(0, '127.0.0.1', resolve));
const pageUrl = `http://localhost:${page.address().port}/`;

const code = Array.from({ length: 16 }, (_, i) => `const value${i} = compute(${i}); // step ${i}`).join('\n');
function history(id, turns) {
  const messages = [];
  for (let t = 0; t < turns; t++) {
    const at = (m) => new Date(Date.UTC(2026, 9, 20, 8, 0, 0) + (t * 2 + m) * 60000).toISOString();
    messages.push({ role: 'user', text: `${id} turn ${t}: refactor the parser and explain the change`, created_at: at(0), files: [] });
    const pictures = id === 'e0' && t === turns - 1
      ? '\n\n![chart one](out/chart1.png)\n\n![chart two](out/chart2.png)\n\n![chart three](out/chart3.png)' : '';
    messages.push({
      role: 'assistant', created_at: at(1), model: 'claude-sonnet-5-5', usage: { credits: 0.5 },
      text: `Turn ${t} of ${id}: the parser now validates its input.\n\n\`\`\`js\n${code}\n\`\`\`\n\nAll tests pass.${pictures}`,
      tools: [
        { name: 'fs_read', arguments: { path: 'src/parser.js' }, ok: true, text_offset: 0 },
        { name: 'run_command', arguments: { command: 'npm test' }, ok: true, text_offset: 0 },
      ],
    });
  }
  return messages;
}
const IDS = ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'];
const seeded = IDS.map((id, i) => ({ id, title: `Long session ${i}`, ago: 10 + i * 5, messages: history(id, 60) }));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#4a8"/></svg>';
const turns = [{
  match: 'memory test turn',
  steps: [
    { say: 'Writing the notes and a drawing.\n\n' },
    { tool: 'fs_write', args: { path: 'out/notes.md', content: '# Notes\n\nWritten by the run.\n' } },
    { tool: 'fs_write', args: { path: 'out/shape.svg', content: SVG } },
    { tool: 'browser', args: { action: 'navigate', url: pageUrl } },
    { tool: 'browser', args: { action: 'screenshot' } },
    { say: 'Here they are:\n\n![shape](out/shape.svg)\n\n![chart four](out/chart4.png)\n\nDone.' },
  ],
}];
const mock = createMock({ turns, sessions: seeded, speed: 4 });
const base = await mock.listen();
const reads = (id) => mock.log.filter((line) => line === `GET /sessions/${id}/messages`).length;
const allReads = () => mock.log.filter((line) => /^GET \/sessions\/[^/]+\/messages$/.test(line)).length;

fs.writeFileSync(path.join(profile, 'state.json'), JSON.stringify({
  autoUpdate: false, permissionMode: 'auto', notifications: false,
  sessions: Object.fromEntries(IDS.map((id, i) => [id, { cwd: folder, label: `Long session ${i}` }])),
}));

const app = spawn(path.join(repo, 'node_modules/electron/dist/electron.exe'),
  // A window covered by others still draws, so a page in it can be captured.
  ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  { cwd: repo, stdio: 'ignore', env: { ...process.env, CODINGFLEET_API_BASE: base, CODINGFLEET_API_KEY: 'cf_sk_e2e_memory_0000' } });

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const opened = new Promise((resolve) => { ws.onopen = resolve; });
  const js = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) {
      throw new Error(`${res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text}\n  in: ${expression.slice(0, 160)}`);
    }
    return res.result.result.value;
  };
  return { opened, js, send, errors, close: () => ws.close() };
}

const until = async (w, expression, ms = 15000) => {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await w.js(expression)) return true;
    await sleep(150);
  }
  return false;
};

let w;
try {
  let main = null;
  for (let i = 0; i < 80 && !main; i++) {
    await sleep(500);
    main = (await targets()).find((t) => t.type === 'page' && /renderer\/index\.html/.test(t.url));
  }
  if (!main) throw new Error('The window did not come up.');
  w = connect(main.webSocketDebuggerUrl);
  await w.opened;
  await w.send('Runtime.enable');
  check('the window lists the eight sessions', await until(w, `typeof S !== 'undefined' && S.sessions.length >= 8`, 30000));
  await w.js(`window.dataOf = (value) => JSON.stringify(value, (key, v) => {
    if (v && typeof v === 'object' && typeof v.nodeType === 'number') return undefined;
    if (key === 'group' && v && v.type === 'tools') return undefined;
    if (v instanceof Set) return [...v];
    return v;
  }); true`);

  // ── Eight sessions, each read once ──
  let e0 = null;
  for (const id of IDS) {
    await w.js(`selectSession(${JSON.stringify(id)})`);
    await until(w, `S.loaded.has(${JSON.stringify(id)}) && !S.loading.has(${JSON.stringify(id)})`);
    if (id === 'e0') {
      await until(w, `[...document.querySelectorAll('.markdown img[data-local]')].every((img) => img.complete && img.naturalWidth)`, 8000);
      e0 = await w.js(`({
        data: dataOf(S.transcripts.get('e0')),
        prompts: document.querySelectorAll('#column .msg.user').length,
        images: [...document.querySelectorAll('.markdown img[data-local]')].map((img) => [img.src.slice(0, 18), img.naturalWidth, img.naturalHeight]),
      })`);
    }
  }
  check('each session was read from the server once', IDS.every((id) => reads(id) === 1), IDS.map(reads).join(','));
  check('a long session is drawn from its newest 30 turns', e0.prompts === 30, `${e0.prompts} prompts drawn`);
  check('pictures in the folder come through cf-local:, made smaller', JSON.stringify(e0.images)
    === JSON.stringify([['cf-local://image/?', 1400, 788], ['cf-local://image/?', 1400, 788], ['cf-local://image/?', 1400, 788]]),
  JSON.stringify(e0.images));

  await sleep(2500);
  let memory = await w.js('sessionMemory()');
  check('the five opened last stay as they are', JSON.stringify([...memory.live].sort()) === JSON.stringify(['e3', 'e4', 'e5', 'e6', 'e7']),
    memory.live.join(','));
  check('the other three are packed', JSON.stringify([...memory.packed].sort()) === JSON.stringify(['e0', 'e1', 'e2']),
    `${memory.packed.join(',')}: ${memory.packedBytes} bytes for ${memory.packedChars} characters`);

  // ── A packed session, opened again ──
  const before = allReads();
  await w.js(`selectSession('e0')`);
  await until(w, `S.loaded.has('e0')`);
  await until(w, `[...document.querySelectorAll('.markdown img[data-local]')].every((img) => img.complete && img.naturalWidth)`, 8000);
  const again = await w.js(`({ data: dataOf(S.transcripts.get('e0')),
    images: document.querySelectorAll('.markdown img[data-local]').length,
    drawn: [...document.querySelectorAll('.markdown img[data-local]')].every((img) => img.naturalWidth === 1400) })`);
  check('opened again from memory, with no request', allReads() === before, `${allReads() - before} requests`);
  check('and it is the same conversation', again.data === e0.data);
  check('with its pictures', again.images === 3 && again.drawn);

  // ── A real run, in a session that is then packed ──
  await w.js(`selectSession('e5')`);
  await until(w, `S.loaded.has('e5')`);
  // In front, so the page the run opens can be captured.
  await w.send('Page.bringToFront');
  await w.js(`$('prompt').value = 'memory test turn'; sendMessage()`);
  check('the run started', await until(w, `S.running.has('e5')`, 10000));
  check('and finished', await until(w, `!S.running.has('e5') && transcriptOf('e5').some((i) => i.type === 'files')`, 60000));
  await until(w, `[...document.querySelectorAll('.markdown img[data-local]')].filter((img) => img.complete && img.naturalWidth).length >= 5`, 8000);
  const ran = await w.js(`(() => {
    const items = transcriptOf('e5');
    const files = items.find((i) => i.type === 'files');
    const shot = items.filter((i) => i.type === 'tools').flatMap((g) => g.tools).find((t) => t.image);
    const shown = [...document.querySelectorAll('.markdown img[data-local]')].slice(-2).map((img) => [img.dataset.localPath, img.naturalWidth]);
    const browser = items.filter((i) => i.type === 'tools').flatMap((g) => g.tools).filter((t) => t.name === 'browser')
      .map((t) => [t.arguments.action, t.status, Boolean(t.image), String(typeof t.output === 'string' ? t.output : (t.output && t.output.text) || '').slice(0, 100)]);
    return { files: files && files.files.map((f) => f.path), runId: files && files.runId, shot: shot && shot.image.slice(0, 23),
      shotChars: shot && shot.image.length, shown, card: Boolean(document.querySelector('.files-card .undo-button')), browser };
  })()`);
  check('it wrote its files, and the card says so', JSON.stringify(ran.files) === JSON.stringify(['out/notes.md', 'out/shape.svg']) && ran.card,
    JSON.stringify(ran.files));
  check('the browser tool\'s screenshot is kept as a JPEG', ran.shot === 'data:image/jpeg;base64,',
    `${ran.shot} (${ran.shotChars} characters) ${JSON.stringify(ran.browser)}`);
  check('the drawing and the chart it wrote about are shown', JSON.stringify(ran.shown) === JSON.stringify([['out/shape.svg', 200], ['out/chart4.png', 1400]]),
    JSON.stringify(ran.shown));

  const afterRun = allReads();
  for (const id of ['e0', 'e1', 'e2', 'e3', 'e4', 'e6']) {
    await w.js(`selectSession(${JSON.stringify(id)})`);
    await until(w, `S.loaded.has(${JSON.stringify(id)})`);
  }
  await sleep(2500);
  check('the session of the run is packed in its turn', await w.js(`isPacked('e5')`));
  await w.js(`selectSession('e5')`);
  await until(w, `S.loaded.has('e5')`);
  await sleep(300);
  const back = await w.js(`(() => {
    const items = transcriptOf('e5');
    const files = items.find((i) => i.type === 'files');
    return { files: files && files.files.length, runId: files && files.runId, card: Boolean(document.querySelector('.files-card .undo-button')),
      last: items.filter((i) => i.type === 'assistant').at(-1).text.includes('Here they are') };
  })()`);
  check('reopened: the edited-files card is still there, with its Undo', back.files === 2 && back.runId === ran.runId && back.card, JSON.stringify(back));
  check('and the turn as it was drawn', back.last);
  check('no history was read again after the run', allReads() - afterRun === 0, `${allReads() - afterRun} reads`);
  await w.js(`document.querySelector('.files-card .undo-button').click()`);
  await until(w, `[...document.querySelectorAll('.confirm-overlay button')].some((b) => b.textContent === 'Undo the run')`, 4000);
  await w.js(`[...document.querySelectorAll('.confirm-overlay button')].find((b) => b.textContent === 'Undo the run').click()`);
  const undone = await until(w, `/Undone/.test(document.querySelector('.files-card').textContent)`, 8000);
  const cardText = await w.js(`document.querySelector('.files-card').textContent + ' | ' + (document.querySelector('.banner:not([hidden])') || {}).textContent`);
  check('Undo from the reopened card puts the files back', undone
    && !fs.existsSync(path.join(folder, 'out', 'notes.md')) && !fs.existsSync(path.join(folder, 'out', 'shape.svg')),
  `${cardText.slice(0, 240)}; notes.md there: ${fs.existsSync(path.join(folder, 'out', 'notes.md'))}`);

  // ── The browser pane, closed ──
  if (!QUICK) {
    const pageTarget = async () => (await targets()).some((t) => t.type === 'page' && t.url === pageUrl);
    check('the run left its page in the browser pane', await pageTarget());
    await w.js('closeTerminalPanel()');
    await sleep(60_000);
    check('a minute after the pane closed, the page is still there', await pageTarget());
    await sleep(65_000);
    check('two minutes after, it is closed', !(await pageTarget()));
    check('and the pane still knows its address', await w.js(`BROWSER.state.url === ${JSON.stringify(pageUrl)}`));
    await w.js('openBrowserPanel({ focus: false })');
    let back2 = false;
    for (let i = 0; i < 40 && !back2; i++) { await sleep(250); back2 = await pageTarget(); }
    check('opening the pane loads it again', back2);
  }

  check(`no errors in the window${w.errors.length ? `: ${w.errors.join(' | ')}` : ''}`, w.errors.length === 0);
} catch (err) {
  check(`the test ran to its end: ${err.stack}`, false);
} finally {
  if (w) w.close();
  try { execFileSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  mock.close();
  page.close();
  await sleep(1500);
  for (const dir of [profile, folder]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* locked */ } }
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} of ${results.length} checks FAILED` : `\nAll ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
