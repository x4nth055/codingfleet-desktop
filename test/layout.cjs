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
    // Uncommitted changes above the prompt: the pill says "+531 −12", and the
    // list it opens stays inside the window, above the composer it belongs to.
    for (const width of [940, 1100, 1320, 1600]) {
      win.setContentSize(width, 850);
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      for (const theme of ['dark', 'light', 'hacker']) {
        const result = await win.webContents.executeJavaScript(`(() => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)};
          S.gitOpen.clear();
          S.gitDiffs.clear();
          S.git = { repo: { root: 'C:/workspace/a-long-project-folder-name', name: 'a-long-project-folder-name', branch: 'feature/a-fairly-long-branch-name' },
            files: [
              { path: 'src/renderer/app.js', added: 480, removed: 12, status: 'modified', binary: false },
              { path: 'src/main/git.js', added: 51, removed: 0, status: 'untracked', binary: false },
              { path: 'assets/logo-final-final.png', added: 0, removed: 0, status: 'modified', binary: true },
            ], added: 531, removed: 12, count: 3, truncated: false, stamp: 1 };
          S.gitFor = gitTag(gitTarget());
          renderComposer();
          const errors = [];
          const rect = (n) => n.getBoundingClientRect();
          const composer = rect($('composer'));
          const pill = $('changesPill');
          if ($('changes').hidden) errors.push('the changes pill is hidden while the repository has changes');
          const said = [...pill.children].map((n) => n.textContent.trim()).filter(Boolean).join(' ');
          if (said !== 'feature/a-fairly-long-branch-name 3 files +531 −12') {
            errors.push('the pill reads "' + said + '"');
          }
          const p = rect(pill);
          if (p.x < composer.x - 1 || p.right > composer.right + 1) errors.push('the pill leaves the composer');
          if (p.bottom > rect($('prompt')).top + 1) errors.push('the pill is not above the prompt');
          openChangesMenu();
          const menu = rect($('changesMenu'));
          const rows = [...document.querySelectorAll('#changesList .file-row')];
          if (rows.length !== 3) errors.push(rows.length + ' file rows');
          for (const text of ['+531', '−12']) {
            if (!$('changesHead').textContent.includes(text)) errors.push('the header does not say ' + text);
          }
          if (menu.left < 0 || menu.right > window.innerWidth + 1) errors.push('the list leaves the window');
          if (menu.top < 0) errors.push('the list is cut off at the top');
          if (menu.bottom > composer.bottom + 1) errors.push('the list is not above the composer');
          if (rows[0].scrollWidth > rows[0].clientWidth + 1) errors.push('a file row is cut off');
          const shot = { menu: { top: menu.top, height: menu.height }, rows: rows.length };
          rows[0].click();
          return { errors, shot, open: S.gitOpen.size, note: document.querySelector('#changesList .diff-note') ? document.querySelector('#changesList .diff-note').textContent : '' };
        })()`);
        assert.deepEqual(result.errors, [], `${width}/${theme}/changes`);
        assert.equal(result.shot.rows, 3, `${width}/${theme}: one row per changed file`);
        await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 60))');
        const unfolded = await win.webContents.executeJavaScript(`(() => {
          const box = document.querySelector('#changesList .file-diff .diff');
          return { diff: Boolean(box), lines: box ? box.querySelectorAll('.dl').length : 0,
            added: box ? box.querySelectorAll('.dl.add').length : 0 };
        })()`);
        assert.ok(unfolded.diff && unfolded.lines === 4 && unfolded.added === 2,
          `${width}/${theme}: a clicked file unfolds its diff: ${JSON.stringify(unfolded)}`);
        checks++;
      }
    }
    // Asked for on its own when a session is shown, and never asked for in a
    // session that runs in the cloud: there is no folder here to look at.
    const asked = await win.webContents.executeJavaScript(`(async () => {
      S.current = 'layout';
      S.init.state.sessions.layout = { cwd: 'C:/workspace/a-long-project-folder-name' };
      S.sessions[0].executor = 'client';
      S.git = null; S.gitFor = ''; S.gitOpen.clear(); S.gitDiffs.clear();
      renderComposer();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const here = { hidden: $('changes').hidden, said: [...$('changesPill').children].map((n) => n.textContent.trim()).filter(Boolean).join(' ') };
      S.sessions[0].executor = 'sandbox';
      S.git = null; S.gitFor = ''; S.gitOpen.clear(); S.gitDiffs.clear();
      renderComposer();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const cloud = $('changes').hidden;
      S.sessions[0].executor = 'client';
      return { here, cloud };
    })()`);
    assert.deepEqual(asked.here, { hidden: false, said: 'feature/a-fairly-long-branch-name 3 files +531 −12' }, 'a folder session shows its changes');
    assert.equal(asked.cloud, true, 'a cloud sandbox shows none');
    checks++;
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
