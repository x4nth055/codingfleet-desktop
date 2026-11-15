'use strict';
// Preferences > Sessions > Project memory: the switch, where the notes are
// kept, and the folder of the project in view. The window is never shown.
// Run with: npx electron test/project-memory-prefs.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-memory-prefs-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 900,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await js(`
      S.settings.hasKey = true;
      S.current = 'mem';
      S.sessions = [{ id: 'mem', title: 'Add a cart page', executor: 'client', created_at: new Date().toISOString() }];
      S.loaded.add('mem');
      S.init.state.sessions.mem = { cwd: 'C:/workspace/webshop' };
      S.account = { preferences: { default_model: 'auto', show_legacy_models: false, credit_cap_per_message: 0, economy_mode: false } };
      window.settle = () => new Promise((r) => setTimeout(r, 60));
      window.memoryBox = () => {
        const box = document.querySelector('.memory-prefs');
        return box && {
          titles: [...box.querySelectorAll('.set-title')].map((n) => n.textContent),
          descs: [...box.querySelectorAll('.set-desc')].map((n) => n.textContent),
          options: [...box.querySelectorAll('option')].map((n) => [n.value, n.textContent]),
          chosen: box.querySelector('select')?.value || null,
          on: box.querySelector('.switch input').checked,
          status: document.querySelector('#prefsPane .pane-status').textContent,
          overflow: box.scrollWidth > box.clientWidth + 1,
        };
      };
      window.choose = async (value) => {
        const select = document.querySelector('.memory-prefs select');
        select.value = value;
        select.dispatchEvent(new Event('change'));
        await settle();
      };
      openSettings(false, 'preferences');
      showPrefsTab('sessions');
      true;
    `);
    await js('settle()');

    // 1. As it starts: on, in the app's own folder, with this project's entries.
    const first = await js('memoryBox()');
    assert.deepEqual(first.titles, ['Remember each project', 'Where the notes are kept', 'This project: 2 entries']);
    assert.equal(first.on, true);
    assert.equal(first.chosen, 'app');
    assert.deepEqual(first.options.map(([value]) => value), ['app', 'project', 'pick']);
    // The default place is named by its path on this computer, so nobody reads it as our servers.
    assert.equal(first.options[0][1],
      'In C:\\Users\\a-rather-long-user-name-for-a-windows-account\\AppData\\Roaming\\CodingFleet\\projects (default)');
    assert.match(first.descs[2], /projects\/webshop-1a2b3c4d\/memory$/);
    assert.equal(first.overflow, false);

    // 2. Into the project folders: main is told, and the pane says what moved.
    await js(`choose('project')`);
    const second = await js('memoryBox()');
    assert.deepEqual((await js('cf.memoryCalls()')).at(-1), { location: 'project', sessionId: 'mem' });
    assert.equal(second.chosen, 'project');
    assert.match(second.descs[2], /\.codingfleet\/memory$/);
    assert.equal(second.status, 'Saved. 2 entries moved.');

    // 3. A folder the user chooses: it becomes a choice of its own.
    await js(`choose('pick')`);
    const third = await js('memoryBox()');
    assert.deepEqual((await js('cf.memoryCalls()')).at(-1), { location: 'custom', customDir: 'D:/notes', sessionId: 'mem' });
    assert.equal(third.chosen, 'custom');
    assert.deepEqual(third.options.map(([value]) => value), ['app', 'project', 'custom', 'pick']);
    assert.equal(third.options[2][1], 'In D:/notes');

    // 4. "Open folder" opens this project's memory folder.
    await js(`document.querySelector('.memory-prefs .btn').click(); settle()`);
    assert.deepEqual(await js('cf.openedFolders()'), ['D:/notes/webshop-1a2b3c4d']);

    // 5. Off: only the switch is left.
    await js(`(async () => {
      const input = document.querySelector('.memory-prefs .switch input');
      input.checked = false;
      input.dispatchEvent(new Event('change'));
      await settle();
    })()`);
    const off = await js('memoryBox()');
    assert.deepEqual(off.titles, ['Remember each project']);
    assert.equal(off.on, false);

    // A picture, when a file is named: `CF_SHOT=out.png npx electron test/project-memory-prefs.cjs`.
    if (process.env.CF_SHOT) {
      await js(`(async () => {
        const input = document.querySelector('.memory-prefs .switch input');
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        await settle();
        document.querySelector('.memory-prefs').scrollIntoView({ block: 'center' });
        await settle();
      })()`);
      fs.writeFileSync(process.env.CF_SHOT, (await win.webContents.capturePage()).toPNG());
    }
    console.log('project memory preferences: 5 checks passed');
    app.exit(0);
  } catch (err) {
    console.error(err.stack || err.message);
    app.exit(1);
  }
});
