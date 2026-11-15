'use strict';
// Live end-to-end test of project memory: the real main process and a real
// model, against a running API. The agent saves what it is told to remember
// as files, a later session in the folder finds it, a write to the memory
// folder never waits for an approval while any other write does, and the
// notes follow a change of the place they are kept in.
//
// The app runs with a profile of its own and its window is never shown.
//   CODINGFLEET_API_KEY=cf_sk_... CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 npx electron test/e2e-project-memory.cjs
//   E2E_MODEL=... to pick the model
const { app, ipcMain, BrowserWindow, Notification } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.CODINGFLEET_API_KEY) {
  console.error('Set CODINGFLEET_API_KEY (and CODINGFLEET_API_BASE for a local server).');
  process.exit(2);
}
const MODEL = process.env.E2E_MODEL || 'deepseek-v4.1-flash-low';
const TURN_TIMEOUT = 240000;

// Nothing of this test reaches the screen.
for (const method of ['show', 'showInactive', 'focus', 'maximize', 'restore', 'flashFrame', 'moveTop']) {
  BrowserWindow.prototype[method] = function hidden() {};
}
Notification.prototype.show = function hidden() {};

const tmp = (name) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
const userData = tmp('cf-e2e-memory-');
app.setPath('userData', userData);
// "Ask" mode: every write waits for an answer, so a memory write that does not
// wait is the rule under test and not the mode.
fs.writeFileSync(path.join(userData, 'state.json'), JSON.stringify({ permissionMode: 'ask' }));

const project = tmp('cf-e2e-shop-');
fs.writeFileSync(path.join(project, 'package.json'), '{ "name": "shop", "version": "1.0.0" }\n');
fs.writeFileSync(path.join(project, 'README.md'), '# Shop\n\nA small web shop.\n');
execFileSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' });

const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

// What the main process tells the window: the run's events, by session.
const events = [];
app.on('web-contents-created', (_event, contents) => {
  const original = contents.send.bind(contents);
  contents.send = (channel, payload) => {
    if (channel === 'run:event' && payload) events.push(payload);
    return original(channel, payload);
  };
});

const handlers = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => { handlers.set(channel, fn); return originalHandle(channel, fn); };
const call = async (channel, arg) => {
  const result = await handlers.get(channel)({}, arg);
  if (!result.ok) throw new Error(`${channel}: ${result.error.message}`);
  return result.data;
};

const projectMemory = require('../src/core/project-memory');
require('../src/main/main.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inside = (dir, target) => {
  const rel = path.relative(dir, path.resolve(project, String(target || '')));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** One turn. Every approval the app asks for is answered "allow" and recorded. */
async function turn(sessionId, message) {
  const from = events.length;
  await call('run:start', { sessionId, message, model: MODEL, executor: 'client' });
  const asked = [];
  const answered = new Set();
  const started = Date.now();
  for (;;) {
    const mine = events.slice(from).filter((e) => e.sessionId === sessionId);
    for (const e of mine) {
      if (e.event !== 'client.approval' || answered.has(e.data.id)) continue;
      answered.add(e.data.id);
      const toolCall = mine.find((x) => x.event === 'tool.call' && x.data.id === e.data.id);
      asked.push({ reason: e.data.reason, name: toolCall && toolCall.data.name, args: toolCall && toolCall.data.arguments });
      await call('tool:decide', { callId: e.data.id, decision: 'allow' });
    }
    if (mine.some((e) => e.event === 'client.finished' || e.event === 'client.error')) break;
    if (Date.now() - started > TURN_TIMEOUT) { asked.push({ reason: 'TIMEOUT' }); break; }
    await sleep(150);
  }
  const mine = events.slice(from).filter((e) => e.sessionId === sessionId);
  const of = (name) => mine.filter((e) => e.event === name).map((e) => e.data);
  const results2 = new Map(of('tool.result').map((r) => [r.id, r]));
  return {
    asked,
    text: of('text.delta').map((d) => d.text).join(''),
    calls: of('tool.call').filter((c) => c.executor === 'client').map((c) => ({ ...c, ok: (results2.get(c.id) || {}).ok })),
    ended: of('run.ended')[0],
    errors: of('client.error'),
  };
}

const entryText = (dir) => projectMemory.entryFiles(dir)
  .map((entry) => fs.readFileSync(path.join(dir, entry.file), 'utf8')).join('\n');
const describe = (t) => `${t.calls.map((c) => `${c.name}${c.ok ? '' : '(failed)'}`).join(', ') || 'no tool calls'} | asked: ${t.asked.map((a) => a.reason).join('; ') || 'nothing'}`;

app.whenReady().then(async () => {
  let failed = false;
  try {
    await sleep(5000); // the window boots (hidden) and the handlers are in place
    console.log(`model: ${MODEL}\nproject: ${project}\nprofile: ${userData}\n`);

    // ── 1. A first session is told to remember two facts ────────────────────
    const first = await call('session:create', { cwd: project, model: MODEL });
    const appDir = projectMemory.memoryDir(project, { appDir: userData });
    check('a new project starts with an index and no entries', first.memoryEntries === 0 && fs.existsSync(path.join(appDir, 'MEMORY.md')), appDir);
    const one = await turn(first.id,
      'Remember these two facts about this project for later sessions. Save them to the project memory now: '
      + '1) the unit tests run with `npm run test:unit -- --runInBand`; '
      + '2) the staging server is staging.shop-example.test and deploys happen on Tuesdays.');
    check('the run completed', one.ended && one.ended.reason === 'completed' && !one.errors.length, `${JSON.stringify(one.ended)} ${JSON.stringify(one.errors).slice(0, 200)}`);
    const saved = entryText(appDir);
    check('the facts are in entry files of the memory folder', saved.includes('runInBand') && saved.includes('staging.shop-example.test'),
      `${projectMemory.entryFiles(appDir).map((e) => e.file).join(', ') || 'no entry files'} | ${describe(one)}`);
    const memoryWrites = one.calls.filter((c) => /^fs_(write|edit)$/.test(c.name) && inside(appDir, c.arguments.path));
    check('the agent wrote them with its file tools, and each call worked', memoryWrites.length >= 1 && memoryWrites.every((c) => c.ok), describe(one));
    check('no write to the memory folder waited for an approval, in "ask" mode',
      !one.asked.some((a) => a.args && inside(appDir, a.args.path)) && !one.asked.some((a) => a.reason === 'TIMEOUT'), describe(one));
    check('nothing was written into the project folder itself', !fs.existsSync(path.join(project, '.codingfleet'))
      && execFileSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' }).split('\n').filter(Boolean).every((line) => /package\.json|README\.md/.test(line)));

    // ── 2. A later session in the same folder knows them ────────────────────
    const second = await call('session:create', { cwd: project, model: MODEL });
    check('the next session starts with the entries in its index', second.memoryEntries >= 1, `${second.memoryEntries} entries`);
    const index = fs.readFileSync(path.join(appDir, 'MEMORY.md'), 'utf8');
    check('every entry file has a line in MEMORY.md', projectMemory.entryFiles(appDir).every((e) => index.includes(`(${e.file})`)), index.split('\n').filter((l) => l.startsWith('- ')).join(' ¶ ').slice(0, 300));
    const two = await turn(second.id, 'What is the exact command that runs the unit tests of this project? Answer with the command only.');
    check('a new session answers from the memory', two.text.includes('runInBand'), `${two.text.trim().slice(0, 140)} | ${describe(two)}`);
    check('reading the memory did not wait for an approval', !two.asked.some((a) => a.args && inside(appDir, a.args.path)), describe(two));

    // ── 3. Any other write does wait ─────────────────────────────────────────
    const three = await turn(second.id, 'Use fs_write to create the file notes.txt in the project folder with the single word hello.');
    check('a write to the project waits for an approval in "ask" mode', three.asked.some((a) => a.reason === 'changes files'), describe(three));
    check('once allowed, the file is there', fs.existsSync(path.join(project, 'notes.txt')));

    // ── 4. The notes move into the project folder ────────────────────────────
    const moved = await call('memory:set', { location: 'project', sessionId: second.id });
    const inProject = path.join(project, '.codingfleet', 'memory');
    check('changing the place moves the entries', moved.moved >= 1 && moved.current.dir === inProject
      && entryText(inProject).includes('staging.shop-example.test') && !fs.existsSync(appDir), `${moved.moved} moved`);
    check('git does not see the notes', !execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: project, encoding: 'utf8' }).includes('.codingfleet'));
    const third = await call('session:create', { cwd: project, model: MODEL });
    const four = await turn(third.id, 'Which host is the staging server of this project? Answer with the host name only.');
    check('a session after the move answers from the new place', four.text.includes('staging.shop-example.test'), `${four.text.trim().slice(0, 140)} | ${describe(four)}`);
    check('no approval for the memory folder inside the project', !four.asked.some((a) => a.args && inside(inProject, a.args.path)), describe(four));

    // ── 5. Forgetting ────────────────────────────────────────────────────────
    const five = await turn(third.id, 'The staging server was shut down. Remove everything about the staging server and the deploy day from the project memory.');
    const after = await call('memory:get', { sessionId: third.id }); // as Preferences reads it
    const left = entryText(inProject);
    check('the fact is gone from the entry files', !left.includes('staging.shop-example.test'), describe(five));
    check('the other fact is still there', left.includes('runInBand'), `${after.current.entries.map((e) => e.file).join(', ')}`);
    await call('session:create', { cwd: project, model: MODEL }); // a new session brings the index in step
    const finalIndex = fs.readFileSync(path.join(inProject, 'MEMORY.md'), 'utf8');
    const lines = finalIndex.split('\n').filter((line) => /^\s*[-*]\s*\[/.test(line));
    check('the index lists exactly the files that are left', lines.length === projectMemory.entryFiles(inProject).length
      && !/staging\.shop-example/.test(finalIndex), finalIndex.split('\n').filter((l) => l.startsWith('- ')).join(' ¶ ').slice(0, 300));
  } catch (err) {
    failed = true;
    console.error('FAILED:', err.stack || err.message);
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  for (const dir of [project, userData]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still open: left in the temp folder */ }
  }
  app.exit(failed || !results.every(Boolean) ? 1 : 0);
});
