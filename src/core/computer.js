'use strict';
// The computer tool's plain logic, with no Electron in it: what an action asks
// for, how keys are named, how a point in the picture the model saw becomes a
// point on the screen, and how the UI tree is written down for the model.
// The desktop's computer/index.js does the rest; the tests cover this part.

const ACTIONS = new Set([
  'click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key', 'wait',
  'elements', 'windows', 'focus_window',
]);
// Actions that only read: they never move the mouse or press a key, and
// return no picture unless asked.
const READ_ONLY = new Set(['elements', 'windows', 'wait']);
// Actions that send input to whatever is on screen.
const INPUT_ACTIONS = new Set(['click', 'double_click', 'right_click', 'move', 'drag', 'scroll', 'type', 'key']);

// The long side of the picture the model sees. A 1920x1080 screen becomes
// 1280x720: small text stays readable, and it costs about a third of the
// tokens of the full-size picture.
const SHOT_LONG_SIDE = 1280;
const MAX_TYPE_CHARS = 5000;
const MAX_WAIT_S = 10;
const MAX_SCROLL = 25;
// What one elements list may hold: enough for a busy window, small enough to
// cost a few thousand tokens at most.
const MAX_ELEMENTS = 150;
const MAX_QUERY_ELEMENTS = 60;
const MAX_LABEL = 80;

// The key Stop is bound to while the agent has the computer. The agent may not
// press it: that would stop it in the user's place.
const STOP_ACCELERATOR = 'Control+Alt+Escape';

const int = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

/**
 * The action the model asked for, checked and filled in, or { error } saying
 * what is wrong in words the model can act on.
 */
function normalizeAction(args) {
  args = args && typeof args === 'object' ? args : {};
  const action = String(args.action || '').trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return { error: `Unknown action '${args.action || ''}'. Use one of: ${[...ACTIONS].join(', ')}.` };
  }
  const out = { action };
  const x = int(args.x);
  const y = int(args.y);
  const element = int(args.element);
  if (element !== null) out.element = element;
  if (x !== null && y !== null) {
    out.x = x;
    out.y = y;
  }
  const screenNumber = int(args.screen);
  if (screenNumber !== null) out.screen = screenNumber;
  const needsPoint = ['click', 'double_click', 'right_click', 'move', 'drag'].includes(action);
  if (needsPoint && out.element === undefined && out.x === undefined) {
    return { error: `${action} needs x and y (pixels in the latest screenshot) or an element number from the elements action.` };
  }
  if (action === 'drag') {
    const toX = int(args.to_x);
    const toY = int(args.to_y);
    const toElement = int(args.to_element);
    if (toElement !== null) out.toElement = toElement;
    else if (toX !== null && toY !== null) {
      out.toX = toX;
      out.toY = toY;
    } else return { error: 'drag needs to_x and to_y, or to_element: where to let go.' };
  }
  if (action === 'scroll') {
    const direction = String(args.direction || 'down').toLowerCase();
    if (!['up', 'down', 'left', 'right'].includes(direction)) return { error: "direction must be up, down, left or right." };
    out.direction = direction;
    out.amount = Math.min(MAX_SCROLL, Math.max(1, int(args.amount) || 3));
  }
  if (action === 'type') {
    if (typeof args.text !== 'string' || !args.text) return { error: 'type needs text.' };
    if (args.text.length > MAX_TYPE_CHARS) {
      return { error: `text is ${args.text.length} characters; type at most ${MAX_TYPE_CHARS} at a time. For a long text, write it to a file instead.` };
    }
    out.text = args.text;
  }
  if (action === 'key') {
    const parsed = parseKeys(args.keys != null ? args.keys : args.text);
    if (parsed.error) return { error: parsed.error };
    out.keys = parsed.combos;
    out.keysText = parsed.text;
  }
  if (action === 'wait') out.seconds = Math.min(MAX_WAIT_S, Math.max(0.1, Number(args.seconds) || 1));
  if (action === 'focus_window') {
    const window = String(args.window || '').trim();
    if (!window) return { error: 'focus_window needs window: part of its title or its app name.' };
    out.window = window;
  }
  if (action === 'elements') {
    if (args.window) out.window = String(args.window).trim();
    if (args.query) out.query = String(args.query).trim().slice(0, 100);
  }
  // A picture after every action that changes the screen, unless the model
  // says it does not need one (several keys in a row). Read-only actions
  // return none unless asked: they answer in text.
  out.screenshot = args.screenshot === undefined || args.screenshot === null
    ? !READ_ONLY.has(action) || action === 'wait'
    : Boolean(args.screenshot);
  return out;
}

// ── Keys ─────────────────────────────────────────────────────────────────────
// Names the model may use, to one canonical name each.
const KEY_ALIASES = {
  control: 'ctrl', ctl: 'ctrl', option: 'alt', opt: 'alt', command: 'cmd', meta: 'cmd', super: 'win',
  windows: 'win', return: 'enter', esc: 'escape', del: 'delete', ins: 'insert', pgup: 'pageup',
  pgdn: 'pagedown', page_up: 'pageup', page_down: 'pagedown', arrowup: 'up', arrowdown: 'down',
  arrowleft: 'left', arrowright: 'right', back: 'backspace', bksp: 'backspace', spacebar: 'space',
  ' ': 'space', '+': 'plus', caps: 'capslock', prtsc: 'printscreen', printscr: 'printscreen',
};
const MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'cmd', 'win']);

// Windows virtual-key codes: [vk, extended]. Extended keys are the ones the
// keyboard sends with an E0 prefix; without the flag, Right Arrow arrives as
// the numeric keypad's 6.
const WIN_KEYS = {
  ctrl: [0x11, false], alt: [0x12, false], shift: [0x10, false], win: [0x5B, true], cmd: [0x11, false],
  enter: [0x0D, false], tab: [0x09, false], escape: [0x1B, false], backspace: [0x08, false], space: [0x20, false],
  delete: [0x2E, true], insert: [0x2D, true], home: [0x24, true], end: [0x23, true],
  pageup: [0x21, true], pagedown: [0x22, true], up: [0x26, true], down: [0x28, true], left: [0x25, true], right: [0x27, true],
  capslock: [0x14, false], printscreen: [0x2C, true], menu: [0x5D, true],
  plus: [0xBB, false], minus: [0xBD, false], '=': [0xBB, false], '-': [0xBD, false], ',': [0xBC, false], '.': [0xBE, false],
  '/': [0xBF, false], ';': [0xBA, false], "'": [0xDE, false], '[': [0xDB, false], ']': [0xDD, false], '\\': [0xDC, false], '`': [0xC0, false],
};
for (let i = 1; i <= 24; i++) WIN_KEYS[`f${i}`] = [0x70 + i - 1, false];
for (let c = 0; c < 26; c++) WIN_KEYS[String.fromCharCode(97 + c)] = [0x41 + c, false];
for (let d = 0; d <= 9; d++) WIN_KEYS[String(d)] = [0x30 + d, false];

// macOS virtual key codes (Carbon's kVK_*), for an ANSI keyboard.
const MAC_KEYS = {
  enter: 36, tab: 48, space: 49, backspace: 51, escape: 53, delete: 117, home: 115, end: 119, pageup: 116,
  pagedown: 121, left: 123, right: 124, down: 125, up: 126, capslock: 57,
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, plus: 24, 9: 25, 7: 26, '-': 27, minus: 27, 8: 28, 0: 29,
  ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44,
  n: 45, m: 46, '.': 47, '`': 50,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

function canonicalKey(name) {
  const lower = String(name).toLowerCase();
  return KEY_ALIASES[lower] || lower;
}

/**
 * 'ctrl+s', 'enter', 'ctrl+a backspace': space-separated combos, each one
 * keys joined by '+'. Returns { combos: [['ctrl','s'], ...], text } or { error }.
 */
function parseKeys(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '').trim();
  if (!text) return { error: "key needs keys, for example 'ctrl+s', 'enter' or 'alt+tab'." };
  const combos = [];
  for (const part of text.split(/\s+/)) {
    // 'ctrl++' means Ctrl and the plus key.
    const names = part.length > 1 && part.endsWith('++')
      ? [...part.slice(0, -2).split('+'), 'plus']
      : part.split('+');
    const combo = [];
    for (const raw of names) {
      if (!raw) return { error: `'${part}' is not a key combination. Join keys with +, like ctrl+shift+s.` };
      const key = canonicalKey(raw);
      if (!WIN_KEYS[key] && !MAC_KEYS[key] && !MODIFIERS.has(key)) {
        return { error: `Unknown key '${raw}'. Use names like enter, tab, escape, backspace, delete, up, down, `
          + 'left, right, home, end, pageup, pagedown, f1-f12, ctrl, alt, shift, cmd, win, or one letter or digit. '
          + 'To enter text, use the type action.' };
      }
      combo.push(key);
    }
    combos.push(combo);
  }
  if (combos.length > 20) return { error: 'At most 20 key combinations at a time.' };
  for (const combo of combos) {
    const set = new Set(combo);
    if (set.has('ctrl') && set.has('alt') && set.has('escape')) {
      return { error: 'Ctrl+Alt+Esc is the user\'s key to stop you; it cannot be pressed.' };
    }
    if (set.has('ctrl') && set.has('alt') && set.has('delete')) {
      return { error: 'Ctrl+Alt+Del cannot be sent by an app.' };
    }
  }
  return { combos, text };
}

/** Windows: each combo as [[vk, extended], ...]. */
function windowsCombos(combos) {
  return combos.map((combo) => combo.map((key) => WIN_KEYS[key]).filter(Boolean));
}

/** macOS: each combo as { code, flags } for the one key the modifiers apply to. */
const MAC_FLAGS = { shift: 0x20000, ctrl: 0x40000, alt: 0x80000, cmd: 0x100000, win: 0x100000 };
function macCombos(combos) {
  return combos.map((combo) => {
    let flags = 0;
    let code = null;
    for (const key of combo) {
      if (MODIFIERS.has(key)) flags |= MAC_FLAGS[key];
      else code = MAC_KEYS[key] ?? null;
    }
    // A modifier on its own (a tap of Cmd) has no key to carry it.
    return { code, flags };
  });
}

// ── Coordinates ──────────────────────────────────────────────────────────────
/**
 * The picture of one display the model sees: the display's bounds in screen
 * coordinates (Electron's DIP), and the picture's size. Every screenshot of
 * that display has this size, so a frame can be known before it is taken.
 */
function frameFor(display) {
  const scale = display.scaleFactor || 1;
  const pixelW = Math.round(display.bounds.width * scale);
  const pixelH = Math.round(display.bounds.height * scale);
  const shrink = Math.min(1, SHOT_LONG_SIDE / Math.max(pixelW, pixelH));
  return {
    displayId: display.id,
    bounds: { ...display.bounds },
    width: Math.max(1, Math.round(pixelW * shrink)),
    height: Math.max(1, Math.round(pixelH * shrink)),
  };
}

/** A point in the picture to a point on the screen (DIP). */
function toScreen(frame, x, y) {
  const { bounds } = frame;
  return {
    x: bounds.x + (Math.min(Math.max(x, 0), frame.width - 1) + 0.5) * (bounds.width / frame.width),
    y: bounds.y + (Math.min(Math.max(y, 0), frame.height - 1) + 0.5) * (bounds.height / frame.height),
  };
}

/** A point on the screen (DIP) to a point in the picture, or null when it is not on it. */
function toPicture(frame, x, y) {
  const { bounds } = frame;
  const px = Math.floor((x - bounds.x) * (frame.width / bounds.width));
  const py = Math.floor((y - bounds.y) * (frame.height / bounds.height));
  if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) return null;
  return { x: px, y: py };
}

// ── The UI tree, written down ────────────────────────────────────────────────
// What a person can act on. Everything else is listed only when it has a name
// and there is room, after these.
const INTERACTIVE = new Set([
  'Button', 'SplitButton', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'Document', 'Hyperlink', 'ListItem',
  'MenuItem', 'TabItem', 'TreeItem', 'Slider', 'Spinner', 'DataItem', 'HeaderItem',
]);
// Never listed: structure, not things.
const SKIPPED = new Set(['Separator', 'Thumb', 'TitleBar', 'MenuBar', 'ToolBar', 'StatusBar', 'Tab', 'List', 'Tree', 'Table', 'DataGrid', 'Header', 'Pane', 'Group', 'Custom', 'Window', 'ScrollBar']);

function clipLabel(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL - 1)}…` : clean;
}

const quote = (text) => `"${clipLabel(text).replace(/"/g, "'")}"`;

/**
 * The UI elements of one window as compact lines for the model, numbered so
 * an action can name one. `items` come from the backend with screen rects in
 * DIP: { t: type, n: name, v: value, r: [x, y, w, h], off, focus, on, sel, open }.
 * Returns { text, targets: Map(number -> { x, y, label }) } with targets in DIP.
 */
function describeElements({ window, items, total }, frame, { query, limit } = {}) {
  const needle = query ? query.toLowerCase() : '';
  const max = Math.min(limit || (needle ? MAX_QUERY_ELEMENTS : MAX_ELEMENTS), MAX_ELEMENTS);
  const picked = [];
  const seen = new Set();
  const consider = (item, interactive) => {
    const [x, y, w, h] = item.r || [];
    if (!(w > 0 && h > 0)) return;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const at = toPicture(frame, cx, cy);
    if (!at) return;
    const name = clipLabel(item.n);
    const value = clipLabel(item.v);
    if (!interactive && !name) return;
    if (needle && !`${item.t} ${name} ${value}`.toLowerCase().includes(needle)) return;
    // A label inside a button says the button's name again.
    const key = `${name}|${Math.round(cx / 4)}|${Math.round(cy / 4)}`;
    if (seen.has(key)) return;
    if (!interactive && picked.some((p) => p.interactive && p.name && p.name.includes(name)
      && cx >= p.rect[0] && cx <= p.rect[0] + p.rect[2] && cy >= p.rect[1] && cy <= p.rect[1] + p.rect[3])) return;
    seen.add(key);
    picked.push({ item, name, value, at, center: { x: cx, y: cy }, rect: item.r, interactive });
  };
  const list = Array.isArray(items) ? items : [];
  for (const item of list) if (INTERACTIVE.has(item.t)) consider(item, true);
  for (const item of list) if (!INTERACTIVE.has(item.t) && !SKIPPED.has(item.t)) consider(item, false);
  // Back in reading order: top to bottom, then left to right.
  picked.sort((a, b) => (Math.abs(a.center.y - b.center.y) > 8 ? a.center.y - b.center.y : a.center.x - b.center.x));
  const shown = picked.slice(0, max);
  const targets = new Map();
  const lines = shown.map((p, index) => {
    const number = index + 1;
    const { item } = p;
    const parts = [`[${number}] ${item.t}`];
    if (p.name) parts.push(quote(p.name));
    parts.push(`(${p.at.x},${p.at.y})`);
    if (p.value && p.value !== p.name) parts.push(`value=${quote(p.value)}`);
    if (item.focus) parts.push('focused');
    if (item.on === true) parts.push('checked');
    if (item.on === false && (item.t === 'CheckBox' || item.t === 'RadioButton')) parts.push('unchecked');
    if (item.sel) parts.push('selected');
    if (item.open === true) parts.push('expanded');
    if (item.open === false) parts.push('collapsed');
    if (item.off) parts.push('disabled');
    targets.set(number, { x: p.center.x, y: p.center.y, label: `${item.t}${p.name ? ` ${quote(p.name)}` : ''}` });
    return parts.join(' ');
  });
  const head = window
    ? `Window ${quote(window.title || '')}${window.app ? ` (${window.app})` : ''}.`
    : 'The window in front.';
  let summary;
  if (!lines.length) {
    summary = needle
      ? `${head} Nothing matches '${query}'. Leave out query to see everything, or use the screenshot.`
      : `${head} It exposes no UI elements on this screen (many games, canvases and some web pages do not). Use the screenshot and coordinates instead.`;
  } else {
    const more = picked.length > shown.length ? ` Showing ${shown.length} of ${picked.length}: add query to narrow it.` : '';
    summary = `${head} ${lines.length} element${lines.length === 1 ? '' : 's'}; (x,y) is the center in screenshot pixels. `
      + `Act on one with element: <number>.${more}`;
  }
  return { text: [summary, ...lines].join('\n'), targets, total: total || list.length };
}

/** Open windows as lines for the model. */
function describeWindows(windows) {
  // The desktop itself is not a window anyone switches to; open ones first.
  const list = (windows || []).filter((w) => w && w.title && !(w.title === 'Program Manager' && /^explorer$/i.test(w.app || '')))
    .sort((a, b) => Number(Boolean(a.minimized)) - Number(Boolean(b.minimized)));
  if (!list.length) return 'No windows are open.';
  return ['Open windows:', ...list.slice(0, 40).map((w) => `- ${quote(w.title)}${w.app ? ` (${w.app})` : ''}${w.minimized ? ' minimized' : ''}`)].join('\n');
}

/** The best window for a title part or app name: exact, then starts, then contains. */
function matchWindow(windows, wanted) {
  const needle = String(wanted || '').toLowerCase().trim();
  if (!needle) return null;
  const list = (windows || []).filter((w) => w && w.title);
  const title = (w) => w.title.toLowerCase();
  const app = (w) => String(w.app || '').toLowerCase();
  return list.find((w) => title(w) === needle || app(w) === needle)
    || list.find((w) => title(w).startsWith(needle))
    || list.find((w) => title(w).includes(needle) || app(w).includes(needle))
    || null;
}

/**
 * Whether a run may have the computer tool: the user turned it on, this
 * system has a backend, and the session's tools run here, on this computer, in
 * a folder of it. A cloud sandbox session never does: its tools run on
 * CodingFleet's servers, and there the user's screen is not the agent's to use.
 */
function computerUseAllowed({ enabled, supported, executor, cwd }) {
  return enabled === true && supported === true && executor === 'client' && Boolean(cwd);
}

/** What one action did, in a few words, for the result and the indicator. */
function actionWords(action, target) {
  const on = target ? ` ${target}` : '';
  switch (action.action) {
    case 'click': return `Clicked${on}`;
    case 'double_click': return `Double-clicked${on}`;
    case 'right_click': return `Right-clicked${on}`;
    case 'move': return `Moved the pointer to${on}`;
    case 'drag': return `Dragged${on}`;
    case 'scroll': return `Scrolled ${action.direction} ${action.amount}${on ? ` at${on}` : ''}`;
    case 'type': return `Typed ${action.text.length} character${action.text.length === 1 ? '' : 's'}`;
    case 'key': return `Pressed ${action.keysText}`;
    case 'wait': return `Waited ${action.seconds} s`;
    case 'focus_window': return `Brought${on} to the front`;
    default: return action.action;
  }
}

module.exports = {
  ACTIONS, READ_ONLY, INPUT_ACTIONS, SHOT_LONG_SIDE, MAX_TYPE_CHARS, STOP_ACCELERATOR,
  normalizeAction, parseKeys, windowsCombos, macCombos,
  frameFor, toScreen, toPicture, describeElements, describeWindows, matchWindow, actionWords, computerUseAllowed,
};
