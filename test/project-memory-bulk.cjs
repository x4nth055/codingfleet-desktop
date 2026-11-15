'use strict';
// Many projects: a change of where project memory is kept moves thousands of
// files, and the app must stay free while it does. The real main process runs
// here with a throwaway profile and a hidden window; a timer on its own thread
// measures the longest time that thread was busy.
// Run with: npx electron test/project-memory-bulk.cjs
//   CF_BULK_PROJECTS=300 CF_BULK_ENTRIES=25   for the large case
const { app, ipcMain, BrowserWindow, Notification } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

for (const method of ['show', 'showInactive', 'focus', 'maximize', 'restore', 'flashFrame', 'moveTop']) {
  BrowserWindow.prototype[method] = function hidden() {};
}
Notification.prototype.show = function hidden() {};

const PROJECTS = Number(process.env.CF_BULK_PROJECTS) || 100;
const ENTRIES = Number(process.env.CF_BULK_ENTRIES) || 20;
// The longest the app's own thread may be busy in one go. A person sees a
// stall from about 100 ms; the old code held the thread for the whole move.
const MAX_STALL_MS = Number(process.env.CF_BULK_MAX_STALL_MS) || 150;

const APP = path.join(__dirname, '..');
const tmp = (name) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
const userData = tmp('cf-memory-bulk-');
const work = tmp('cf-memory-bulk-projects-');
const custom = tmp('cf-memory-bulk-custom-');
app.setPath('userData', userData);
const memory = require(path.join(APP, 'src/core/project-memory.js'));

const sessions = {};
const folders = [];
for (let i = 0; i < PROJECTS; i += 1) {
  const cwd = path.join(work, `project-${i}`);
  fs.mkdirSync(cwd);
  const dir = memory.memoryDir(cwd, { appDir: userData });
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let n = 0; n < ENTRIES; n += 1) {
    fs.writeFileSync(path.join(dir, `note-${n}.md`), `Note ${n} of project ${i}\n\nSome text about it.\n`);
    lines.push(`- [note-${n}](note-${n}.md): Note ${n} of project ${i}`);
  }
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), `# Project memory\n\n${lines.join('\n')}\n`);
  sessions[`s${i}`] = { cwd };
  folders.push(cwd);
}
fs.writeFileSync(path.join(userData, 'state.json'), JSON.stringify({ sessions }));

// No server: the test makes no session and starts no run.
process.env.CODINGFLEET_API_BASE = 'http://127.0.0.1:9/v1';
process.env.CODINGFLEET_API_KEY = 'cf_sk_test';
const handlers = new Map();
const original = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => { handlers.set(channel, fn); return original(channel, fn); };
const call = async (channel, arg) => {
  const result = await handlers.get(channel)({}, arg);
  if (!result.ok) throw new Error(`${channel}: ${result.error.message}`);
  return result.data;
};
require(path.join(APP, 'src/main/main.js'));

// The longest gap between two turns of a 5 ms timer while `work` goes on:
// how long this thread could answer nothing.
async function stallDuring(work) {
  let last = process.hrtime.bigint();
  let longest = 0;
  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    longest = Math.max(longest, Number(now - last) / 1e6 - 5);
    last = now;
  }, 5);
  const started = Date.now();
  try {
    const result = await work();
    return { result, stall: Math.round(longest), took: Date.now() - started };
  } finally {
    clearInterval(timer);
  }
}

app.whenReady().then(async () => {
  let failed = false;
  const total = PROJECTS * ENTRIES;
  const step = (label, { stall, took }) => {
    console.log(`ok ${label}: ${took} ms, the app's longest stall ${stall} ms`);
    assert.ok(stall <= MAX_STALL_MS, `${label}: the app was busy for ${stall} ms in one go (limit ${MAX_STALL_MS})`);
  };
  try {
    // The app's start work (its own prepare job among it) is over first.
    await new Promise((r) => setTimeout(r, 6000));
    console.log(`${PROJECTS} projects, ${total} entries`);

    const first = await stallDuring(() => call('memory:get', { sessionId: 's0' }));
    assert.equal(first.result.projects.length, PROJECTS);
    assert.equal(first.result.projects.reduce((sum, project) => sum + project.entries, 0), total);
    assert.equal(first.result.current.entries.length, ENTRIES);
    step('Preferences lists every project', first);

    const out = await stallDuring(() => call('memory:set', { location: 'custom', customDir: custom, sessionId: 's0' }));
    assert.equal(out.result.moved, total);
    assert.equal(out.result.failed, 0);
    assert.equal(out.result.settings.location, 'custom');
    assert.equal(out.result.projects.reduce((sum, project) => sum + project.entries, 0), total);
    assert.equal(fs.readdirSync(path.join(custom, memory.folderKey(folders[PROJECTS - 1]))).length, ENTRIES + 1);
    assert.ok(!fs.existsSync(memory.memoryDir(folders[0], { appDir: userData })));
    step('the notes of every project moved to a chosen folder', out);

    const inside = await stallDuring(() => call('memory:set', { location: 'project', sessionId: 's0' }));
    assert.equal(inside.result.moved, total);
    assert.equal(fs.readdirSync(path.join(folders[0], '.codingfleet', 'memory')).length, ENTRIES + 1);
    step('into each project folder', inside);

    // Two changes sent together are done in order, and the last one holds.
    const both = await stallDuring(() => Promise.all([
      call('memory:set', { location: 'custom', sessionId: 's0' }),
      call('memory:set', { location: 'app', sessionId: 's0' }),
    ]));
    assert.equal(both.result[1].settings.location, 'app');
    assert.equal(both.result[0].moved + both.result[1].moved, total * 2);
    assert.equal(fs.readdirSync(memory.memoryDir(folders[PROJECTS - 1], { appDir: userData })).length, ENTRIES + 1);
    assert.ok(!fs.existsSync(path.join(folders[0], '.codingfleet')));
    assert.deepEqual(fs.readdirSync(custom).filter((name) => fs.readdirSync(path.join(custom, name)).length), []);
    step('two changes sent together', both);

    const log = fs.readFileSync(path.join(userData, 'logs', 'main.log'), 'utf8');
    assert.ok(!/the work runs in the app itself/.test(log), 'the thread did the work');
  } catch (err) {
    failed = true;
    console.error('FAILED:', err.stack || err.message);
  }
  for (const dir of [work, custom, userData]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } }
  console.log(failed ? 'FAILED project memory with many projects' : 'PASS project memory with many projects');
  app.exit(failed ? 1 : 0);
});
