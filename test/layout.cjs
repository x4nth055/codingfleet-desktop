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
              $('costPill').hidden = false; $('costPill').textContent = '0 cr';
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
    // The quota tooltip, in the state that matters: the weekly allowance is
    // spent and credits are not. The card used to shout a red "0%"; now it says
    // so calmly, every row of the tooltip stays on one line, the numbers never
    // break in two, and the three actions fit in two even rows.
    for (const width of [940, 1100, 1320, 1600]) {
      win.setContentSize(width, 850);
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      for (const theme of ['dark', 'light', 'hacker']) {
        const result = await win.webContents.executeJavaScript(`(() => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)};
          quotaOpen = true;
          renderAccount();
          const rect = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; };
          const errors = [];
          const pop = document.querySelector('.quota-pop');
          const card = document.querySelector('.quota-card');
          // Nothing left to spend: the track is drawn empty, with no stub on it.
          if (card.querySelector('.quota-fill')) errors.push('a spent allowance still draws a fill');
          for (const row of pop.querySelectorAll('.qp-row')) {
            if (row.getClientRects().length !== 1) errors.push(row.textContent + ' wraps');
            if (row.scrollWidth > row.clientWidth + 1) errors.push(row.textContent + ' is cut off');
            const value = row.querySelector('strong');
            if (value.getClientRects().length !== 1) errors.push(value.textContent + ' breaks in two');
          }
          const buttons = [...pop.querySelectorAll('.account-actions .btn')];
          const actions = rect(pop.querySelector('.account-actions'));
          // One action takes the whole row, the other two split the next evenly:
          // the shape that fits this 272px sidebar at every window width.
          const [first, ...rest] = buttons;
          if (Math.abs(rect(first).width - actions.width) > 1) errors.push('the first action does not span the tooltip');
          if (new Set(rest.map((b) => Math.round(b.getBoundingClientRect().top))).size !== 1) errors.push('the last two actions are not on one row');
          if (Math.abs(rect(rest[0]).width - rect(rest[1]).width) > 1) errors.push('the last two actions are not equal');
          for (const b of buttons) {
            if (b.scrollWidth > b.clientWidth + 1) errors.push(b.textContent + ' is cut off');
            const r = rect(b);
            if (r.x < rect(pop).x || r.right > rect(pop).right + 1) errors.push(b.textContent + ' leaves the tooltip');
            if (rect(b).width < 40) errors.push(b.textContent + ' is too narrow to read');
          }
          const sidebar = rect(document.querySelector('.sidebar'));
          if (rect(pop).right > sidebar.right - 4) errors.push('the tooltip leaves the sidebar');
          return { errors, status: card.querySelector('.quota-pct').textContent,
            actions: buttons.map((b) => b.textContent) };
        })()`);
        assert.deepEqual(result.errors, [], `${width}/${theme}/quota`);
        assert.equal(result.status, 'On credits', `${width}/${theme}: a spent allowance still reads as 0%`);
        assert.deepEqual(result.actions, ['Plans', 'Buy credits', 'Billing'], `${width}/${theme}: actions`);
        checks++;
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
