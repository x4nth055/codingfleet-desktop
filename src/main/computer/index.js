'use strict';
// The computer tool on this computer: the agent clicks, types, scrolls and
// reads the UI of other apps, and sees a fresh picture of the screen after
// each step, the way view_image shows it a file.
//
// What keeps the user in charge while it runs:
// * It is off until the user turns it on in Preferences, and every session
//   asks before its first action (auto mode does not cover it).
// * A pill at the top of the screen says the agent has the computer, with a
//   Stop button, and Ctrl+Alt+Esc stops it from anywhere. Stop cancels the run.
// * The pill and this app's window are left out of every screenshot
//   (content protection), and the window steps aside while the agent works on
//   the screen it is on, so a click meant for the app behind it lands there.
//
// Coordinates: the model works in the pixels of the picture it last saw of
// one display (core/computer.js frameFor). Here they become screen points
// (Electron's DIP), and for Windows physical pixels, which is what the helper
// and UI Automation speak.
const path = require('path');
const { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, systemPreferences } = require('electron');

const core = require('../../core/computer');

// After input, before the picture: menus open, pages repaint, focus moves.
const SETTLE_MS = 350;
// For the app's own window to finish minimizing.
const STEP_ASIDE_MS = 300;
const INDICATOR_SIZE = { width: 480, height: 46 };
const TYPE_CHUNK = 80;
const SHOT_QUALITY = 80;

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(new Error('Stopped.')); return; }
  const timer = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(new Error('Stopped.')); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
});

const SUPPORTED = process.platform === 'win32' || process.platform === 'darwin';
const SHORTCUT_LABEL = process.platform === 'darwin' ? '⌃⌥Esc' : 'Ctrl+Alt+Esc';

function backendFor({ cacheDir, log }) {
  if (process.platform === 'win32') {
    const { WindowsComputer } = require('./win');
    return new WindowsComputer({ cacheDir, log });
  }
  if (process.platform === 'darwin') {
    const { MacComputer } = require('./mac');
    return new MacComputer({ log });
  }
  return null;
}

const inside = (p, b) => b && p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * @param {object} o
 * @param {() => BrowserWindow} o.getWindow The app's main window.
 * @param {() => boolean} o.enabled Whether the user has turned computer use on.
 * @param {string} o.cacheDir Where the Windows helper is compiled to.
 * @param {(sessionId: string) => void} o.onStop The user pressed Stop: cancel that session's run.
 * @param {(sessionId: string, data: object) => void} [o.onImage] A picture the agent got, for its step in the chat.
 * @param {(window: object) => boolean} [o.isOwnWindow] Whether a window is this app's (default: its process).
 */
function createComputer({ getWindow, enabled, cacheDir, log, onStop, onImage, isOwnWindow }) {
  let backend = null;
  const sessions = new Map();   // session id -> { displayId, targets, stopped, controller }
  const active = new Set();     // sessions whose run is using the computer now
  let indicator = null;
  let indicatorState = { doing: '', waiting: false };
  let shortcutHeld = false;
  let steppedAside = false;
  let queue = Promise.resolve();

  const backendNow = () => {
    if (!backend) backend = backendFor({ cacheDir, log });
    return backend;
  };
  const stateOf = (sessionId) => {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { displayId: null, targets: new Map(), listedWindow: null, stopped: false, controller: null });
    }
    return sessions.get(sessionId);
  };
  const mainWindow = () => {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  // ── Coordinates ───────────────────────────────────────────────────────────
  const displays = () => screen.getAllDisplays();
  const displayById = (id) => displays().find((d) => String(d.id) === String(id)) || null;
  const toDevice = (p) => {
    if (process.platform !== 'win32') return { x: Math.round(p.x), y: Math.round(p.y) };
    const out = screen.dipToScreenPoint({ x: p.x, y: p.y });
    return { x: Math.round(out.x), y: Math.round(out.y) };
  };
  // A rect from the backend (physical pixels on Windows) in screen points.
  const rectToDip = (r) => {
    if (!r) return null;
    const [x, y, w, h] = r;
    if (process.platform !== 'win32') return { x, y, width: w, height: h };
    const a = screen.screenToDipPoint({ x, y });
    const b = screen.screenToDipPoint({ x: x + w, y: y + h });
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  };

  // ── Whose window is whose ─────────────────────────────────────────────────
  const OWN_APPS = new Set(['codingfleet', 'electron']);
  const isOwn = isOwnWindow || ((w) => Boolean(w) && (w.pid === process.pid
    || (process.platform === 'darwin' && OWN_APPS.has(String(w.app || '').toLowerCase()))));

  // The window the user means by "the window in front": the top one that is
  // not this app's own.
  async function frontWindow() {
    const b = backendNow();
    const front = await b.foreground();
    if (front && !isOwn(front) && !front.minimized) return front;
    const all = await b.windows();
    return all.find((w) => !isOwn(w) && !w.minimized && w.rect && w.rect[2] > 0) || front || null;
  }

  async function displayForSession(state, action) {
    const list = displays();
    if (action.screen) {
      const picked = list[action.screen - 1];
      if (!picked) throw new Error(`There is no screen ${action.screen}; this computer has ${list.length}.`);
      state.displayId = picked.id;
      return picked;
    }
    const known = state.displayId != null && displayById(state.displayId);
    if (known) return known;
    let display = screen.getPrimaryDisplay();
    try {
      const front = await frontWindow();
      const rect = front && rectToDip(front.rect);
      if (rect && rect.width > 0) display = screen.getDisplayMatching(rect);
    } catch { /* the primary screen, then */ }
    state.displayId = display.id;
    return display;
  }

  // ── The pill and the Stop key ─────────────────────────────────────────────
  function showIndicator(display) {
    const area = display.workArea;
    const bounds = {
      x: Math.round(area.x + (area.width - INDICATOR_SIZE.width) / 2),
      y: Math.round(area.y + 10),
      ...INDICATOR_SIZE,
    };
    if (!indicator || indicator.isDestroyed()) {
      indicator = new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        title: 'CodingFleet is using your computer',
        webPreferences: {
          preload: path.join(__dirname, 'indicator-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      indicator.setContentProtection(true);
      indicator.setAlwaysOnTop(true, 'screen-saver');
      indicator.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      indicator.loadFile(path.join(__dirname, '..', '..', 'renderer', 'computer-indicator.html'));
      indicator.webContents.once('did-finish-load', () => {
        pushIndicator();
        if (indicator && !indicator.isDestroyed() && active.size) indicator.showInactive();
      });
      indicator.on('closed', () => { indicator = null; });
    } else {
      indicator.setBounds(bounds);
      if (!indicator.isVisible()) indicator.showInactive();
    }
  }

  function pushIndicator() {
    if (!indicator || indicator.isDestroyed()) return;
    indicator.webContents.send('indicator:state', { ...indicatorState, shortcut: SHORTCUT_LABEL });
  }

  function setDoing(doing) {
    indicatorState = { ...indicatorState, doing, waiting: false };
    pushIndicator();
  }

  ipcMain.on('indicator:stop', (event) => {
    if (indicator && !indicator.isDestroyed() && event.sender === indicator.webContents) stopAll();
  });
  ipcMain.on('indicator:open', (event) => {
    if (indicator && !indicator.isDestroyed() && event.sender === indicator.webContents) bringBack();
  });

  function holdShortcut() {
    if (shortcutHeld) return;
    try {
      shortcutHeld = globalShortcut.register(core.STOP_ACCELERATOR, () => stopAll());
      if (!shortcutHeld && log) log.warn(`computer use: ${core.STOP_ACCELERATOR} is taken by another app; Stop is on the pill only`);
    } catch (err) {
      if (log) log.warn(`computer use: could not register the stop key: ${err.message}`);
    }
  }

  function releaseShortcut() {
    if (!shortcutHeld) return;
    try { globalShortcut.unregister(core.STOP_ACCELERATOR); } catch { /* app quitting */ }
    shortcutHeld = false;
  }

  function activate(sessionId, display) {
    const first = !active.size;
    active.add(sessionId);
    showIndicator(display);
    holdShortcut();
    const win = mainWindow();
    if (win) win.setContentProtection(true);
    if (first && log) log.info(`computer use started in session ${sessionId}`);
  }

  // The app's window steps aside when it covers the screen the agent works
  // on: a click the model aimed at what it saw must not land on this app.
  async function stepAside(display, signal) {
    const win = mainWindow();
    if (!win || !win.isVisible() || win.isMinimized()) return;
    if (!overlaps(win.getBounds(), display.bounds)) return;
    steppedAside = true;
    win.minimize();
    await wait(STEP_ASIDE_MS, signal);
  }

  function bringBack() {
    const win = mainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  function deactivate(sessionId) {
    if (!active.delete(sessionId)) return;
    if (active.size) return;
    releaseShortcut();
    indicatorState = { doing: '', waiting: false };
    if (indicator && !indicator.isDestroyed()) indicator.hide();
    const win = mainWindow();
    if (win) win.setContentProtection(false);
    if (steppedAside) {
      steppedAside = false;
      bringBack();
    }
    if (log) log.info('computer use ended');
  }

  function stopAll() {
    const stopped = [...active];
    for (const sessionId of stopped) {
      const state = stateOf(sessionId);
      state.stopped = true;
      if (state.controller) state.controller.abort();
      if (log) log.info(`computer use stopped by the user in session ${sessionId}`);
      try { onStop(sessionId); } catch (err) { if (log) log.error(`computer use: stopping the run failed: ${err.message}`); }
      deactivate(sessionId);
    }
  }

  // ── Pictures ──────────────────────────────────────────────────────────────
  async function picture(display) {
    const frame = core.frameFor(display);
    const sources = await desktopCapturer.getSources({
      types: ['screen'], thumbnailSize: { width: frame.width, height: frame.height },
    });
    const index = displays().findIndex((d) => d.id === display.id);
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[index] || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('The screen could not be captured.');
    let image = source.thumbnail;
    const size = image.getSize();
    if (size.width !== frame.width || size.height !== frame.height) {
      image = image.resize({ width: frame.width, height: frame.height, quality: 'best' });
    }
    return { image, frame, data: image.toJPEG(SHOT_QUALITY).toString('base64') };
  }

  function screenWords(display) {
    const list = displays();
    if (list.length < 2) return '';
    return ` Screen ${list.findIndex((d) => d.id === display.id) + 1} of ${list.length}.`;
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  // The point an action names: an element from the last list, or x,y in the
  // picture. In screen points.
  function pointOf(state, frame, element, x, y) {
    if (element !== undefined) {
      const target = state.targets.get(element);
      if (!target) throw new Error(`There is no element ${element} in the latest elements list. Call elements again: the list changes as the screen does.`);
      return { point: { x: target.x, y: target.y }, label: target.label };
    }
    return { point: core.toScreen(frame, x, y), label: `(${x},${y})` };
  }

  // A click at the pill's place goes to what is under it.
  async function withPillAside(points, fn) {
    const pill = indicator && !indicator.isDestroyed() && indicator.isVisible() ? indicator.getBounds() : null;
    const covered = pill && points.some((p) => inside(p, pill));
    if (covered) indicator.hide();
    try {
      return await fn();
    } finally {
      if (covered && indicator && !indicator.isDestroyed() && active.size) indicator.showInactive();
    }
  }

  async function perform(state, action, display, signal) {
    const b = backendNow();
    const frame = core.frameFor(display);
    const button = action.action === 'right_click' ? 'right' : 'left';
    switch (action.action) {
      case 'click':
      case 'double_click':
      case 'right_click': {
        const { point, label } = pointOf(state, frame, action.element, action.x, action.y);
        setDoing(core.actionWords(action, label));
        const device = toDevice(point);
        await withPillAside([point], () => b.click(device.x, device.y, button, action.action === 'double_click' ? 2 : 1));
        return core.actionWords(action, label);
      }
      case 'move': {
        const { point, label } = pointOf(state, frame, action.element, action.x, action.y);
        const device = toDevice(point);
        await b.move(device.x, device.y);
        return core.actionWords(action, label);
      }
      case 'drag': {
        const from = pointOf(state, frame, action.element, action.x, action.y);
        const to = pointOf(state, frame, action.toElement, action.toX, action.toY);
        const label = `from ${from.label} to ${to.label}`;
        setDoing(core.actionWords(action, label));
        const a = toDevice(from.point);
        const z = toDevice(to.point);
        await withPillAside([from.point, to.point], () => b.drag([[a.x, a.y], [z.x, z.y]]));
        return core.actionWords(action, label);
      }
      case 'scroll': {
        let at;
        let label = '';
        if (action.element !== undefined || action.x !== undefined) {
          ({ point: at, label } = pointOf(state, frame, action.element, action.x, action.y));
        } else {
          const front = await frontWindow().catch(() => null);
          const rect = front && rectToDip(front.rect);
          const center = rect && { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          at = center && inside(center, display.bounds) ? center
            : { x: display.bounds.x + display.bounds.width / 2, y: display.bounds.y + display.bounds.height / 2 };
        }
        const n = action.amount;
        const dy = action.direction === 'down' ? n : action.direction === 'up' ? -n : 0;
        const dx = action.direction === 'right' ? n : action.direction === 'left' ? -n : 0;
        setDoing(core.actionWords(action, label));
        const device = toDevice(at);
        await b.scroll(device.x, device.y, dx, dy);
        return core.actionWords(action, label);
      }
      case 'type': {
        if (action.element !== undefined || action.x !== undefined) {
          const { point } = pointOf(state, frame, action.element, action.x, action.y);
          const device = toDevice(point);
          await withPillAside([point], () => b.click(device.x, device.y, 'left', 1));
          await wait(120, signal);
        }
        setDoing(core.actionWords(action));
        // In pieces, so Stop takes effect within one of them.
        for (let i = 0; i < action.text.length; i += TYPE_CHUNK) {
          if (signal.aborted) throw new Error('Stopped.');
          await b.type(action.text.slice(i, i + TYPE_CHUNK));
        }
        return core.actionWords(action);
      }
      case 'key': {
        setDoing(core.actionWords(action));
        await b.keys(process.platform === 'darwin' ? core.macCombos(action.keys) : core.windowsCombos(action.keys));
        return core.actionWords(action);
      }
      case 'wait':
        setDoing(core.actionWords(action));
        await wait(action.seconds * 1000, signal);
        return core.actionWords(action);
      default:
        throw new Error(`Unknown action ${action.action}.`);
    }
  }

  async function windowsList() {
    const all = await backendNow().windows();
    return all.filter((w) => !isOwn(w));
  }

  async function focusWindow(state, action) {
    const list = await windowsList();
    const hit = core.matchWindow(list, action.window);
    if (!hit) throw new Error(`No open window matches '${action.window}'.\n${core.describeWindows(list)}`);
    const info = await backendNow().focus(hit.hwnd);
    const rect = rectToDip((info && info.rect) || hit.rect);
    if (rect && rect.width > 0) state.displayId = screen.getDisplayMatching(rect).id;
    const focused = info && info.focused !== false;
    return focused
      ? core.actionWords(action, `"${hit.title}"`)
      : `Asked Windows to bring "${hit.title}" to the front, but another window kept it. Click the window instead.`;
  }

  async function elementsOf(state, action) {
    let target;
    if (action.window) {
      const list = await windowsList();
      target = core.matchWindow(list, action.window);
      if (!target) throw new Error(`No open window matches '${action.window}'.\n${core.describeWindows(list)}`);
    } else {
      target = await frontWindow();
      if (!target) throw new Error('No window is open in front.');
    }
    const tree = await backendNow().elements(target.hwnd);
    const rect = rectToDip(target.rect);
    const display = rect && rect.width > 0 ? screen.getDisplayMatching(rect) : screen.getPrimaryDisplay();
    state.displayId = display.id;
    const items = (tree.items || []).map((item) => {
      const r = rectToDip(item.r);
      return { ...item, r: r ? [r.x, r.y, r.width, r.height] : null };
    });
    const described = core.describeElements({ window: tree.window || target, items, total: tree.total },
      core.frameFor(display), { query: action.query });
    state.targets = described.targets;
    const listed = tree.window || target;
    state.listedWindow = { hwnd: listed.hwnd ?? target.hwnd, title: listed.title || '' };
    return { text: described.text + screenWords(display), display };
  }

  // An element number is good while the window it was listed from is still
  // the one in front, under the same title: a page that navigated, a dialog
  // that opened or another app in front means the list describes something else.
  async function checkListStillHolds(state, action) {
    if (action.element === undefined && action.toElement === undefined) return;
    if (!state.listedWindow) throw new Error('There is no elements list yet. Call elements first.');
    const front = await backendNow().foreground().catch(() => null);
    if (!front) return;
    const same = String(front.hwnd) === String(state.listedWindow.hwnd) && front.title === state.listedWindow.title;
    if (!same) {
      state.targets = new Map();
      state.listedWindow = null;
      throw new Error(`The window in front changed since the elements list (now "${front.title || front.app || 'another window'}"). `
        + 'Call elements again, or use x,y from a screenshot.');
    }
  }

  async function activeWindowWords() {
    try {
      const front = await backendNow().foreground();
      if (!front || isOwn(front) || !front.title) return '';
      return ` Active window: "${front.title}"${front.app ? ` (${front.app})` : ''}.`;
    } catch {
      return '';
    }
  }

  async function runAction(sessionId, action, call, signal) {
    const state = stateOf(sessionId);
    const display = await displayForSession(state, action);
    activate(sessionId, display);
    let text;
    let shotDisplay = display;
    if (action.action === 'elements') {
      const listed = await elementsOf(state, action);
      text = listed.text;
      shotDisplay = listed.display;
    } else if (action.action === 'windows') {
      text = core.describeWindows(await windowsList());
    } else if (action.action === 'focus_window') {
      await stepAside(display, signal);
      text = await focusWindow(state, action);
      shotDisplay = displayById(state.displayId) || display;
      await wait(SETTLE_MS, signal);
    } else {
      if (core.INPUT_ACTIONS.has(action.action)) await stepAside(display, signal);
      await checkListStillHolds(state, action);
      text = await perform(state, action, display, signal);
      if (action.action !== 'wait') await wait(SETTLE_MS, signal);
    }
    if (action.action !== 'elements' && action.action !== 'windows') {
      text = `${text.replace(/\.$/, '')}.${await activeWindowWords()}`;
    }
    setDoing('');
    if (!action.screenshot) return { output: { text }, is_error: false };
    const shot = await picture(shotDisplay);
    if (onImage && call && call.id) onImage(sessionId, { id: call.id, image: shot.image, title: text.split('.')[0] });
    return {
      output: { text: `${text}${screenWords(shotDisplay)}`, data: shot.data, width: shot.frame.width, height: shot.frame.height },
      is_error: false,
    };
  }

  /** The handler the run calls for a `computer` tool call. */
  async function forAgent(sessionId, args, { call, signal } = {}) {
    if (!SUPPORTED) return { output: 'Computer use is not available on this operating system yet.', is_error: true };
    if (!enabled()) {
      return { output: 'Computer use is turned off on this computer. The user can turn it on in Settings > Preferences.', is_error: true };
    }
    const action = core.normalizeAction(args);
    if (action.error) return { output: action.error, is_error: true };
    const state = stateOf(sessionId);
    if (state.stopped) {
      return { output: 'The user stopped computer use for this run. Do not use the computer tool again unless they ask.', is_error: true };
    }
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      systemPreferences.isTrustedAccessibilityClient(true);
      return {
        output: 'macOS has not given CodingFleet Accessibility access, which it needs to use the mouse, the keyboard and '
          + 'other apps\' UI. macOS has just asked the user; once they allow it in System Settings > Privacy & Security > '
          + 'Accessibility, try again.',
        is_error: true,
      };
    }
    // One mouse, one keyboard: actions run one at a time, in the order they came.
    const job = queue.then(async () => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      state.controller = controller;
      try {
        if (state.stopped) throw new Error('The user stopped computer use for this run.');
        return await runAction(sessionId, action, call, controller.signal);
      } catch (err) {
        setDoing('');
        const message = controller.signal.aborted || state.stopped
          ? 'The user stopped computer use. Do not use the computer tool again unless they ask.'
          : err.message;
        return { output: message, is_error: true };
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        state.controller = null;
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  /** take_screenshot of a whole screen while the agent has the computer: same frame as its actions. */
  async function screenshotFor(sessionId, screenNumber) {
    const state = stateOf(sessionId);
    const display = await displayForSession(state, screenNumber ? { screen: screenNumber } : {});
    const shot = await picture(display);
    return { ...shot, label: displays().length > 1 ? `Screen ${displays().findIndex((d) => d.id === display.id) + 1}` : 'The screen' };
  }

  return {
    supported: SUPPORTED,
    shortcutLabel: SHORTCUT_LABEL,
    forAgent,
    screenshotFor,
    isActive: (sessionId) => active.has(sessionId),
    /** An approval is waiting in a session that has the computer: show the app. */
    awaitingApproval(sessionId) {
      if (!active.has(sessionId)) return;
      indicatorState = { ...indicatorState, waiting: true };
      pushIndicator();
      bringBack();
    },
    approvalAnswered(sessionId) {
      if (!active.has(sessionId)) return;
      indicatorState = { ...indicatorState, waiting: false };
      pushIndicator();
    },
    /** The session's run ended: hand the computer back. */
    endRun(sessionId) {
      deactivate(sessionId);
      sessions.delete(sessionId);
    },
    stopAll,
    dispose() {
      releaseShortcut();
      if (indicator && !indicator.isDestroyed()) indicator.destroy();
      if (backend) backend.stop();
    },
  };
}

module.exports = { createComputer };
