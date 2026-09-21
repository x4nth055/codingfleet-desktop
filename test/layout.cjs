'use strict';
// Render the actual app with an isolated profile and no API access.
// Run with: npx electron test/layout.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-layout-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 900,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await win.webContents.executeJavaScript(`
      $('settings').hidden = true;
      S.settings.hasKey = true;
      S.credits = { plan: { name: 'Ultimate Max' }, weekly_total: 100, weekly_remaining: 0, credits: 10774 };
      S.current = 'layout';
      S.sessions = [{ id: 'layout', title: 'Long agent task', executor: 'client', created_at: new Date().toISOString(), context: { tokens: 279100, limit: 800000 } }];
      S.loaded.add('layout');
      S.init.state.sessions.layout = { cwd: 'C:/workspace/a-long-project-folder-name' };
      S.model = 'DeepSeek V4.1 Flash';
      renderSidebar(); renderAccount(); renderMain();
    `);
    let checks = 0;
    for (const width of [940, 1100, 1320, 1600]) {
      win.setContentSize(width, 850);
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      for (const theme of ['dark', 'light', 'hacker']) {
        for (const panel of [false, true]) {
          let idle;
          for (const running of [false, true]) {
            const result = await win.webContents.executeJavaScript(`(() => {
              document.documentElement.dataset.theme = ${JSON.stringify(theme)};
              document.querySelector('.app').classList.toggle('with-panel', ${panel});
              $('agentsPanel').hidden = ${!panel};
              S.running.clear();
              if (${running}) S.running.set('layout', { started: Date.now() });
              renderComposer();
              // Include all optional controls, as on a reasoning model.
              $('effortButton').hidden = false;
              $('effortButton').replaceChildren(icon('gauge'), el('span', null, 'High'), icon('caret', 'icon caret'));
              $('costPill').hidden = false; $('costPill').textContent = 'Included';
              const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
              const composer = box($('composer'));
              const sidebar = box(document.querySelector('.sidebar'));
              const items = [...document.querySelectorAll('.composer-bar > button, .composer-bar > .cost-pill')].filter(n => !n.hidden);
              const errors = [];
              for (const n of items) {
                const r = box(n);
                if (r.x < composer.x || r.right > composer.right + 1 || r.bottom > composer.bottom + 1) errors.push(n.id + ' overflows composer');
              }
              for (const n of document.querySelectorAll('.quota-card, .context-row, .account-foot')) {
                const r = box(n);
                if (r.right > sidebar.right - 4 || n.scrollWidth > n.clientWidth + 1) errors.push(n.className + ' overflows sidebar');
              }
              return { errors, composer, send: box($('send')), hint: box($('hint')) };
            })()`);
            assert.deepEqual(result.errors, [], `${width}/${theme}/panel=${panel}/running=${running}`);
            assert.ok(result.hint.y >= result.composer.bottom - 1, `hint stays below composer: ${JSON.stringify(result)}`);
            if (!running) idle = result;
            else {
              assert.deepEqual(result.composer, idle.composer, 'starting a run does not resize composer');
              assert.deepEqual(result.send, idle.send, 'starting a run does not move send/stop');
            }
            checks++;
          }
        }
      }
    }
    const replay = await win.webContents.executeJavaScript(`(() => {
      S.running.set('layout', { started: Date.now(), turnStart: 0 });
      S.transcripts.set('layout', []);
      const emit = (event, data = {}) => onRunEvent({ sessionId: 'layout', event, data });
      const call = { id: 'approval', name: 'run_command', executor: 'client', arguments: { command: 'build' } };
      emit('tool.call', call);
      updateTool('layout', call.id, { status: 'waiting', reason: 'Command approval' });
      emit('subagent.started', { agent_id: 'A', role: 'Worker' });
      emit('subagent.text', { agent_id: 'A', text: 'one copy' });
      for (let i = 0; i < 3; i++) {
        emit('client.reconnecting');
        emit('tool.call', call);
        emit('subagent.started', { agent_id: 'A', role: 'Worker' });
        emit('subagent.text', { agent_id: 'A', text: 'one copy' });
      }
      const tool = findTool('layout', call.id);
      return { status: tool.status, reason: tool.reason,
        text: agentsOf('layout').get('A').items.filter(i => i.type === 'assistant').map(i => i.text).join('') };
    })()`);
    assert.deepEqual(replay, { status: 'waiting', reason: 'Command approval', text: 'one copy' });
    win.setContentSize(1100, 850);
    await win.webContents.executeJavaScript(`document.querySelector('.app').classList.remove('with-panel'); $('agentsPanel').hidden = true;`);
    const shot = path.join(os.tmpdir(), 'codingfleet-hacker-layout-fixed.png');
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    console.log(`PASS ${checks} rendered layouts; screenshot: ${shot}`);
  } finally { win.destroy(); }
}).then(() => app.exit(0)).catch((err) => { console.error(err); app.exit(1); });
