'use strict';
// The computer tool's plain logic (src/core/computer.js), its words in the
// window and its approval rule, and on Windows the helper process itself:
// compiled from win-helper.cs and answering the read-only requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const computer = require('../src/core/computer');
const guard = require('../src/core/guard');
const tools = require('../src/core/tools');
const words = require('../src/renderer/lib/tool-words');

test('every action is checked and filled in, with errors the model can act on', () => {
  assert.match(computer.normalizeAction({}).error, /Unknown action ''/);
  assert.match(computer.normalizeAction({ action: 'hover' }).error, /Unknown action 'hover'.*click/);
  assert.match(computer.normalizeAction({ action: 'click' }).error, /needs x and y .* or an element/);
  assert.match(computer.normalizeAction({ action: 'click', x: 5 }).error, /needs x and y/);

  const click = computer.normalizeAction({ action: 'click', x: '10.4', y: 20 });
  assert.deepEqual(click, { action: 'click', x: 10, y: 20, screenshot: true });
  assert.equal(computer.normalizeAction({ action: 'CLICK', element: 3 }).element, 3);
  assert.equal(computer.normalizeAction({ action: 'click', element: 3, screenshot: false }).screenshot, false);

  assert.match(computer.normalizeAction({ action: 'drag', x: 1, y: 2 }).error, /to_x and to_y/);
  const drag = computer.normalizeAction({ action: 'drag', element: 1, to_x: 9, to_y: 8 });
  assert.equal(drag.toX, 9);
  assert.equal(drag.toY, 8);
  assert.equal(computer.normalizeAction({ action: 'drag', x: 1, y: 2, to_element: 4 }).toElement, 4);

  const scroll = computer.normalizeAction({ action: 'scroll' });
  assert.equal(scroll.direction, 'down');
  assert.equal(scroll.amount, 3);
  assert.equal(computer.normalizeAction({ action: 'scroll', amount: 900 }).amount, 25);
  assert.match(computer.normalizeAction({ action: 'scroll', direction: 'sideways' }).error, /direction/);

  assert.match(computer.normalizeAction({ action: 'type' }).error, /needs text/);
  assert.match(computer.normalizeAction({ action: 'type', text: 'x'.repeat(5001) }).error, /at most 5000/);
  assert.equal(computer.normalizeAction({ action: 'type', text: 'hi', element: 2 }).element, 2);

  const key = computer.normalizeAction({ action: 'key', keys: 'ctrl+s' });
  assert.deepEqual(key.keys, [['ctrl', 's']]);
  assert.equal(key.keysText, 'ctrl+s');
  assert.match(computer.normalizeAction({ action: 'key' }).error, /needs keys/);

  assert.equal(computer.normalizeAction({ action: 'wait', seconds: 99 }).seconds, 10);
  assert.equal(computer.normalizeAction({ action: 'wait' }).seconds, 1);
  assert.match(computer.normalizeAction({ action: 'focus_window' }).error, /needs window/);
  assert.equal(computer.normalizeAction({ action: 'focus_window', window: ' Notepad ' }).window, 'Notepad');
  assert.equal(computer.normalizeAction({ action: 'click', x: 1, y: 1, screen: 2 }).screen, 2);
});

test('read-only actions answer in text; actions that change the screen return a picture', () => {
  for (const action of ['elements', 'windows']) {
    assert.equal(computer.normalizeAction({ action }).screenshot, false, action);
    assert.equal(computer.normalizeAction({ action, screenshot: true }).screenshot, true, action);
  }
  for (const [action, extra] of [['click', { x: 1, y: 1 }], ['key', { keys: 'enter' }], ['type', { text: 'a' }],
    ['scroll', {}], ['wait', {}], ['focus_window', { window: 'x' }]]) {
    assert.equal(computer.normalizeAction({ action, ...extra }).screenshot, true, action);
  }
  const elements = computer.normalizeAction({ action: 'elements', window: 'Chrome', query: 'Save' });
  assert.equal(elements.window, 'Chrome');
  assert.equal(elements.query, 'Save');
});

test('keys: aliases, combos in sequence, the plus key, and the keys an agent may not press', () => {
  assert.deepEqual(computer.parseKeys('Control+Shift+S').combos, [['ctrl', 'shift', 's']]);
  assert.deepEqual(computer.parseKeys('ctrl+a Backspace').combos, [['ctrl', 'a'], ['backspace']]);
  assert.deepEqual(computer.parseKeys(['cmd+c', 'cmd+v']).combos, [['cmd', 'c'], ['cmd', 'v']]);
  assert.deepEqual(computer.parseKeys('Return esc PgDn ArrowUp').combos, [['enter'], ['escape'], ['pagedown'], ['up']]);
  assert.deepEqual(computer.parseKeys('ctrl++').combos, [['ctrl', 'plus']]);
  assert.deepEqual(computer.parseKeys('alt+f4').combos, [['alt', 'f4']]);
  assert.match(computer.parseKeys('ctrl+').error, /not a key combination/);
  assert.match(computer.parseKeys('hyper+x').error, /Unknown key 'hyper'.*type action/);
  assert.match(computer.parseKeys('ctrl+alt+esc').error, /stop you/);
  assert.match(computer.parseKeys('alt+ctrl+escape').error, /stop you/);
  assert.match(computer.parseKeys('ctrl+alt+del').error, /cannot be sent/);
  assert.match(computer.parseKeys(Array(21).fill('a').join(' ')).error, /At most 20/);
});

test('keys become Windows virtual keys, extended where the keyboard sends E0', () => {
  const [combo] = computer.windowsCombos([['ctrl', 'shift', 'right']]);
  assert.deepEqual(combo, [[0x11, false], [0x10, false], [0x27, true]]);
  assert.deepEqual(computer.windowsCombos([['f5'], ['a'], ['7'], ['win', 'r']]),
    [[[0x74, false]], [[0x41, false]], [[0x37, false]], [[0x5B, true], [0x52, false]]]);
  assert.deepEqual(computer.windowsCombos([['delete'], ['home']]), [[[0x2E, true]], [[0x24, true]]]);
});

test('keys become macOS key codes with modifier flags', () => {
  assert.deepEqual(computer.macCombos([['cmd', 's']]), [{ code: 1, flags: 0x100000 }]);
  assert.deepEqual(computer.macCombos([['ctrl', 'shift', 'tab']]), [{ code: 48, flags: 0x40000 | 0x20000 }]);
  assert.deepEqual(computer.macCombos([['enter'], ['left']]), [{ code: 36, flags: 0 }, { code: 123, flags: 0 }]);
  assert.deepEqual(computer.macCombos([['cmd']]), [{ code: null, flags: 0x100000 }]);
});

test('a frame is the picture of one display, at most 1280 pixels on its long side', () => {
  const hd = computer.frameFor({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 });
  assert.deepEqual([hd.width, hd.height], [1280, 720]);
  // A 150% laptop: 1280x720 points, 1920x1080 pixels.
  const laptop = computer.frameFor({ id: 2, bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 });
  assert.deepEqual([laptop.width, laptop.height], [1280, 720]);
  const small = computer.frameFor({ id: 3, bounds: { x: 0, y: 0, width: 1024, height: 768 }, scaleFactor: 1 });
  assert.deepEqual([small.width, small.height], [1024, 768], 'never enlarged');
  const portrait = computer.frameFor({ id: 4, bounds: { x: 0, y: 0, width: 1080, height: 1920 }, scaleFactor: 1 });
  assert.deepEqual([portrait.width, portrait.height], [720, 1280]);
});

test('a point in the picture lands on the right spot of a display left of the primary one', () => {
  // The second screen of this very machine: 2560x1440 at x=-2560.
  const frame = computer.frameFor({ id: 7, bounds: { x: -2560, y: -120, width: 2560, height: 1440 }, scaleFactor: 1 });
  assert.deepEqual([frame.width, frame.height], [1280, 720]);
  const p = computer.toScreen(frame, 640, 360);
  assert.equal(Math.round(p.x), -1279);
  assert.equal(Math.round(p.y), 601);
  assert.deepEqual(computer.toPicture(frame, p.x, p.y), { x: 640, y: 360 });
  // Corners stay on the display, and a point beyond it is clamped.
  const corner = computer.toScreen(frame, 5000, -40);
  assert.ok(corner.x < 0 && corner.x > -2560 && corner.y >= -120, JSON.stringify(corner));
  assert.equal(computer.toPicture(frame, 10, 10), null, 'the primary screen is not on this picture');
  for (let x = 0; x < frame.width; x += 97) {
    const s = computer.toScreen(frame, x, 100);
    assert.deepEqual(computer.toPicture(frame, s.x, s.y), { x, y: 100 });
  }
});

const FRAME = computer.frameFor({ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1 });

test('the UI tree is written as numbered lines in screenshot pixels, things to act on first', () => {
  const items = [
    { t: 'Pane', n: 'Notepad', r: [0, 0, 1280, 800] },
    { t: 'MenuItem', n: 'File', r: [10, 30, 40, 20] },
    { t: 'Edit', n: 'Text editor', v: 'hello world', r: [0, 60, 1280, 700], focus: true, kf: true },
    { t: 'Button', n: 'Save', r: [600, 770, 80, 24] },
    { t: 'Text', n: 'Save', r: [610, 774, 30, 16] },
    { t: 'CheckBox', n: 'Word wrap', r: [100, 30, 90, 20], on: false },
    { t: 'Button', n: 'Disabled one', r: [700, 770, 80, 24], off: true },
    { t: 'Text', n: 'Ln 1, Col 12', r: [900, 780, 80, 16] },
    { t: 'Button', n: '', r: [1250, 0, 30, 30] },
    { t: 'Button', n: 'Elsewhere', r: [5000, 10, 30, 30] },
    { t: 'Separator', n: 'line', r: [0, 50, 1280, 2] },
  ];
  const { text, targets } = computer.describeElements({ window: { title: 'notes.txt - Notepad', app: 'Notepad' }, items }, FRAME);
  const lines = text.split('\n');
  assert.match(lines[0], /^Window "notes.txt - Notepad" \(Notepad\)\. 7 elements; \(x,y\) is the center/);
  assert.ok(lines.includes('[2] MenuItem "File" (30,40)'), text);
  assert.match(text, /CheckBox "Word wrap" \(145,40\) unchecked/);
  assert.match(text, /Edit "Text editor" \(640,410\) value="hello world" focused/);
  assert.match(text, /Button "Disabled one" \(740,782\) disabled/);
  assert.match(text, /Text "Ln 1, Col 12"/);
  assert.doesNotMatch(text, /Text "Save"/, 'a label inside its button is not listed twice');
  assert.doesNotMatch(text, /Elsewhere|Separator|Pane/);
  assert.match(text, /\[\d\] Button \(1265,15\)/, 'a nameless button is still something to click');
  // Reading order: the top row first, left to right.
  assert.ok(text.indexOf('"File"') < text.indexOf('"Word wrap"'));
  assert.ok(text.indexOf('"Word wrap"') < text.indexOf('"Text editor"'));
  const save = [...targets.values()].find((t) => t.label === 'Button "Save"');
  assert.deepEqual([save.x, save.y], [640, 782]);
});

test('elements: a query narrows the list, and long lists say how to narrow them', () => {
  const items = Array.from({ length: 400 }, (_, i) => ({ t: 'ListItem', n: `Row ${i}`, r: [10, 10 + i * 1.8, 300, 1.5 + 1] }));
  const all = computer.describeElements({ window: { title: 'Big' }, items }, FRAME);
  assert.equal(all.targets.size, 150);
  assert.match(all.text, /Showing 150 of 400: add query to narrow it/);
  const some = computer.describeElements({ window: { title: 'Big' }, items }, FRAME, { query: 'row 12' });
  assert.deepEqual([...some.targets.values()].map((t) => t.label),
    ['ListItem "Row 12"', 'ListItem "Row 120"', 'ListItem "Row 121"', 'ListItem "Row 122"', 'ListItem "Row 123"',
      'ListItem "Row 124"', 'ListItem "Row 125"', 'ListItem "Row 126"', 'ListItem "Row 127"', 'ListItem "Row 128"', 'ListItem "Row 129"']);
  const none = computer.describeElements({ window: { title: 'Big' }, items }, FRAME, { query: 'zzz' });
  assert.match(none.text, /Nothing matches 'zzz'/);
  const empty = computer.describeElements({ window: { title: 'Game' }, items: [] }, FRAME);
  assert.match(empty.text, /exposes no UI elements .* Use the screenshot/);
});

test('elements: long names are cut, quotes cannot break a line', () => {
  const items = [{ t: 'Hyperlink', n: `Say "hi" ${'x'.repeat(200)}`, r: [0, 0, 50, 20] }];
  const { text } = computer.describeElements({ window: { title: 'W' }, items }, FRAME);
  const line = text.split('\n')[1];
  assert.match(line, /^\[1\] Hyperlink "Say 'hi' x+…" \(25,10\)$/);
  assert.ok(line.length < 110);
});

test('windows are matched by title or app, exact before partial', () => {
  const list = [
    { title: 'Inbox - Outlook', app: 'OUTLOOK' },
    { title: 'notes.txt - Notepad', app: 'Notepad' },
    { title: 'Notepad++', app: 'notepad++' },
    { title: '', app: 'ghost' },
  ];
  assert.equal(computer.matchWindow(list, 'notepad').title, 'notes.txt - Notepad');
  assert.equal(computer.matchWindow(list, 'NOTEPAD++').title, 'Notepad++');
  assert.equal(computer.matchWindow(list, 'outlook').title, 'Inbox - Outlook');
  assert.equal(computer.matchWindow(list, 'inbox').title, 'Inbox - Outlook');
  assert.equal(computer.matchWindow(list, 'ghost'), null);
  assert.equal(computer.matchWindow(list, ''), null);
  assert.match(computer.describeWindows(list), /^Open windows:\n- "Inbox - Outlook" \(OUTLOOK\)\n- "notes.txt - Notepad"/);
  assert.equal(computer.describeWindows([]), 'No windows are open.');
  const desktop = computer.describeWindows([
    { title: 'Hidden', app: 'x', minimized: true }, { title: 'Program Manager', app: 'explorer' }, { title: 'Shown', app: 'y' },
  ]);
  assert.equal(desktop, ['Open windows:', '- "Shown" (y)', '- "Hidden" (x) minimized'].join('\n'));
});

test('computer use is offered only to a session on this computer, never to a cloud sandbox', () => {
  const allowed = (o) => computer.computerUseAllowed({ enabled: true, supported: true, executor: 'client', cwd: 'C:/work', ...o });
  assert.equal(allowed({}), true);
  assert.equal(allowed({ executor: 'sandbox' }), false, 'a cloud sandbox');
  assert.equal(allowed({ executor: 'sandbox', cwd: 'C:/work' }), false, 'a sandbox session that somehow has a folder');
  assert.equal(allowed({ executor: undefined }), false);
  assert.equal(allowed({ cwd: null }), false, 'a client session with no folder chosen yet');
  assert.equal(allowed({ enabled: false }), false, 'turned off in Preferences');
  assert.equal(allowed({ enabled: undefined }), false, 'off by default');
  assert.equal(allowed({ supported: false }), false, 'Linux');
});

test('what each action did, in words', () => {
  const words_ = (args, target) => computer.actionWords(computer.normalizeAction(args), target);
  assert.equal(words_({ action: 'click', x: 1, y: 2 }, '(1,2)'), 'Clicked (1,2)');
  assert.equal(words_({ action: 'type', text: 'abc' }), 'Typed 3 characters');
  assert.equal(words_({ action: 'key', keys: 'ctrl+s' }), 'Pressed ctrl+s');
  assert.equal(words_({ action: 'scroll', direction: 'up', amount: 2 }), 'Scrolled up 2');
  assert.equal(words_({ action: 'focus_window', window: 'x' }, '"X"'), 'Brought "X" to the front');
});

test('computer use is asked about even in auto mode; a session may allow it', () => {
  assert.equal(tools.approvalReason('computer', { action: 'elements' }, os.tmpdir()), guard.COMPUTER);
  assert.equal(tools.approvalReason('computer', { action: 'click', x: 1, y: 1 }, os.tmpdir()), guard.COMPUTER);
  assert.equal(guard.mustAsk(guard.COMPUTER, { auto: true, allowedThisSession: false }), true);
  assert.equal(guard.mustAsk(guard.COMPUTER, { auto: true, allowedThisSession: true }), false);
  assert.equal(guard.mustAsk(guard.COMPUTER, { auto: false, allowedThisSession: true }), false);
  assert.equal(guard.ALWAYS_ASK.has(guard.COMPUTER), false);
  assert.equal(words.ALLOW_LABELS[guard.COMPUTER], 'Allow computer use this session');
  assert.ok(words.REASONS[guard.COMPUTER]);
  // It is the desktop's own tool, never a plain client tool.
  assert.equal(tools.CLIENT_TOOLS.has('computer'), false);
});

test('the window names each computer step', () => {
  const s = (args) => words.toolSummary({ name: 'computer', arguments: args });
  assert.deepEqual(s({ action: 'click', element: 4 }), ['Click', 'element 4']);
  assert.deepEqual(s({ action: 'double_click', x: 3, y: 9 }), ['Double-click', '3, 9']);
  assert.deepEqual(s({ action: 'type', text: 'hello' }), ['Type', 'hello']);
  assert.deepEqual(s({ action: 'key', keys: 'ctrl+s' }), ['Press', 'ctrl+s']);
  assert.deepEqual(s({ action: 'scroll', direction: 'up', x: 1, y: 2 }), ['Scroll', 'up at 1, 2']);
  assert.deepEqual(s({ action: 'elements' }), ['Read the screen', 'the window in front']);
  assert.deepEqual(s({ action: 'focus_window', window: 'Excel' }), ['Switch to', 'Excel']);
  assert.deepEqual(s({ action: 'drag', x: 1, y: 2, to_x: 3, to_y: 4 }), ['Drag', '1, 2 to 3, 4']);
  assert.equal(words.groupSummary([{ name: 'computer', arguments: {} }, { name: 'computer', arguments: {} }]),
    'Used the computer 2 times');
});

test('the macOS script is valid JavaScript for osascript', () => {
  const { SCRIPT } = require('../src/main/computer/mac');
  // JXA is JavaScriptCore; parsing it here catches a syntax slip before a Mac does.
  assert.doesNotThrow(() => new Function(SCRIPT));
  assert.match(SCRIPT, /function run\(argv\)/);
});

test('the Windows helper compiles, starts, and answers read-only requests', { skip: process.platform !== 'win32' }, async () => {
  const { WindowsComputer } = require('../src/main/computer/win');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-computer-'));
  const helper = new WindowsComputer({ cacheDir });
  try {
    assert.equal(await helper.request('ping'), 'pong');
    assert.ok(fs.readdirSync(cacheDir).some((f) => f.endsWith('.dll')), 'compiled once, kept for the next start');
    const cursor = await helper.cursor();
    assert.equal(cursor.length, 2);
    const windows = await helper.windows();
    assert.ok(Array.isArray(windows));
    for (const w of windows) {
      assert.equal(typeof w.hwnd, 'number');
      assert.ok(w.title.length > 0);
      assert.equal(w.rect.length, 4);
    }
    await assert.rejects(helper.request('nonsense'), /unknown op nonsense/);
    await assert.rejects(helper.focus(1), /closed/);
    const shown = windows.find((w) => !w.minimized && w.rect[2] > 100);
    if (shown) {
      const tree = await helper.elements(shown.hwnd);
      assert.ok(Array.isArray(tree.items));
      assert.equal(tree.window.hwnd, shown.hwnd);
      for (const item of tree.items.slice(0, 50)) {
        assert.equal(typeof item.t, 'string');
        assert.equal(item.r.length, 4);
      }
    }
    // A second helper loads the compiled DLL instead of compiling again.
    const again = new WindowsComputer({ cacheDir });
    const started = Date.now();
    assert.equal(await again.request('ping'), 'pong');
    assert.ok(Date.now() - started < 20_000);
    again.stop();
  } finally {
    helper.stop();
  }
});

test('a helper that stops answering is restarted on the next request', { skip: process.platform !== 'win32' }, async () => {
  const { WindowsComputer } = require('../src/main/computer/win');
  const helper = new WindowsComputer({ cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cf-computer-')) });
  try {
    await helper.start();
    helper.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await helper.request('ping'), 'pong');
    await assert.rejects(helper.request('sleep', { ms: 3000 }, { timeout: 300 }), /took longer than/);
    assert.equal(await helper.request('ping'), 'pong');
  } finally {
    helper.stop();
  }
});
