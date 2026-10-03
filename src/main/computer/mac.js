'use strict';
// The macOS backend of the computer tool. Each request runs one short
// JavaScript for Automation script through osascript (it starts in about a
// tenth of a second): the mouse through CoreGraphics events, keys and text and
// the accessibility tree through System Events.
//
// macOS asks the user once for two permissions, both for CodingFleet:
// Accessibility (to send input and read other apps' UI), and Automation of
// System Events. Screen Recording, for the pictures, is the one screenshots
// already need. Coordinates are points with the main display's top-left at
// 0,0: the same space as Electron's screen module, so nothing is converted.
const { execFile } = require('child_process');

const SCRIPT = String.raw`
ObjC.import('CoreGraphics');
ObjC.import('Foundation');

function point(x, y) {
  try { return $.CGPointMake(x, y); } catch (e) { return { x: x, y: y }; }
}

function post(event) { $.CGEventPost(0 /* kCGHIDEventTap */, event); }

function mouse(type, x, y, button, clicks) {
  var event = $.CGEventCreateMouseEvent(null, type, point(x, y), button);
  if (clicks) $.CGEventSetIntegerValueField(event, 1 /* kCGMouseEventClickState */, clicks);
  post(event);
}

function sleep(ms) { delay(ms / 1000); }

var DOWN = { left: [1, 2, 0], right: [3, 4, 1], middle: [25, 26, 2] };

function click(r) {
  var b = DOWN[r.button] || DOWN.left;
  mouse(5, r.x, r.y, 0);
  sleep(30);
  for (var i = 1; i <= (r.count || 1); i++) {
    mouse(b[0], r.x, r.y, b[2], i);
    mouse(b[1], r.x, r.y, b[2], i);
    if (i < r.count) sleep(50);
  }
}

function drag(path) {
  mouse(5, path[0][0], path[0][1], 0);
  sleep(40);
  mouse(1, path[0][0], path[0][1], 0, 1);
  try {
    sleep(60);
    for (var i = 1; i < path.length; i++) {
      var from = path[i - 1], to = path[i];
      var steps = Math.max(4, Math.min(25, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / 20)));
      for (var s = 1; s <= steps; s++) {
        mouse(6 /* LeftMouseDragged */, from[0] + (to[0] - from[0]) * s / steps, from[1] + (to[1] - from[1]) * s / steps, 0);
        sleep(12);
      }
    }
    sleep(60);
  } finally {
    var end = path[path.length - 1];
    mouse(2, end[0], end[1], 0, 1);
  }
}

function scroll(r) {
  mouse(5, r.x, r.y, 0);
  sleep(30);
  // One line per notch; positive wheel values scroll up and left.
  var lines = function (n) { return n > 0 ? -1 : 1; };
  for (var i = 0; i < Math.abs(r.dy); i++) { post(wheel(lines(r.dy), 0)); sleep(15); }
  for (var j = 0; j < Math.abs(r.dx); j++) { post(wheel(0, lines(r.dx))); sleep(15); }
}

function wheel(vertical, horizontal) {
  if (typeof $.CGEventCreateScrollWheelEvent2 === 'function') {
    return $.CGEventCreateScrollWheelEvent2(null, 1 /* line */, 2, vertical * 3, horizontal * 3, 0);
  }
  return $.CGEventCreateScrollWheelEvent(null, 1, 2, vertical * 3, horizontal * 3);
}

var events = Application('System Events');

function keys(combos) {
  for (var i = 0; i < combos.length; i++) {
    var c = combos[i];
    var using = [];
    if (c.flags & 0x100000) using.push('command down');
    if (c.flags & 0x40000) using.push('control down');
    if (c.flags & 0x80000) using.push('option down');
    if (c.flags & 0x20000) using.push('shift down');
    if (c.code === null || c.code === undefined) continue;
    events.keyCode(c.code, using.length ? { using: using } : {});
    sleep(30);
  }
}

function type(text) {
  var lines = text.replace(/\r/g, '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i]) events.keystroke(lines[i]);
    if (i < lines.length - 1) events.keyCode(36);
  }
}

function frontProcess() {
  return events.processes.whose({ frontmost: true })[0];
}

function windowsOf(process, app) {
  var out = [];
  var names = [], positions = [], sizes = [], minimized = [];
  try { names = process.windows.name(); } catch (e) { return out; }
  try { positions = process.windows.position(); } catch (e) {}
  try { sizes = process.windows.size(); } catch (e) {}
  try { minimized = process.windows.attributes.byName('AXMinimized').value(); } catch (e) {}
  for (var i = 0; i < names.length; i++) {
    var p = positions[i] || [0, 0], s = sizes[i] || [0, 0];
    out.push({ hwnd: app + '\u0000' + i, title: names[i] || '', app: app, rect: [p[0], p[1], s[0], s[1]], minimized: Boolean(minimized[i]) });
  }
  return out;
}

function foreground() {
  var process = frontProcess();
  var app = process.name();
  var list = windowsOf(process, app);
  return list[0] || { hwnd: app + '\u0000' + 0, title: app, app: app, rect: [0, 0, 0, 0] };
}

function windows() {
  var out = [];
  var processes = events.processes.whose({ backgroundOnly: false })();
  for (var i = 0; i < processes.length; i++) {
    var app;
    try { app = processes[i].name(); } catch (e) { continue; }
    out = out.concat(windowsOf(processes[i], app));
  }
  return out;
}

function windowFor(hwnd) {
  var parts = String(hwnd).split('\u0000');
  var process = events.processes.byName(parts[0]);
  return { process: process, window: process.windows[Number(parts[1]) || 0], app: parts[0] };
}

function focus(hwnd) {
  var w = windowFor(hwnd);
  w.process.frontmost = true;
  try { w.window.actions.byName('AXRaise').perform(); } catch (e) {}
  sleep(150);
  var info = foreground();
  info.focused = info.app === w.app;
  return info;
}

var ROLES = {
  AXButton: 'Button', AXMenuButton: 'Button', AXDisclosureTriangle: 'Button', AXTextField: 'Edit', AXTextArea: 'Edit',
  AXSearchField: 'Edit', AXSecureTextField: 'Edit', AXCheckBox: 'CheckBox', AXRadioButton: 'RadioButton',
  AXPopUpButton: 'ComboBox', AXComboBox: 'ComboBox', AXLink: 'Hyperlink', AXMenuItem: 'MenuItem',
  AXMenuBarItem: 'MenuItem', AXTab: 'TabItem', AXStaticText: 'Text', AXHeading: 'Text', AXImage: 'Image',
  AXRow: 'ListItem', AXCell: 'DataItem', AXSlider: 'Slider', AXIncrementor: 'Spinner', AXWebArea: 'Document',
  AXGroup: 'Group', AXScrollArea: 'Pane', AXToolbar: 'ToolBar', AXSplitGroup: 'Pane', AXTabGroup: 'Tab',
  AXList: 'List', AXOutline: 'Tree', AXTable: 'Table', AXSplitter: 'Separator', AXScrollBar: 'ScrollBar',
};

// One property of every child at once: one Apple Event per property and
// level, instead of one per element.
function batch(list, name) {
  try { return list[name](); } catch (e) { return []; }
}

function elements(r) {
  var w = r.hwnd ? windowFor(r.hwnd) : null;
  var root = w ? w.window : frontProcess().windows[0];
  var info = w ? null : foreground();
  var items = [];
  var level = [root];
  var started = Date.now();
  for (var depth = 0; depth < 14 && level.length && items.length < r.max && Date.now() - started < 8000; depth++) {
    var next = [];
    for (var i = 0; i < level.length && items.length < r.max; i++) {
      var children = level[i].uiElements;
      var roles = batch(children, 'role');
      if (!roles.length) continue;
      var names = batch(children, 'name'), descriptions = batch(children, 'description'), values = batch(children, 'value');
      var positions = batch(children, 'position'), sizes = batch(children, 'size'), enabled = batch(children, 'enabled');
      var focused = batch(children, 'focused');
      for (var k = 0; k < roles.length; k++) {
        var p = positions[k], s = sizes[k];
        var role = roles[k] || '';
        if (p && s && s[0] > 1 && s[1] > 1) {
          var value = values[k];
          var item = { t: ROLES[role] || role.replace(/^AX/, ''), n: names[k] || descriptions[k] || (role === 'AXStaticText' && typeof value === 'string' ? value : '') || '', r: [p[0], p[1], s[0], s[1]] };
          if (typeof value === 'string' && value && role !== 'AXStaticText') item.v = value;
          if (role === 'AXCheckBox' || role === 'AXRadioButton') item.on = value === 1 || value === true;
          if (enabled[k] === false) item.off = true;
          if (focused[k] === true) item.focus = true;
          items.push(item);
        }
        next.push(children[k]);
      }
    }
    level = next;
  }
  return { window: info || { title: w.window.name(), app: w.app }, items: items, total: items.length };
}

function run(argv) {
  var r = JSON.parse(argv[0]);
  try {
    var result = null;
    switch (r.op) {
      case 'ping': result = 'pong'; break;
      case 'move': mouse(5, r.x, r.y, 0); break;
      case 'click': click(r); break;
      case 'drag': drag(r.path); break;
      case 'scroll': scroll(r); break;
      case 'type': type(r.text); break;
      case 'keys': keys(r.combos); break;
      case 'foreground': result = foreground(); break;
      case 'windows': result = windows(); break;
      case 'focus': result = focus(r.hwnd); break;
      case 'elements': result = elements(r); break;
      default: throw new Error('unknown op ' + r.op);
    }
    return JSON.stringify({ ok: true, result: result });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
  }
}
`;

class MacComputer {
  constructor({ log } = {}) {
    this.log = log || null;
  }

  request(op, args = {}, { timeout = 15_000 } = {}) {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT, JSON.stringify({ ...args, op })],
        { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            const said = String(stderr || err.message).trim();
            // -1743: the user has not allowed CodingFleet to control System Events.
            if (/-1743|not allowed to send/i.test(said)) {
              reject(new Error('macOS has not allowed CodingFleet to control System Events. Allow it in '
                + 'System Settings > Privacy & Security > Automation, then try again.'));
            } else if (/-25211|assistive access|accessibility/i.test(said)) {
              reject(new Error('macOS has not given CodingFleet Accessibility access. Allow it in System Settings > '
                + 'Privacy & Security > Accessibility, then try again.'));
            } else reject(new Error(said.split('\n').slice(-2).join(' ') || 'The action failed.'));
            return;
          }
          let message;
          try { message = JSON.parse(String(stdout).trim()); } catch {
            reject(new Error('The action returned nothing readable.'));
            return;
          }
          if (message.ok) resolve(message.result);
          else reject(new Error(message.error || 'The action failed.'));
        });
    });
  }

  start() { return Promise.resolve(); }
  stop() {}
  move(x, y) { return this.request('move', { x, y }); }
  click(x, y, button, count) { return this.request('click', { x, y, button, count }); }
  drag(path) { return this.request('drag', { path }); }
  scroll(x, y, dx, dy) { return this.request('scroll', { x, y, dx, dy }); }
  type(text) { return this.request('type', { text }, { timeout: 15_000 + text.length * 30 }); }
  keys(combos) { return this.request('keys', { combos }); }
  foreground() { return this.request('foreground'); }
  windows() { return this.request('windows'); }
  focus(hwnd) { return this.request('focus', { hwnd }); }
  elements(hwnd) { return this.request('elements', { hwnd: hwnd || null, max: 1500 }, { timeout: 20_000 }); }
}

module.exports = { MacComputer, SCRIPT };
