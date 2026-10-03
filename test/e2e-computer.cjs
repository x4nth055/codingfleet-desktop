'use strict';
// Live end-to-end test of the computer tool on this machine: the real mouse,
// keyboard, UI Automation, screenshots, the pill, the Stop key, and the app
// window stepping aside. Every input goes to a test window this script opens
// (kept on top), never to another app; the pointer is put back at the end.
//   npx electron test/e2e-computer.cjs        (Windows; the screen must be unlocked)
const { app, BrowserWindow, globalShortcut, nativeImage, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-computer-e2e-')));



const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseElements(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^\[(\d+)\] (\w+)(?: "([^"]*)")? \((\d+),(\d+)\)(.*)$/.exec(line);
    if (m) out.push({ n: Number(m[1]), type: m[2], name: m[3] || '', x: Number(m[4]), y: Number(m[5]), rest: m[6] });
  }
  return out;
}

app.whenReady().then(async () => {
  // Chromium shows its page to UI Automation only when asked to.
  app.setAccessibilitySupportEnabled(true);
  if (process.platform !== 'win32') {
    console.log('SKIP  the live computer test runs on Windows');
    app.exit(0);
    return;
  }
  const { createComputer } = require('../src/main/computer');
  const { WindowsComputer } = require('../src/main/computer/win');
  const core = require('../src/core/computer');
  const probe = new WindowsComputer({ cacheDir: path.join(app.getPath('userData'), 'probe') });
  const cursorAtStart = await probe.cursor();

  const primary = screen.getPrimaryDisplay();
  const area = primary.workArea;
  // The app's own window, where a user would be watching: on the same screen,
  // so it has to step aside.
  const appWin = new BrowserWindow({ x: area.x + area.width - 520, y: area.y + 60, width: 480, height: 400, show: true, title: 'Fake CodingFleet' });
  await appWin.loadURL('data:text/html,<title>Fake CodingFleet</title><body style="background:%23224">app</body>');
  const target = new BrowserWindow({ x: area.x + 60, y: area.y + 60, width: 900, height: 640, show: false, title: 'Computer use target' });
  target.setAlwaysOnTop(true, 'floating');
  await target.loadFile(path.join(__dirname, 'fixtures', 'computer-page.html'));
  target.show();
  target.focus();
  await wait(600);
  const page = (js) => target.webContents.executeJavaScript(js);

  const stops = [];
  const images = [];
  const logs = [];
  const computer = createComputer({
    getWindow: () => appWin,
    enabled: () => true,
    cacheDir: path.join(app.getPath('userData'), 'computer'),
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    onStop: (sessionId) => stops.push(sessionId),
    onImage: (sessionId, data) => images.push({ sessionId, ...data }),
    // This one process plays both the app and the app the agent works in.
    isOwnWindow: (w) => Boolean(w) && ['Fake CodingFleet', 'CodingFleet is using your computer'].includes(w.title),
  });
  let n = 0;
  const controller = new AbortController();
  const act = async (args) => {
    const started = Date.now();
    const result = await computer.forAgent('S1', args, { call: { id: `call${++n}` }, signal: controller.signal });
    result.ms = Date.now() - started;
    if (result.is_error) console.log(`      (${args.action} answered) ${typeof result.output === 'string' ? result.output : result.output.text}`);
    return result;
  };
  const text = (r) => (typeof r.output === 'string' ? r.output : r.output.text);

  try {
    // ── Windows and focus ─────────────────────────────────────────────────
    let r = await act({ action: 'windows' });
    check('windows lists the target, not this app\'s own window', !r.is_error && /"Computer use target"/.test(text(r)),
      text(r).split('\n').slice(0, 4).join(' | '));
    check('windows answers in text, without a picture', !r.output.data);

    r = await act({ action: 'focus_window', window: 'computer use target' });
    check('focus_window brings the window forward', !r.is_error && /Brought "Computer use target" to the front/.test(text(r)), text(r));
    check('the app window stepped aside (it covered the screen)', appWin.isMinimized());
    check('Stop key is held while the agent has the computer', globalShortcut.isRegistered(core.STOP_ACCELERATOR));
    const pill = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'CodingFleet is using your computer');
    check('the pill is up', pill && pill.isVisible());
    check('the pill never takes the focus', pill && !pill.isFocusable());
    if (typeof appWin.isContentProtected === 'function') {
      check('the pill and the app window are kept out of screenshots', pill.isContentProtected() && appWin.isContentProtected());
    }

    // ── The picture ───────────────────────────────────────────────────────
    const frame = core.frameFor(screen.getDisplayMatching(target.getBounds()));
    check('a picture comes back after an action', Boolean(r.output.data) && r.output.width === frame.width && r.output.height === frame.height,
      `${r.output.width}x${r.output.height}`);
    const decoded = nativeImage.createFromBuffer(Buffer.from(r.output.data || '', 'base64'));
    check('the picture is an image of that size', !decoded.isEmpty() && decoded.getSize().width === frame.width);
    check('the picture is small enough to send', (r.output.data || '').length < 600_000, `${Math.round((r.output.data || '').length / 1024)} KB base64`);
    check('the step in the chat gets its picture', images.length === 1 && images[0].id === 'call2');

    // ── The UI tree ───────────────────────────────────────────────────────
    r = await act({ action: 'elements', window: 'Computer use target' });
    const listed = parseElements(text(r));
    const find = (type, name) => listed.find((e) => e.type === type && e.name === name);
    const nameBox = find('Edit', 'Name');
    const go = find('Button', 'Go');
    const agree = find('CheckBox', 'I agree');
    check('elements reads the page through UI Automation', Boolean(nameBox && go && agree), `${listed.length} elements, in ${r.ms} ms`);
    check('elements returns no picture by default', !r.output.data);
    console.log(text(r).split('\n').slice(0, 12).map((l) => `      ${l}`).join('\n'));

    // ── Input ─────────────────────────────────────────────────────────────
    r = await act({ action: 'click', element: go.n, screenshot: false });
    check('click on an element', !r.is_error && (await page('window.seen.go')) === 1, `${text(r)} (${r.ms} ms)`);

    r = await act({ action: 'type', element: nameBox.n, text: 'héllo wörld ✓ 123', screenshot: false });
    check('type into a field, any characters', (await page("document.getElementById('name').value")) === 'héllo wörld ✓ 123',
      JSON.stringify(await page("document.getElementById('name').value")));

    await act({ action: 'key', keys: 'ctrl+a', screenshot: false });
    await act({ action: 'type', text: 'replaced', screenshot: false });
    check('key combination, then type over the selection', (await page("document.getElementById('name').value")) === 'replaced');

    r = await act({ action: 'click', element: agree.n, screenshot: false });
    check('click a checkbox', await page("document.getElementById('agree').checked"));
    r = await act({ action: 'elements', window: 'Computer use target', query: 'agree' });
    check('elements shows its new state, and query narrows the list', /CheckBox "I agree" \(\d+,\d+\).* checked/.test(text(r))
      && parseElements(text(r)).length <= 2, text(r).split('\n').slice(1).join(' | '));

    // By coordinates, the way a model reads them off the picture.
    r = await act({ action: 'click', x: go.x, y: go.y, screenshot: false });
    check('click by x,y from the picture', (await page('window.seen.go')) === 2, text(r));

    r = await act({ action: 'elements', window: 'Computer use target' });
    const all = parseElements(text(r));
    const named = (name) => all.find((e) => e.name === name);
    r = await act({ action: 'double_click', element: named('Double target').n, screenshot: false });
    check('double_click', (await page('window.seen.dbl')) === 1);
    r = await act({ action: 'right_click', element: named('Context target').n, screenshot: false });
    check('right_click', (await page('window.seen.ctx')) === 1);
    r = await act({ action: 'move', element: named('Hover target').n, screenshot: false });
    check('move (hover)', (await page('window.seen.hover')) >= 1);
    r = await act({ action: 'drag', element: named('Drag from').n, to_element: named('Drag to').n, screenshot: false });
    const drag = await page('[window.seen.down, window.seen.up]');
    check('drag from one element to another', drag[0] === 'from' && drag[1] === 'to', JSON.stringify(drag));
    // The scroll box is not a control, so it is not listed: a model scrolls it
    // at a point it reads off the picture.
    const box = await page("(() => { const r = document.getElementById('scroller').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()");
    const content = target.getContentBounds();
    const at = core.toPicture(frame, content.x + box[0], content.y + box[1]);
    r = await act({ action: 'scroll', x: at.x, y: at.y, direction: 'down', amount: 4, screenshot: false });
    const top = await page("document.getElementById('scroller').scrollTop");
    check('scroll', top > 0, `scrollTop ${top}`);
    r = await act({ action: 'type', element: named('Notes').n, text: 'line one\nline two', screenshot: false });
    check('type a line break as Enter', (await page("document.getElementById('notes').value")) === 'line one\nline two',
      JSON.stringify(await page("document.getElementById('notes').value")));
    r = await act({ action: 'key', keys: 'ctrl+a backspace' });
    check('a key sequence', (await page("document.getElementById('notes').value")) === '', text(r));
    check('an action names the active window', /Active window: "Computer use target"/.test(text(r)), text(r));
    r = await act({ action: 'wait', seconds: 0.2 });
    check('wait, then a picture', !r.is_error && Boolean(r.output.data));

    // ── A list belongs to its window ──────────────────────────────────────
    const other = new BrowserWindow({ x: area.x + 200, y: area.y + 200, width: 400, height: 300, show: true, title: 'Other window' });
    await other.loadURL('data:text/html,<title>Other window</title><body>other</body>');
    other.setAlwaysOnTop(true, 'floating');
    await act({ action: 'focus_window', window: 'Other window', screenshot: false });
    r = await act({ action: 'click', element: go.n, screenshot: false });
    check('an element list stops holding when another window comes to the front',
      r.is_error && /window in front changed .*"Other window"/.test(text(r)) && (await page('window.seen.go')) === 2);
    other.destroy();
    await act({ action: 'focus_window', window: 'Computer use target', screenshot: false });
    r = await act({ action: 'elements', window: 'Computer use target' });
    const relisted = parseElements(text(r)).find((e) => e.type === 'Button' && e.name === 'Go');
    r = await act({ action: 'click', element: relisted.n, screenshot: false });
    check('after listing again, elements work again', !r.is_error && (await page('window.seen.go')) === 3);

    // ── Mistakes come back as words ───────────────────────────────────────
    r = await act({ action: 'click', element: 999 });
    check('an element that is not listed', r.is_error && /no element 999.*Call elements again/.test(text(r)));
    r = await act({ action: 'key', keys: 'ctrl+alt+esc' });
    check('the agent cannot press the Stop key', r.is_error && /stop you/.test(text(r)));
    r = await act({ action: 'focus_window', window: 'no such window xyz' });
    check('focus_window on a window that is not open lists the open ones', r.is_error && /Open windows:/.test(text(r)));
    r = await act({ action: 'click', x: 10, y: 10, screen: 9 });
    check('a screen that does not exist', r.is_error && /no screen 9/.test(text(r)));

    // ── Stop ──────────────────────────────────────────────────────────────
    // The user's key, pressed for real.
    await probe.keys([[[0x11, false], [0x12, false], [0x1B, false]]]);
    await wait(400);
    check('the Stop key stops the run', stops.includes('S1'), JSON.stringify(stops));
    check('after Stop the key is let go', !globalShortcut.isRegistered(core.STOP_ACCELERATOR));
    check('after Stop the pill is down', pill.isDestroyed() || !pill.isVisible());
    check('after Stop the app window is back', !appWin.isMinimized());
    r = await act({ action: 'click', element: go.n });
    check('after Stop the agent is refused', r.is_error && /stopped computer use/.test(text(r)));

    // A new run starts clean, and ending it hands everything back.
    computer.endRun('S1');
    r = await act({ action: 'key', keys: 'escape', screenshot: false });
    check('the next run may use the computer again', !r.is_error, text(r));
    computer.endRun('S1');
    check('a run that ends lets go of the key', !globalShortcut.isRegistered(core.STOP_ACCELERATOR));
    check('a run that ends brings the app window back', !appWin.isMinimized());

    // ── take_screenshot while the agent has the computer: the same frame ──
    await act({ action: 'wait', seconds: 0.1 });
    const shot = await computer.screenshotFor('S1', null);
    check('take_screenshot uses the frame the actions use', shot.frame.width === frame.width && shot.frame.height === frame.height);
    computer.endRun('S1');
  } catch (err) {
    check('no exception', false, err.stack);
  } finally {
    await probe.move(cursorAtStart[0], cursorAtStart[1]).catch(() => {});
    probe.stop();
    computer.dispose();
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    app.exit(failed ? 1 : 0);
  }
});
