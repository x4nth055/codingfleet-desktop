'use strict';
// "Run in background" on a command the agent waits for: offered once it has run
// 10 seconds, only for a command on this computer, and a click asks the app
// to move it (core/tools.js moveToBackground).
// Run with: npx electron test/move.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-move-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 760,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await win.webContents.executeJavaScript(`
      $('settings').hidden = true;
      S.settings.hasKey = true;
      S.current = 'move';
      S.sessions = [{ id: 'move', title: 'Dev server', executor: 'client', created_at: new Date().toISOString() }];
      S.loaded.add('move');
      S.init.state.sessions.move = { cwd: 'C:/workspace/app' };
      renderSidebar(); renderMain();
      window.emit = (event, data = {}) => onRunEvent({ sessionId: 'move', event, data });
      window.aWhileAgo = (id) => { findTool('move', id).runningSince = Date.now() - 10000; updateTool('move', id, {}); };
      true;
    `);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const bars = () => document.querySelectorAll('.move-bar').length;
      emit('tool.call', { id: 'c1', name: 'run_command', executor: 'client', arguments: { command: 'npm run dev' } });
      emit('client.tool_running', { id: 'c1' });
      const early = bars();
      aWhileAgo('c1');
      const later = bars();
      document.querySelector('.move-bar button').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const moved = await cf.movedCalls();
      emit('tool.result', { id: 'c1', name: 'run_command', ok: true,
        output: { stdout: 'ready', stderr: '', exit_code: null, background: { id: 'bg_1234abcd', status: 'running' } } });
      const meta = [...document.querySelectorAll('.tool-meta')].map((n) => n.textContent);
      const after = bars();
      // On the cloud sandbox, not this computer: nothing to move here.
      emit('tool.call', { id: 'c2', name: 'run_command', arguments: { command: 'npm test' } });
      findTool('move', 'c2').runningSince = Date.now() - 10000;
      updateTool('move', 'c2', {});
      const cloud = bars();
      emit('tool.result', { id: 'c2', name: 'run_command', ok: true, output: { stdout: '', stderr: '', exit_code: 0 } });
      // execute_code with a command is offered too.
      emit('tool.call', { id: 'c3', name: 'execute_code', executor: 'client',
        arguments: { filename: 'app.py', code: 'x', command: 'python app.py' } });
      emit('client.tool_running', { id: 'c3' });
      aWhileAgo('c3');
      return { early, later, moved, meta, after, cloud, code: bars() };
    })()`);
    assert.equal(result.early, 0, 'not offered at once');
    assert.equal(result.later, 1, 'offered after a while');
    assert.deepEqual(result.moved, ['c1']);
    assert.equal(result.after, 0, 'gone once the result came');
    assert.ok(result.meta.includes('In the background'), result.meta.join(','));
    assert.equal(result.cloud, 0, 'not for a call that ran elsewhere');
    assert.equal(result.code, 1, 'execute_code with a command');

    // A cloud session: the command runs in its sandbox, and moves there.
    const cloud = await win.webContents.executeJavaScript(`(async () => {
      S.sessions.push({ id: 'cloudy', title: 'Cloud', executor: 'sandbox', created_at: new Date().toISOString() });
      S.loaded.add('cloudy');
      S.current = 'cloudy';
      renderSidebar(); renderMain();
      const send = (event, data = {}) => onRunEvent({ sessionId: 'cloudy', event, data });
      send('tool.call', { id: 'k1', name: 'run_command', arguments: { command: 'npm run dev' } });
      const early = document.querySelectorAll('.move-bar').length;
      findTool('cloudy', 'k1').runningSince = Date.now() - 10000;
      updateTool('cloudy', 'k1', {});
      const later = document.querySelectorAll('.move-bar').length;
      document.querySelector('.move-bar button').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { early, later, moved: await cf.movedCalls() };
    })()`);
    assert.equal(cloud.early, 0);
    assert.equal(cloud.later, 1, 'offered for a cloud command too');
    assert.deepEqual(cloud.moved, ['c1', 'k1']);
    await win.webContents.executeJavaScript(`S.current = 'move'; renderMain(); true;`);
    for (const theme of ['dark', 'light']) {
      await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)};`);
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      const shot = path.join(os.tmpdir(), `codingfleet-move-${theme}.png`);
      fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
      console.log(`screenshot: ${shot}`);
    }
    console.log('PASS run in background');
  } finally { win.destroy(); }
}).then(() => app.exit(0)).catch((err) => { console.error(err); app.exit(1); });
