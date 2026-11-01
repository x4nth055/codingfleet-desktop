'use strict';
// Files an answer links to, in the real window: every choice of the
// right-click menus and every button of the file panel, clicked.
//
// The main process side is the real linked-files.js over a folder of its own,
// and the real clipboard.js on the system clipboard (read back after each
// copy, and put back as it was at the end). Only the shell, the "open a
// program?" question and the browser pane are stand-ins that record what they
// were asked: nothing opens on the desktop.
// Run with: npx electron test/file-links.cjs [folder for screenshots]
const { app, BrowserWindow, ClipboardItem, clipboard, ipcMain, nativeImage, protocol, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLinkedFiles } = require('../src/main/linked-files');
const { createClipboard } = require('../src/main/clipboard');
const { createLocalImages, SCHEME } = require('../src/main/local-images');

// The pictures in the folder come through cf-local:, as in the app (main.js).
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-file-links-')));
const shots = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.cjs') && a !== '.');

// ── The session's folder ────────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-file-links-'));
const cwd = path.join(root, 'tutorial');
const at = (rel) => path.join(cwd, rel);
fs.mkdirSync(at('src'), { recursive: true });
fs.mkdirSync(at('out'), { recursive: true });
const NOTES = '# Horse animation\n\nThe legs move in **four** phases.\n\n- trot\n- canter\n';
fs.writeFileSync(at('notes.md'), NOTES);
fs.writeFileSync(at('src/app.js'), [
  "'use strict';",
  '// Draws the horse, one frame at a time.',
  "const { createCanvas } = require('canvas');",
  '',
  'function legAngle(frame, phase) {',
  '  return Math.sin((frame / 12) * Math.PI * 2 + phase) * 0.6;',
  '}',
  '',
  'for (let frame = 0; frame < 48; frame++) {',
  '  const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((p) => legAngle(frame, p));',
  '  console.log(frame, angles.map((a) => a.toFixed(2)).join(" "));',
  '  // The front legs lead.',
  '}',
  '',
].join('\n'));
fs.writeFileSync(at('out/run.mp4'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]));
fs.writeFileSync(at('out/page.html'), '<!doctype html><h1>Horse</h1>');
fs.writeFileSync(at('setup.bat'), 'echo hi\r\n');
fs.writeFileSync(path.join(root, 'outside.txt'), 'beside the folder\n');
// A chart the agent drew: opaque, so a copy can be checked pixel for pixel.
const pixels = Buffer.alloc(64 * 48 * 4);
for (let i = 0; i < pixels.length; i += 4) pixels.set([0x40, 0x90, 0xe0, 0xff], i); // BGRA
fs.writeFileSync(at('out/chart.png'), nativeImage.createFromBitmap(pixels, { width: 64, height: 48 }).toPNG());

// ── The main process ────────────────────────────────────────────────────────
const calls = { opened: [], revealed: [], asked: [], browsed: [], navigated: [], windows: [], images: [] };
const files = createLinkedFiles({
  folderOf: (id) => (id === 'files' ? cwd : null),
  shell: {
    openPath: async (file) => { calls.opened.push(file); return ''; },
    showItemInFolder: (file) => { calls.revealed.push(file); },
  },
  // "Cancel" to every "open a program?"
  dialog: { showMessageBox: async (_win, options) => { calls.asked.push(options.message); return { response: 0 }; } },
  getWindow: () => null,
  browse: async (file) => { calls.browsed.push(file); return { url: `file:///${file}`, title: '', loading: false }; },
});
const copying = createClipboard({ clipboard, ClipboardItem, nativeImage });

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, arg) => {
    try { return { ok: true, data: await fn(arg) }; } catch (err) { return { ok: false, error: { message: err.message } }; }
  });
}
handle('files:info', files.info);
handle('files:readText', files.readText);
handle('files:open', files.open);
handle('files:reveal', files.reveal);
handle('files:browse', files.browse);
handle('clipboard:write', copying.writeText);
// What the window hands over is noted too: the picture it drew is checked
// even when another program holds the system clipboard.
handle('clipboard:writeImage', (url) => { calls.images.push(url); return copying.writeImage(url); });
handle('browser:navigate', (url) => { calls.navigated.push(url); return { url, title: '', loading: false }; });
// The real local-images.js, as main.js wires it.
const localImages = createLocalImages({ folderOf: (id) => (id === 'files' ? cwd : null), nativeImage });
handle('files:localImageInfo', localImages.info);
handle('files:localImage', localImages.dataUrl);

// ── What the clipboard holds ────────────────────────────────────────────────
// The last picture the window asked to copy, decoded.
function handedImage() {
  const url = calls.images.at(-1);
  if (!url) return null;
  const image = nativeImage.createFromDataURL(url);
  return { ...image.getSize(), pixel: [...image.toBitmap().subarray(0, 4)] };
}

async function clipboardImage() {
  for (const item of await clipboard.read()) {
    if (!item.types.includes('image/png')) continue;
    const blob = await item.getType('image/png');
    const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    const bitmap = image.toBitmap();
    return { ...image.getSize(), pixel: [...bitmap.subarray(0, 4)] };
  }
  return null;
}

async function saveClipboard() {
  try {
    return await Promise.all((await clipboard.read()).map(async (item) => new ClipboardItem(Object.fromEntries(
      await Promise.all(item.types.map(async (type) => [type, await item.getType(type)]))))));
  } catch {
    return null;
  }
}

const ANSWER = [
  'Here is the horse, and its legs move too.',
  '',
  '![a chart](out/chart.png)',
  '',
  '[Download the MP4 video](out/run.mp4) · [the notes](notes.md) · [where the legs move](src/app.js:6)',
  '',
  `[the notes by their full path](${at('notes.md')}) · [the page](out/page.html) · [setup](setup.bat)`,
  '',
  '[CodingFleet](https://codingfleet.com/) · [gone](out/missing.txt) · [beside](../outside.txt)',
  '',
  `![the chart by its full path](${at('out/chart.png')})`,
].join('\n');

app.whenReady().then(async () => {
  session.defaultSession.protocol.handle(SCHEME, (request) => localImages.respond(request));
  const saved = await saveClipboard();
  const win = new BrowserWindow({
    show: false, width: 1400, height: 900,
    webPreferences: { preload: path.join(__dirname, 'fixtures/files-preload.js'), backgroundThrottling: false },
  });
  // "Open link": the app hands a web address to the browser; here it is noted.
  win.webContents.setWindowOpenHandler(({ url }) => { calls.windows.push(url); return { action: 'deny' }; });
  const failures = [];
  let passed = 0;
  const check = (label, ok) => { if (ok) passed++; else failures.push(label); };
  const logged = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' && !/Content Security Policy/.test(event.message)) logged.push(event.message);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (name) => {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    // A hidden window paints only when asked: two frames, then the picture.
    win.webContents.invalidate();
    await js('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const same = (label, got, want) => check(`${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`,
    JSON.stringify(got) === JSON.stringify(want));

  // A right-click on what `selector` finds; the menu it opened, as its lines.
  const menuOf = async (selector) => {
    await js(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      const box = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.x + 5, clientY: box.y + Math.min(8, box.height / 2) }));
    })()`);
    await settle(250);
    return js(`(() => {
      const menu = $('ctxMenu');
      if (!menu || menu.hidden) return null;
      return [...menu.querySelectorAll('.ctx-head, .menu-item, .ctx-note')].map((n) => n.classList.contains('menu-item')
        ? [n.querySelector('.mi-name').textContent, n.querySelector('.mi-sub') && n.querySelector('.mi-sub').textContent, n.disabled ? 'disabled' : null].filter(Boolean).join(' | ')
        : n.textContent);
    })()`);
  };
  const pick = async (label) => {
    const found = await js(`(() => {
      const item = [...$('ctxMenu').querySelectorAll('.menu-item')].find((n) => n.querySelector('.mi-name').textContent === ${JSON.stringify(label)});
      if (item) item.click();
      return Boolean(item);
    })()`);
    check(`"${label}" was in the menu`, found);
    await settle(300);
  };
  const click = async (selector) => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(400); };
  const hint = () => js(`$('hint').textContent`);
  const panel = () => js(`(() => {
    const p = $('agentsPanel');
    return { shown: !p.hidden, title: (p.querySelector('.ap-title') || {}).textContent || '',
      rendered: Boolean(p.querySelector('.fv-body.preview .markdown')), code: Boolean(p.querySelector('.fv-code')),
      text: (p.querySelector('.fv-body') || {}).textContent || '' };
  })()`);
  const button = (title) => js(`(() => {
    const b = $('agentsPanel').querySelector('.ap-head [title=${JSON.stringify(title)}], .fv-tools [title=${JSON.stringify(title)}]');
    if (b) b.click();
    return Boolean(b);
  })()`).then(async (found) => { check(`the panel has a "${title}" button`, found); await settle(400); });

  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await js(`
      $('settings').hidden = true;
      S.settings.hasKey = true;
      S.current = 'files';
      S.sessions = [
        { id: 'files', title: 'Horse video', executor: 'client', created_at: new Date().toISOString() },
        { id: 'cloud', title: 'In the cloud', executor: 'client', created_at: new Date().toISOString() },
      ];
      S.loaded.add('files');
      S.loaded.add('cloud');
      S.init.state.sessions.files = { cwd: ${JSON.stringify(cwd)} };
      S.transcripts.set('files', [
        { type: 'user', text: 'make a small video of it moving, and its legs too' },
        { type: 'assistant', text: ${JSON.stringify(ANSWER)} },
        { type: 'files', sessionId: 'files', files: [{ path: 'src/app.js', added: 14, removed: 0, created: true }], open: new Set() },
      ]);
      S.transcripts.set('cloud', [{ type: 'assistant', text: '[the report](out/report.pdf)' }]);
      renderSidebar(); renderMain();
    `);
    await settle(400);

    // ── Drawn ──
    const drawn = await js(`(() => ({
      absoluteLink: Boolean(document.querySelector('.markdown a[href^=${JSON.stringify(cwd.slice(0, 2))}]')),
      images: [...document.querySelectorAll('.markdown img[data-local-path]')]
        .map((img) => [img.src.slice(0, 26), img.complete && img.naturalWidth, img.naturalHeight]),
    }))()`);
    check('a link that names its drive survives the sanitizer', drawn.absoluteLink);
    same('both pictures, by relative and by full path, are shown through cf-local:', drawn.images,
      [['cf-local://image/?session=', 64, 48], ['cf-local://image/?session=', 64, 48]]);

    // ── A video ──
    let menu = await menuOf('.markdown a[href="out/run.mp4"]');
    await shot('menu-video');
    same('the video\'s menu', menu, ['out/run.mp4', 'Open with default app', 'Show in Explorer', 'Copy path', 'Copy relative path']);
    await pick('Open with default app');
    same('Open with default app opened the video', calls.opened, [at('out/run.mp4')]);
    check('the menu closes after a choice', await js(`$('ctxMenu').hidden`));
    await menuOf('.markdown a[href="out/run.mp4"]');
    await pick('Show in Explorer');
    same('Show in Explorer selected the video', calls.revealed, [at('out/run.mp4')]);
    await menuOf('.markdown a[href="out/run.mp4"]');
    await pick('Copy path');
    same('Copy path put the full path on the clipboard', await clipboard.readText(), at('out/run.mp4'));
    await menuOf('.markdown a[href="out/run.mp4"]');
    await pick('Copy relative path');
    same('Copy relative path put the folder\'s path on the clipboard', await clipboard.readText(), 'out/run.mp4');
    await click('.markdown a[href="out/run.mp4"]');
    same('a click on the video opens it with its app', calls.opened, [at('out/run.mp4'), at('out/run.mp4')]);

    // ── A picture ──
    menu = await menuOf('.markdown img[data-local-path="out/chart.png"]');
    await shot('menu-image');
    same('the picture\'s menu', menu, ['out/chart.png', 'View', 'Open with default app', 'Show in Explorer', 'Copy image', 'Copy path', 'Copy relative path']);
    await clipboard.writeText('before');
    await pick('Copy image');
    same('Copy image handed over the whole picture', handedImage(), { width: 64, height: 48, pixel: [0x40, 0x90, 0xe0, 0xff] });
    same('Copy image put the picture on the clipboard', await clipboardImage(), { width: 64, height: 48, pixel: [0x40, 0x90, 0xe0, 0xff] });
    check(`and said so: ${await hint()}`, (await hint()) === 'Image copied.');
    await menuOf('.markdown img[data-local-path="out/chart.png"]');
    await pick('Open with default app');
    same('Open with default app opened the picture', calls.opened.at(-1), at('out/chart.png'));
    await menuOf('.markdown img[data-local-path="out/chart.png"]');
    await pick('Show in Explorer');
    same('Show in Explorer selected the picture', calls.revealed.at(-1), at('out/chart.png'));
    await menuOf('.markdown img[data-local-path="out/chart.png"]');
    await pick('Copy path');
    same('the picture\'s path was copied', await clipboard.readText(), at('out/chart.png'));
    await menuOf('.markdown img[data-local-path="out/chart.png"]');
    await pick('View');
    check('View opens the viewer', await js(`Boolean(document.querySelector('#viewer .viewer-image[data-file-path="out/chart.png"]'))`));
    await settle(400);
    same('the viewer shows the full copy, through cf-local:', await js(`(() => {
      const img = document.querySelector('#viewer .viewer-image');
      return [img.src.startsWith('cf-local://image/?') && img.src.includes('full=1'), img.naturalWidth, img.naturalHeight];
    })()`), [true, 64, 48]);
    await settle(300);
    menu = await menuOf('#viewer .viewer-image');
    await shot('menu-viewer');
    same('the viewer\'s menu: no View, it is open', menu, ['out/chart.png', 'Open with default app', 'Show in Explorer', 'Copy image', 'Copy path', 'Copy relative path']);
    await clipboard.writeText('before');
    await pick('Copy image');
    same('Copy image from the viewer handed over the whole picture', handedImage(), { width: 64, height: 48, pixel: [0x40, 0x90, 0xe0, 0xff] });
    same('Copy image from the viewer', await clipboardImage(), { width: 64, height: 48, pixel: [0x40, 0x90, 0xe0, 0xff] });
    check('the viewer stays open after a choice', await js(`Boolean(document.getElementById('viewer'))`));
    await js(`closeViewer()`);
    await click('.markdown img[data-local-path="out/chart.png"]');
    check('a click on the picture opens the viewer', await js(`Boolean(document.getElementById('viewer'))`));
    await js(`closeViewer()`);
    menu = await menuOf(`.markdown img[data-local-path=${JSON.stringify(at('out/chart.png'))}]`);
    check(`the picture by its full path has the same menu: ${JSON.stringify(menu)}`, menu && menu.includes('Copy image') && menu[0] === 'out/chart.png');
    await js(`hideContextMenu()`);

    // ── A Markdown file, and the panel's buttons ──
    menu = await menuOf('.markdown a[href="notes.md"]');
    same('a text file\'s menu', menu, ['notes.md', 'Open in side panel', 'Open with default app', 'Show in Explorer', 'Copy path', 'Copy relative path']);
    await pick('Open in side panel');
    let shown = await panel();
    check(`Open in side panel shows the notes rendered: ${JSON.stringify(shown)}`, shown.shown && shown.title === 'notes.md' && shown.rendered);
    await shot('panel-markdown');
    await button('Show the source');
    shown = await panel();
    check(`"Show the source" shows the Markdown as text: ${JSON.stringify(shown.text.slice(0, 40))}`, shown.code && shown.text.includes('# Horse animation'));
    await button('Show it rendered');
    check('"Show it rendered" goes back', (await panel()).rendered);
    fs.appendFileSync(at('notes.md'), '- gallop\n');
    await button('Read the file again');
    check('"Read the file again" picks up the change', (await panel()).text.includes('gallop'));
    await button('Copy the contents');
    same('"Copy the contents" copies the file', await clipboard.readText(), `${NOTES}- gallop\n`);
    await button('Open with default app');
    same('the panel\'s "Open with default app"', calls.opened.at(-1), at('notes.md'));
    await button('Show in Explorer');
    same('the panel\'s "Show in Explorer"', calls.revealed.at(-1), at('notes.md'));
    await button('Close the panel');
    check('the panel closes', !(await panel()).shown);
    await click('.markdown a[href="notes.md"]');
    check('a click on the notes opens them in the panel', (await panel()).title === 'notes.md');
    await click(`.markdown a[href^=${JSON.stringify(cwd.slice(0, 2))}]`);
    check('a link by its full path opens the same file', (await panel()).title === 'notes.md');

    // ── Code, at a line ──
    await click('.markdown a[href="src/app.js:6"]');
    const code = await js(`(() => {
      const p = $('agentsPanel');
      return {
        title: (p.querySelector('.ap-title') || {}).textContent,
        lines: (p.querySelector('.fv-gutter') || {}).textContent.split('\\n').length,
        coloured: p.querySelectorAll('.fv-code .hljs-keyword').length > 3,
        mark: getComputedStyle(p.querySelector('.fv-mark')).getPropertyValue('--fv-at').trim(),
        meta: (p.querySelector('.fv-meta') || {}).textContent,
      };
    })()`);
    same('code opens coloured and numbered, its line marked', code, { title: 'app.js', lines: 13, coloured: true, mark: '5', meta: '13 lines · JavaScript' });
    await shot('panel-code');

    // ── A page, a script, a missing file, one outside the folder ──
    menu = await menuOf('.markdown a[href="out/page.html"]');
    same('a page\'s menu', menu, ['out/page.html', 'Open in side panel', 'Open in browser pane', 'Open with default app', 'Show in Explorer', 'Copy path', 'Copy relative path']);
    await pick('Open in browser pane');
    same('Open in browser pane loads the page there', calls.browsed, [at('out/page.html')]);
    check('and the browser pane opens', await js(`TERM.open && TERM.view === 'browser'`));
    await click('.markdown a[href="out/page.html"]');
    same('a click on the page opens it in the browser pane', calls.browsed.length, 2);

    menu = await menuOf('.markdown a[href="setup.bat"]');
    same('a script\'s menu says it asks first', menu, ['setup.bat', 'Open in side panel', 'Open with default app | A program or script: asks before it runs', 'Show in Explorer', 'Copy path', 'Copy relative path']);
    const before = calls.opened.length;
    await pick('Open with default app');
    same('opening it asked', calls.asked, ['Open setup.bat?']);
    same('and a "Cancel" left it closed', calls.opened.length, before);
    await click('.markdown a[href="setup.bat"]');
    check('a click on a script shows it in the panel, never runs it', (await panel()).title === 'setup.bat' && calls.opened.length === before);

    menu = await menuOf('.markdown a[href="out/missing.txt"]');
    same('a missing file\'s menu', menu, ['out/missing.txt', 'This file is not there.', 'Copy path']);
    await js(`hideContextMenu()`);
    await click('.markdown a[href="out/missing.txt"]');
    same('a click on it says so', await hint(), 'out/missing.txt is not there.');

    menu = await menuOf('.markdown a[href="../outside.txt"]');
    same('a file beside the folder can be opened, not read', menu, [path.join(root, 'outside.txt'),
      'Open in side panel | Only for files in the session folder | disabled', 'Open with default app', 'Show in Explorer', 'Copy path']);
    await pick('Show in Explorer');
    same('Show in Explorer reaches it', calls.revealed.at(-1), path.join(root, 'outside.txt'));
    await click('.markdown a[href="../outside.txt"]');
    same('a click opens it with its app', calls.opened.at(-1), path.join(root, 'outside.txt'));

    // ── A web link, and selected text ──
    menu = await menuOf('.markdown a[href="https://codingfleet.com/"]');
    same('a web link\'s menu', menu, ['Open link', 'Open in browser pane', 'Copy link address']);
    await pick('Open link');
    same('Open link hands it to the browser', calls.windows, ['https://codingfleet.com/']);
    await menuOf('.markdown a[href="https://codingfleet.com/"]');
    await pick('Open in browser pane');
    same('Open in browser pane goes there', calls.navigated, ['https://codingfleet.com/']);
    await menuOf('.markdown a[href="https://codingfleet.com/"]');
    await pick('Copy link address');
    same('Copy link address', await clipboard.readText(), 'https://codingfleet.com/');

    await js(`(() => {
      const p = document.querySelector('.msg.assistant .markdown p');
      const range = document.createRange();
      range.selectNodeContents(p);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    })()`);
    menu = await menuOf('.msg.assistant .markdown p');
    same('selected text can be copied', menu, ['Copy']);
    await pick('Copy');
    same('Copy copies the selection', await clipboard.readText(), 'Here is the horse, and its legs move too.');
    await js(`getSelection().removeAllRanges()`);

    // ── The edited files, and the uncommitted changes ──
    // Windows runs a .js file it opens (Windows Script Host): it asks first.
    const runsJs = 'Open with default app | A program or script: asks before it runs';
    menu = await menuOf('.files-card .file-row');
    same('an edited file\'s menu', menu, ['src/app.js', 'Open in side panel', runsJs, 'Show in Explorer', 'Copy path', 'Copy relative path']);
    await button('Close the panel');
    await menuOf('.files-card .file-row');
    await pick('Open in side panel');
    check('it opens in the panel', (await panel()).title === 'app.js');
    await js(`
      S.git = { repo: { root: ${JSON.stringify(cwd.replace(/\\/g, '/'))}, name: 'tutorial', branch: 'main' },
        files: [{ path: 'src/app.js', added: 14, removed: 0, status: 'untracked', binary: false }], added: 14, removed: 0, count: 1 };
      openChangesMenu();
    `);
    menu = await menuOf('#changesList .file-row');
    same('an uncommitted file\'s menu', menu, ['src/app.js', 'Open in side panel', runsJs, 'Show in Explorer', 'Copy path', 'Copy relative path']);
    check('the changes list stays open under it', await js(`!$('changesMenu').hidden`));
    await pick('Show in Explorer');
    same('Show in Explorer from the changes list', calls.revealed.at(-1), at('src/app.js'));
    await js(`closeMenus()`);

    // ── Beside the sub-agents ──
    await click('.markdown a[href="notes.md"]');
    await js(`ensureAgent('files', 'a1', { role: 'Researcher', status: 'done', loaded: true }); renderPanel();`);
    check('a file stays in the panel when there are sub-agents', (await panel()).title === 'notes.md');
    await button('Show the sub-agents (1)');
    check('the robot button shows the sub-agents', (await panel()).title === 'Sub-agents');
    await button('Show notes.md');
    check('and the file button goes back to the file', (await panel()).title === 'notes.md');
    await js(`onAgentEvent('files', 'subagent.started', { agent_id: 'a2', role: 'Reviewer', task: 'review' })`);
    await settle(300);
    check('a sub-agent that starts does not take the file\'s place', (await panel()).title === 'notes.md');
    await js(`openPanel('a2')`);
    check('a sub-agent asked for by name is shown', (await panel()).title === 'Sub-agents');

    // ── A cloud session ──
    // Switching redraws the composer, which clears the hint line: settled first.
    await js(`selectSession('cloud')`);
    await settle(1200);
    await js(`document.querySelector('.markdown a[href="out/report.pdf"]').click()`);
    await settle(100);
    same('a link in a cloud session says where the file is', await hint(), 'out/report.pdf is in the cloud sandbox, not on this computer.');
    menu = await menuOf('.markdown a[href="out/report.pdf"]');
    same('and its menu only copies the path', menu, ['out/report.pdf', 'This file is in the cloud sandbox, not on this computer.', 'Copy path']);
    await js(`hideContextMenu()`);

    check(`no errors in the window: ${JSON.stringify(logged)}`, !logged.length);
  } catch (err) {
    failures.push(err.stack || err.message);
  }
  if (saved) await clipboard.write(saved).catch(() => {});
  if (failures.length) console.log(`FAILED (${passed} passed):\n - ${failures.join('\n - ')}`);
  else console.log(`PASS file links: ${passed} checks`);
  app.exit(failures.length ? 1 : 0);
});
