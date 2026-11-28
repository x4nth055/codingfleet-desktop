'use strict';
// Group & sort in the real window: the two buttons on each folder's header,
// the menu, and the list it lays out. With an isolated profile, no API access.
// Run with: npx electron test/sidebar-order.cjs [--shots=<dir>]
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-order-')));
const shots = (process.argv.find((a) => a.startsWith('--shots=')) || '').slice(8);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 760,
    webPreferences: { preload: path.join(__dirname, 'fixtures/layout-preload.js'), backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code);
  const frame = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const shot = async (name) => {
    if (!shots) return;
    await frame();
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 520, height: 600 });
    fs.writeFileSync(path.join(shots, `${name}.png`), image.toPNG());
  };
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await js(`
      localStorage.removeItem('cf.session-order');
      sessionOrder = CF_SESSION_ORDER.normalize(null);
      $('settings').hidden = true;
      S.settings.hasKey = true;
      const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
      S.sessions = [
        { id: 's1', title: 'Fix the login bug', executor: 'client', created_at: ago(9), last_used_at: ago(0) },
        { id: 's2', title: 'Add dark mode', executor: 'client', created_at: ago(1), last_used_at: ago(2) },
        { id: 's3', title: 'Write the README', executor: 'client', created_at: ago(30), last_used_at: ago(1) },
        { id: 's4', title: 'Benchmark the parser', executor: 'sandbox', created_at: ago(3), last_used_at: ago(3) },
        { id: 's5', title: 'Pinned plan', executor: 'client', pinned: true, created_at: ago(40), last_used_at: ago(40) },
      ];
      S.init.state.sessions.s1 = { cwd: 'C:/work/webapp' };
      S.init.state.sessions.s2 = { cwd: 'C:/work/webapp' };
      S.init.state.sessions.s3 = { cwd: 'C:/work/docs' };
      S.init.state.sessions.s5 = { cwd: 'C:/work/docs' };
      renderSidebar(); renderAccount(); renderMain();
    `);
    const heads = () => js(`[...document.querySelectorAll('#sessionList .group-head')].map(h => ({
      name: h.querySelector('.group-name').textContent,
      sort: h.querySelector('.group-sort')?.title || null,
      add: h.querySelector('.group-add')?.title || null,
      rows: (() => { const ids = []; for (let n = h.nextElementSibling; n && !n.classList.contains('group-head'); n = n.nextElementSibling) ids.push(n.dataset.id); return ids.join(','); })(),
    }))`);

    // By folder, the default: the folder used last first, each with both buttons.
    let got = await heads();
    assert.deepEqual(got.map((h) => [h.name, h.rows]), [
      ['Pinned', 's5'], ['webapp', 's1,s2'], ['docs', 's3'], ['Cloud sandbox', 's4'],
    ]);
    for (const h of got) assert.equal(h.sort, 'Group & sort', `${h.name} has Group & sort`);
    assert.deepEqual(got.map((h) => h.add), [null, 'New Session', 'New Session', 'New Session']);

    // The buttons show on hover; the menu opens under Group & sort.
    await js(`document.querySelectorAll('.group-head .group-sort')[1].click()`);
    const menu = await js(`(() => {
      const m = $('orderMenu');
      return { hidden: m.hidden, items: [...m.querySelectorAll('.menu-group, .menu-item')].map(n =>
        (n.classList.contains('menu-group') ? '# ' : n.classList.contains('selected') ? '* ' : '  ') + n.textContent) };
    })()`);
    assert.equal(menu.hidden, false);
    assert.deepEqual(menu.items, [
      '# Group by', '* Folder / environment', '  Date', '  None',
      '# Sort by', '* Last updated', '  Date created', '  Name',
      '# Order', '* Newest first', '  Oldest first',
    ]);
    await shot('1-menu-by-folder');

    // Name, A to Z: the menu stays open and the order labels follow.
    await js(`[...$('orderMenu').querySelectorAll('.menu-item')].find(n => n.textContent === 'Name').click()`);
    assert.equal(await js(`$('orderMenu').hidden`), false, 'the menu stays open while choosing');
    assert.deepEqual(await js(`[...$('orderMenu').querySelectorAll('.menu-item')].slice(6).map(n => n.textContent)`), ['A to Z', 'Z to A']);
    got = await heads();
    assert.deepEqual(got.map((h) => [h.name, h.rows]), [
      ['Pinned', 's5'], ['Cloud sandbox', 's4'], ['docs', 's3'], ['webapp', 's2,s1'],
    ]);

    // By date, newest first.
    await js(`[...$('orderMenu').querySelectorAll('.menu-item')].find(n => n.textContent === 'Date').click()`);
    await js(`[...$('orderMenu').querySelectorAll('.menu-item')].find(n => n.textContent === 'Last updated').click()`);
    got = await heads();
    assert.deepEqual(got.map((h) => [h.name, h.rows]), [
      ['Pinned', 's5'], ['Today', 's1'], ['Yesterday', 's3'], ['Last 7 days', 's2,s4'],
    ]);
    assert.ok(got.every((h) => h.sort && !h.add), 'date groups have Group & sort, and no New Session');
    await shot('2-menu-by-date');

    // None, oldest first: one list.
    await js(`[...$('orderMenu').querySelectorAll('.menu-item')].find(n => n.textContent === 'None').click()`);
    await js(`[...$('orderMenu').querySelectorAll('.menu-item')].find(n => n.textContent === 'Oldest first').click()`);
    got = await heads();
    assert.deepEqual(got.map((h) => [h.name, h.rows]), [['Pinned', 's5'], ['Sessions', 's4,s2,s3,s1']]);

    // Kept for the next start.
    assert.deepEqual(JSON.parse(await js(`localStorage.getItem('cf.session-order')`)), { group: 'none', sort: 'updated', dir: 'asc' });

    // A click elsewhere closes the menu.
    await js(`document.querySelector('.main, main, #topbar').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    assert.equal(await js(`$('orderMenu').hidden`), true);

    // New Session on a folder starts a session in that folder.
    await js(`setSessionOrder('group', 'folder'); closeMenus();`);
    // As on hover, for the picture: both buttons of every header.
    if (shots) await js(`document.querySelectorAll('.group-btn').forEach(b => { b.style.opacity = '1'; })`);
    await shot('3-by-folder-buttons');
    await js(`[...document.querySelectorAll('.group-head')].find(h => h.textContent.includes('docs')).querySelector('.group-add').click()`);
    assert.deepEqual(await js(`({ current: S.current, cwd: S.draftCwd })`), { current: null, cwd: 'C:/work/docs' });
    await js(`[...document.querySelectorAll('.group-head')].find(h => h.textContent.includes('Cloud sandbox')).querySelector('.group-add').click()`);
    assert.deepEqual(await js(`({ sandbox: S.draftSandbox, cwd: S.draftCwd })`), { sandbox: true, cwd: null });

    console.log('sidebar order: ok');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
