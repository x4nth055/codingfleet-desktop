'use strict';
// The main process: notes that could not move when the place changed follow
// at the project's next session; a project whose .codingfleet is a link keeps
// its notes in the app folder; a session moved to another folder loses the
// first folder's memory rights. Throwaway profile, fake API, hidden window.
// Run with: npx electron test/project-memory-main.cjs
const { app, ipcMain, BrowserWindow, Notification } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

for (const method of ['show', 'showInactive', 'focus', 'maximize', 'restore', 'flashFrame', 'moveTop']) {
  BrowserWindow.prototype[method] = function hidden() {};
}
Notification.prototype.show = function hidden() {};

const APP = path.join(__dirname, '..');
const tmp = (name) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
const userData = tmp('cf-memory-adopt-');
app.setPath('userData', userData);
const memory = require(path.join(APP, 'src/core/project-memory.js'));

const known = tmp('cf-known-');      // has a session
const orphan = tmp('cf-orphan-');    // has notes, but no session in state.json
const hostile = tmp('cf-hostile-');  // its .codingfleet is a link
const elsewhere = tmp('cf-elsewhere-');
const custom = tmp('cf-custom-');
for (const cwd of [known, orphan]) {
  const dir = memory.memoryDir(cwd, { appDir: userData });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'build.md'), `How ${path.basename(cwd)} is built\n`);
}
let linked = true;
try { fs.symlinkSync(elsewhere, path.join(hostile, '.codingfleet'), 'junction'); } catch { linked = false; }
fs.writeFileSync(path.join(userData, 'state.json'), JSON.stringify({ sessions: { k1: { cwd: known }, h1: { cwd: hostile } } }));

const posted = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url.endsWith('/sessions')) {
      posted.push(JSON.parse(body));
      res.statusCode = 201;
      res.end(JSON.stringify({ id: `s${posted.length}`, executor: 'client', title: '', created_at: new Date().toISOString() }));
    } else res.end('{}');
  });
});

server.listen(0, '127.0.0.1', () => {
  process.env.CODINGFLEET_API_BASE = `http://127.0.0.1:${server.address().port}/v1`;
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

  app.whenReady().then(async () => {
    let failed = false;
    try {
      await new Promise((r) => setTimeout(r, 5000));
      // 1. The place changes: only the project with a session moves now.
      const moved = await call('memory:set', { location: 'custom', customDir: custom, sessionId: 'k1' });
      assert.equal(moved.moved, 1);
      assert.equal(moved.failed, 0);
      const knownNew = path.join(custom, memory.folderKey(known));
      const orphanOld = memory.memoryDir(orphan, { appDir: userData });
      const orphanNew = path.join(custom, memory.folderKey(orphan));
      assert.ok(fs.existsSync(path.join(knownNew, 'build.md')));
      assert.ok(fs.existsSync(path.join(orphanOld, 'build.md')), 'the project with no session is still at the old place');
      console.log('ok 1 the known project moved; the one with no session waits');

      // 2. A session starts in that project: its notes come along, and reach the system message.
      const session = await call('session:create', { cwd: orphan, model: 'auto' });
      assert.equal(session.memoryEntries, 1);
      assert.ok(fs.existsSync(path.join(orphanNew, 'build.md')) && !fs.existsSync(orphanOld));
      assert.match(posted[posted.length - 1].system_message, /- \[build\]\(build\.md\): How cf-orphan-/);
      const saved = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
      assert.deepEqual(saved.projectMemory.left, [{ location: 'app', customDir: '' }]);
      console.log('ok 2 its notes followed at its next session');

      // 3. Into the project folders: the linked project keeps its notes in the app folder.
      await call('memory:set', { location: 'project', sessionId: 'k1' });
      assert.ok(fs.existsSync(path.join(known, '.codingfleet', 'memory', 'build.md')));
      if (linked) {
        const view = await call('memory:get', { sessionId: 'h1' });
        assert.equal(view.current.dir, memory.memoryDir(hostile, { appDir: userData }), 'not through the link');
        assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing was made at the end of the link');
        const made = await call('session:create', { cwd: hostile, model: 'auto' });
        assert.deepEqual(fs.readdirSync(elsewhere), []);
        assert.ok(posted[posted.length - 1].system_message.includes(`${memory.memoryDir(hostile, { appDir: userData }).replace(/\\/g, '/')}/`));
        assert.equal(made.memoryEntries, 0);
        console.log('ok 3 a project whose .codingfleet is a link: notes stay in the app folder, nothing at the link');
      } else console.log('skip 3 this account cannot make links');

      // 4. Back to the app folder, twice: the list of old places has no doubles and not the current one.
      await call('memory:set', { location: 'app', sessionId: 'k1' });
      await call('memory:set', { location: 'project', sessionId: 'k1' });
      await call('memory:set', { location: 'app', sessionId: 'k1' });
      const left = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8')).projectMemory.left;
      assert.deepEqual(left, [{ location: 'project', customDir: '' }, { location: 'custom', customDir: custom }]);
      assert.ok(fs.existsSync(path.join(memory.memoryDir(known, { appDir: userData }), 'build.md')));
      assert.ok(!fs.existsSync(path.join(known, '.codingfleet')));
      console.log('ok 4 old places are remembered once each');

      // 5. A session moved to another folder no longer names the first folder's memory.
      const first = await call('session:create', { cwd: known, model: 'auto' });
      let state = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
      assert.ok(state.sessions[first.id].memoryDir);
      await call('session:setFolder', { sessionId: first.id, cwd: orphan });
      state = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
      assert.equal(state.sessions[first.id].memoryDir, undefined);
      assert.equal(state.sessions[first.id].cwd, orphan);
      console.log('ok 5 a session moved to another folder drops the old memory folder');
    } catch (err) {
      failed = true;
      console.error('FAILED:', err.stack || err.message);
    }
    server.close();
    for (const dir of [known, orphan, hostile, elsewhere, custom, userData]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left */ } }
    app.exit(failed ? 1 : 0);
  });
});
