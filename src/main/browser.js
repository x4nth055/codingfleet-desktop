'use strict';
// The browser built into the app: one page, in the dock panel beside the
// conversation (the window draws the pane, renderer/app/12-browser.js; this
// owns the page). The user browses in it, and the agent uses it through the
// `browser` tool to check the web pages it builds.
//
// The page has a profile of its own (persist:cf-browser): none of the user's
// real browser's logins or cookies, no downloads, no permissions (camera,
// location, notifications...). Pages on this computer (localhost) and the
// sites the user listed in Preferences are trusted. Any other site waits for
// the user's OK once per site and session (or not at all, when the user let
// the agent use every site), and typing into one waits every time
// (approvalReason, used by main.js's approve()).
const { pathToFileURL } = require('url');
const { WebContentsView, session: electronSession, shell } = require('electron');

const page = require('../core/browser-page');

const PARTITION = 'persist:cf-browser';
const WORLD = 1717; // the isolated world the page reading runs in
const LOAD_TIMEOUT_MS = 15000;
const SETTLE_MS = 350;
// After a minimized window is shown again, before its page is clicked.
const RESTORE_SETTLE_MS = 600;
// Actions that reach the page through what is drawn: clicks, keys, a picture.
// Loading a page and reading it work in any window.
const NEEDS_SCREEN = new Set(['click', 'type', 'press', 'scroll', 'screenshot']);
const SHOT_MAX_SIDE = 1280;
const SHOT_QUALITY = 80;
const MAX_CONSOLE = 300;
// A page left this long with the pane closed is closed too: a dev server's app
// keeps its memory and its timers otherwise, behind a pane nobody sees. Its
// address and its history are kept, and it is loaded again, back and forward
// as they were, when the pane opens or the agent uses the browser (parked,
// revive).
const PARK_AFTER_MS = 2 * 60_000;

function createBrowser({ getWindow, send, log, onImage, policy = () => ({}), parkAfterMs = PARK_AFTER_MS }) {
  let view = null;
  let bounds = null;     // where the pane is, from the window
  let shown = false;     // whether the window shows the pane
  let paneOpen = false;  // whether the pane is open, even under a dialog
  let parked = null;     // { url, title, entries, index }: the page closed while the pane was, and its history
  let parkTimer = null;
  let reviving = null;   // the parked page loading again
  let revivingUrl = '';  // its address, until the load says it itself
  let busy = 0;          // the agent's actions running now
  let preset = 'desktop';
  let emulating = false; // a phone or tablet size is applied to the page
  let queue = Promise.resolve();
  let configured = false;
  const consoleLog = [];               // { n, level, text }
  let consoleCount = 0;
  const consoleSeen = new Map();       // session id -> last n read with console
  const consoleNoted = new Map();      // session id -> last n an action's result counted

  const wc = () => (view && !view.webContents.isDestroyed() ? view.webContents : null);

  function configureSession(ses) {
    if (configured) return;
    configured = true;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event, item) => {
      event.preventDefault();
      item.cancel();
      pushConsole('warning', `A download was blocked: ${item.getFilename()}. The app's browser does not download files.`);
    });
  }

  function pushConsole(level, text) {
    consoleCount += 1;
    consoleLog.push({ n: consoleCount, level, text: String(text).slice(0, 2000) });
    if (consoleLog.length > MAX_CONSOLE) consoleLog.shift();
  }

  function stateOf() {
    const contents = wc();
    if (!contents) {
      // A parked page still shows its address, and where back and forward go:
      // opening the pane loads it again.
      const entries = (parked && parked.entries) || [];
      return { url: parked ? parked.url : '', title: parked ? parked.title : '', loading: false,
        canGoBack: Boolean(parked) && parked.index > 0, canGoForward: Boolean(parked) && parked.index < entries.length - 1, preset };
    }
    const history = contents.navigationHistory;
    return {
      url: contents.getURL() === 'about:blank' ? '' : contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      preset,
    };
  }

  const pushState = () => send('browser:state', stateOf());

  function ensure() {
    if (wc()) return view;
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error('The app window is not open.');
    const ses = electronSession.fromPartition(PARTITION);
    configureSession(ses);
    view = new WebContentsView({
      webPreferences: {
        session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false,
      },
    });
    view.setBackgroundColor('#ffffff');
    view.setVisible(false);
    const contents = view.webContents;
    // A link that opens a new window opens here instead; nothing else is opened.
    contents.setWindowOpenHandler(({ url }) => {
      if (page.normalizeUrl(url)) contents.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!page.normalizeUrl(url) && url !== 'about:blank') event.preventDefault();
    });
    for (const name of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      contents.on(name, pushState);
    }
    // The console is the page's: a new page (a load, a reload) starts it
    // empty, so nobody reads what an earlier page or session logged.
    contents.on('did-navigate', () => { consoleLog.length = 0; });
    contents.on('console-message', (event) => {
      const { level = 'info', message = '', sourceId: source, lineNumber: line } = event;
      // Electron's own advice to app developers, printed in unpackaged runs: not the page's.
      if (/Electron Security Warning/.test(message)) return;
      // The script's path on its site: "/src/App.jsx:12", or "/:17" for the page itself.
      let file = String(source || '');
      try { file = new URL(file).pathname; } catch { /* kept as it came */ }
      const where = file ? ` (${file}${line ? `:${line}` : ''})` : '';
      pushConsole(level, `${message}${where}`);
    });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) pushConsole('error', `Could not load ${url}: ${description} (${code}).`);
      pushState();
    });
    contents.on('render-process-gone', (_event, details) => {
      pushConsole('error', `The page crashed (${details.reason}).`);
      pushState();
    });
    // Keys the app owns, even while the page has the focus.
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const mod = input.control || input.meta;
      let command = null;
      if (input.control && input.code === 'Backquote') command = 'terminal';
      else if (mod && input.key.toLowerCase() === 'l') command = 'address';
      else if (input.key === 'F5' || (mod && input.key.toLowerCase() === 'r')) command = 'reload';
      else if (input.alt && input.key === 'ArrowLeft') command = 'back';
      else if (input.alt && input.key === 'ArrowRight') command = 'forward';
      else if (input.key === 'F12') command = 'devtools';
      if (!command) return;
      event.preventDefault();
      if (command === 'reload') contents.reload();
      else if (command === 'back') contents.navigationHistory.goBack();
      else if (command === 'forward') contents.navigationHistory.goForward();
      else if (command === 'devtools') contents.openDevTools({ mode: 'detach' });
      else send('browser:shortcut', command);
    });
    win.contentView.addChildView(view);
    applyLayout();
    return view;
  }

  // ── A page nobody sees ────────────────────────────────────────────────────
  function schedulePark() {
    clearTimeout(parkTimer);
    parkTimer = null;
    if (!view || paneOpen || busy) return;
    parkTimer = setTimeout(park, parkAfterMs);
    parkTimer.unref?.();
  }

  function park() {
    parkTimer = null;
    const contents = wc();
    if (!contents || paneOpen || busy || reviving) return;
    const url = contents.getURL();
    const history = contents.navigationHistory;
    parked = url && url !== 'about:blank'
      ? { url, title: contents.getTitle(), entries: history.getAllEntries(), index: history.getActiveIndex() }
      : null;
    dispose();
    emulating = false;
    pushState();
  }

  // The parked page, loaded again with its history. Shared by everyone who asks meanwhile.
  function revive() {
    if (reviving) return reviving;
    if (!parked) return Promise.resolve();
    const saved = parked;
    parked = null;
    revivingUrl = saved.url;
    reviving = restore(saved).finally(() => { reviving = null; revivingUrl = ''; });
    return reviving;
  }

  // A page and its history as they were: back and forward go where they went,
  // and each page gets its scroll and its form back, where Chromium can.
  async function restore({ url, entries, index }) {
    if (!entries || !entries.length) return load(url);
    const contents = ensure().webContents;
    const loaded = waitForLoad(contents);
    try {
      await contents.navigationHistory.restore({ entries, index });
    } catch {
      // A page that did not load (a dev server since stopped) has its history
      // back all the same, and says why, as any failed load does. History
      // that could not be put back at all leaves the page alone to load.
      if (!contents.getURL()) return load(url);
    }
    return loaded;
  }

  // Somewhere new from a parked page: its history is put back first, so that
  // back still goes where it went. The old page is not waited for: the new
  // address replaces it as it starts loading.
  function unpark() {
    if (!parked) return;
    const { entries, index } = parked;
    parked = null;
    if (!entries || !entries.length) return;
    ensure().webContents.navigationHistory.restore({ entries, index }).catch(() => {});
  }

  // Back or forward on a parked page: it is loaded again at that entry.
  function moveParked(step) {
    const entries = (parked && parked.entries) || [];
    const index = parked ? parked.index + step : -1;
    if (index < 0 || index >= entries.length) return;
    parked = { ...parked, index, url: entries[index].url, title: entries[index].title };
    revive().catch(() => {});
  }

  // ── Where the pane is ─────────────────────────────────────────────────────
  function applyLayout() {
    if (!view) return;
    const visible = Boolean(shown && bounds && bounds.width > 0 && bounds.height > 0);
    view.setVisible(visible);
    if (!bounds) return;
    view.setBounds({
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)),
    });
    applyPreset();
  }

  // A phone or tablet size: the page gets that viewport, scaled down to fit
  // the pane when the pane is smaller.
  function applyPreset() {
    const contents = wc();
    if (!contents) return;
    const size = page.PRESETS[preset];
    if (!size || !bounds) {
      // Only undone when it was done: on a page that never had it, it crashes.
      if (emulating) contents.disableDeviceEmulation();
      if (emulating) view.setBackgroundColor('#ffffff');
      emulating = false;
      return;
    }
    emulating = true;
    // Beside a phone-wide page, the pane is dark: the page's edge shows.
    view.setBackgroundColor('#1b1e24');
    const area = pageArea();
    contents.enableDeviceEmulation({
      screenPosition: size.mobile ? 'mobile' : 'desktop',
      screenSize: { width: size.width, height: size.height },
      viewSize: { width: size.width, height: area.pageHeight },
      viewPosition: { x: area.x, y: 0 },
      deviceScaleFactor: 0,
      scale: area.scale,
    });
  }

  // Where the page is inside the pane. A phone or tablet keeps its width, at
  // the pane's left (Chromium draws an emulated page there whatever position
  // it is given), scaled down only when the pane is narrower, and takes the
  // pane's height: a short pane at the bottom still shows the page at a size
  // that can be read, and a taller page scrolls.
  function pageArea() {
    const size = page.PRESETS[preset];
    const width = Math.max(1, Math.round(bounds?.width || 1));
    const height = Math.max(1, Math.round(bounds?.height || 1));
    if (!size) return { x: 0, scale: 1, width, height, pageWidth: width, pageHeight: height };
    const scale = Math.min(1, width / size.width);
    const shown = Math.floor(size.width * scale);
    return {
      x: 0, scale, width: shown, height,
      pageWidth: size.width, pageHeight: Math.floor(height / scale),
    };
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  function waitForLoad(contents, timeout = LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (outcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        contents.removeListener('did-stop-loading', onStop);
        contents.removeListener('did-fail-load', onFail);
        resolve(outcome);
      };
      const onStop = () => finish({ ok: true });
      const onFail = (_e, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) finish({ ok: false, error: `${description} (${code})` });
      };
      const timer = setTimeout(() => finish({ ok: true, slow: true }), timeout);
      contents.on('did-stop-loading', onStop);
      contents.on('did-fail-load', onFail);
    });
  }

  async function load(url) {
    const contents = ensure().webContents;
    const loaded = waitForLoad(contents);
    contents.loadURL(url).catch(() => {}); // failures arrive as did-fail-load
    return loaded;
  }

  const settle = (ms = SETTLE_MS) => new Promise((resolve) => setTimeout(resolve, ms));

  // After an action that may navigate: wait for the new page if one started.
  async function afterAction(contents) {
    await settle();
    if (contents.isLoading()) await waitForLoad(contents, 8000);
  }

  async function inPage(op, arg) {
    const contents = ensure().webContents;
    const result = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: page.pageCall(op, arg) }]);
    return result || { error: 'The page did not answer.' };
  }

  // ── The window's controls ─────────────────────────────────────────────────
  const forUser = {
    // `open`: the pane is open, though a dialog may cover it (visible is then
    // false). A window that does not say counts as open while visible.
    setLayout({ visible, open, rect } = {}) {
      shown = Boolean(visible);
      paneOpen = open === undefined ? shown : Boolean(open);
      if (rect && Number.isFinite(rect.width)) bounds = rect;
      if (view) applyLayout();
      if (paneOpen && parked) {
        revive().catch((err) => { if (log) log.warn(`browser: could not load the page again: ${err.message}`); });
      }
      schedulePark();
    },
    async navigate(input) {
      const url = page.normalizeUrl(input);
      if (!url) throw new Error('Type a web address, like localhost:3000 or example.com.');
      unpark();
      await load(url);
      schedulePark();
      return stateOf();
    },
    // A page or a PDF the user opened from a link in the conversation (main.js
    // checks it is in the session's folder). Links on it stay inside the
    // web: will-navigate refuses another file.
    async openFile(file) {
      unpark();
      await load(pathToFileURL(file).href);
      schedulePark();
      return stateOf();
    },
    back() {
      const c = wc();
      if (c) c.navigationHistory.goBack();
      else moveParked(-1);
    },
    forward() {
      const c = wc();
      if (c) c.navigationHistory.goForward();
      else moveParked(1);
    },
    reload() {
      const c = wc();
      if (c) c.reload();
      else revive().catch(() => {});
    },
    stop() { const c = wc(); if (c) c.stop(); },
    setPreset(name) {
      preset = Object.hasOwn(page.PRESETS, name) ? name : 'desktop';
      applyPreset();
      pushState();
      return stateOf();
    },
    devtools() { const c = wc(); if (c) c.openDevTools({ mode: 'detach' }); },
    openExternal() {
      const c = wc();
      const url = page.normalizeUrl(c ? c.getURL() : (parked && parked.url));
      if (url) shell.openExternal(url);
    },
    async clearData() {
      await electronSession.fromPartition(PARTITION).clearStorageData();
      await electronSession.fromPartition(PARTITION).clearCache();
      const c = wc();
      if (c) c.navigationHistory.clear();
      // A parked page's history goes too, as a page's would: all but where it is.
      if (!c && parked && parked.entries) parked = { ...parked, entries: [parked.entries[parked.index]], index: 0 };
      return true;
    },
    state: stateOf,
  };

  // ── Approvals ─────────────────────────────────────────────────────────────
  // A parked page is still the page the agent would act on: it loads again
  // for the action, so its site is asked about like an open page's.
  const currentUrl = () => {
    const contents = wc();
    return (contents && contents.getURL()) || (parked && parked.url) || revivingUrl || '';
  };

  /**
   * Why a call waits for the user, or null.
   *
   * - "uses <site> in the browser": a site that is not trusted. One reason per
   *   site, for opening it and for using it, so the user's "Allow <site> this
   *   session" (main.js keeps it with the session) covers both.
   * - "types into <site>": every time (guard.alwaysAsk), even with every site
   *   allowed: a form can send what is typed anywhere.
   *
   * Trusted, so never asked: this computer's pages and the user's own sites.
   */
  function approvalReason(args = {}) {
    const { sites = [], anySite = false } = policy() || {};
    const trusted = (href) => page.isLocalUrl(href) || page.onSiteList(href, sites);
    const action = String(args.action || '');
    if (action === 'navigate') {
      const url = page.normalizeUrl(args.url);
      if (!url || trusted(url) || anySite) return null;
      return `uses ${page.siteOf(url)} in the browser`;
    }
    const url = currentUrl();
    if (!url || trusted(url)) return null;
    const site = page.siteOf(url);
    if (action === 'type' || (action === 'press' && /enter|return/i.test(String(args.keys || '')))) {
      return `types into ${site}`;
    }
    return anySite ? null : `uses ${site} in the browser`;
  }

  // ── The agent's actions ───────────────────────────────────────────────────
  // Errors since the previous action's result, so each is mentioned once.
  function newErrors(sessionId) {
    const since = Math.max(consoleNoted.get(sessionId) || 0, consoleSeen.get(sessionId) || 0);
    consoleNoted.set(sessionId, consoleCount);
    return consoleLog.filter((m) => m.n > since && m.level === 'error').length;
  }

  function where() {
    const s = stateOf();
    return s.url ? `${JSON.stringify(s.title || '')} ${s.url}` : 'a blank page';
  }

  function errorNote(sessionId) {
    const n = newErrors(sessionId);
    return n ? ` ${n} new console error${n === 1 ? '' : 's'}: read them with console.` : '';
  }

  async function screenshot(ref, sessionId, call) {
    const contents = ensure().webContents;
    let rect;
    let label = '';
    if (ref) {
      const spot = await inPage('target', { ref });
      if (spot.error) return { output: spot.error, is_error: true };
      await settle(150);
      const area = pageArea();
      rect = {
        x: Math.max(0, Math.floor(area.x + spot.rect.x * area.scale)), y: Math.max(0, Math.floor(spot.rect.y * area.scale)),
        width: Math.max(1, Math.ceil(spot.rect.width * area.scale)), height: Math.max(1, Math.ceil(spot.rect.height * area.scale)),
      };
      label = ` (${spot.label})`;
    } else if (page.PRESETS[preset]) {
      // The page alone, not the empty sides of the pane.
      const area = pageArea();
      rect = { x: area.x, y: 0, width: area.width, height: area.height };
    }
    let image = await (rect ? contents.capturePage(rect) : contents.capturePage());
    if (image.isEmpty()) return { output: 'The page could not be captured: is the app window minimized?', is_error: true };
    const size = image.getSize();
    const long = Math.max(size.width, size.height);
    if (long > SHOT_MAX_SIDE) {
      const k = SHOT_MAX_SIDE / long;
      image = image.resize({ width: Math.round(size.width * k), height: Math.round(size.height * k), quality: 'best' });
    }
    const final = image.getSize();
    // The window shows the picture in the call's details, as computer's.
    if (onImage && call) onImage(sessionId, { id: call.id, image, title: 'The page' });
    return {
      output: {
        text: `Screenshot of ${where()}${label}.`,
        data: image.toJPEG(SHOT_QUALITY).toString('base64'), width: final.width, height: final.height,
      },
      is_error: false,
    };
  }

  function sendKey(contents, { keyCode, modifiers }) {
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && !modifiers.some((m) => m === 'control' || m === 'meta' || m === 'alt')) {
      contents.sendInputEvent({ type: 'char', keyCode, modifiers });
    }
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }

  async function click(contents, x, y) {
    // With a phone or tablet size on, the page is drawn scaled: input events
    // are in the pane's pixels, like the screenshot's.
    // A screenshot is in the pane's pixels instead (screenshot()).
    const k = pageArea().scale;
    const at = { x: Math.round(x * k), y: Math.round(y * k) };
    contents.sendInputEvent({ type: 'mouseMove', ...at });
    contents.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 });
    contents.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 });
  }

  async function run(sessionId, args, call) {
    const action = String(args.action || '');
    const contents = ensure().webContents;
    const text = (t) => ({ output: { text: t }, is_error: false });
    const fail = (t) => ({ output: t, is_error: true });
    const empty = () => !contents.getURL() || contents.getURL() === 'about:blank';

    switch (action) {
      case 'navigate': {
        const url = page.normalizeUrl(args.url);
        if (!url) return fail('navigate needs an http or https address, like http://localhost:3000.');
        const loaded = await load(url);
        if (!loaded.ok) {
          const local = page.isLocalUrl(url) ? ' Is the dev server running? Start it with run_command and background: true.' : '';
          return fail(`Could not open ${url}: ${loaded.error}.${local}`);
        }
        return text(`Opened ${where()}${loaded.slow ? ' (still loading after 15 s)' : ''}.${errorNote(sessionId)}`);
      }
      case 'back':
      case 'reload': {
        if (action === 'back' && !contents.navigationHistory.canGoBack()) return fail('There is no page to go back to.');
        const loaded = waitForLoad(contents);
        if (action === 'back') contents.navigationHistory.goBack();
        else contents.reload();
        await loaded;
        return text(`${action === 'back' ? 'Went back to' : 'Reloaded'} ${where()}.${errorNote(sessionId)}`);
      }
      case 'read_page':
      case 'find': {
        if (empty()) return fail('No page is open: navigate first.');
        const result = await inPage(action === 'find' ? 'find' : 'read', { ref: args.ref, query: args.query });
        return result.error ? fail(result.error) : text(result.text + errorNote(sessionId));
      }
      case 'click': {
        if (empty()) return fail('No page is open: navigate first.');
        let label;
        if (args.ref) {
          const spot = await inPage('target', { ref: args.ref });
          if (spot.error) return fail(spot.error);
          await settle(60);
          await click(contents, spot.x, spot.y);
          label = spot.label;
        } else if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
          await click(contents, args.x, args.y);
          label = `(${args.x},${args.y})`;
        } else {
          return fail('click needs a ref, or x and y.');
        }
        const before = contents.getURL();
        await afterAction(contents);
        const moved = contents.getURL() !== before ? ` Now on ${where()}.` : '';
        return text(`Clicked ${label}.${moved}${errorNote(sessionId)}`);
      }
      case 'type': {
        if (empty()) return fail('No page is open: navigate first.');
        if (!args.ref) return fail('type needs the ref of a field.');
        if (typeof args.text !== 'string') return fail('type needs text.');
        const spot = await inPage('focus', { ref: args.ref });
        if (spot.error) return fail(spot.error);
        if (!spot.focused) {
          await click(contents, spot.x, spot.y);
          await settle(60);
        }
        // Replaces what the field held: focus selected it.
        if (args.text) await contents.insertText(args.text);
        else sendKey(contents, { keyCode: 'Backspace', modifiers: [] });
        if (args.submit) sendKey(contents, { keyCode: 'Enter', modifiers: [] });
        const before = contents.getURL();
        await afterAction(contents);
        const moved = contents.getURL() !== before ? ` Now on ${where()}.` : '';
        const n = args.text.length;
        return text(`Typed ${n} character${n === 1 ? '' : 's'} into ${spot.label}${args.submit ? ' and pressed Enter' : ''}.${moved}${errorNote(sessionId)}`);
      }
      case 'press': {
        const parsed = page.parseKeys(args.keys);
        if (parsed.error) return fail(parsed.error);
        for (const key of parsed.keys) sendKey(contents, key);
        await afterAction(contents);
        return text(`Pressed ${String(args.keys).trim()}.${errorNote(sessionId)}`);
      }
      case 'scroll': {
        if (empty()) return fail('No page is open: navigate first.');
        if (args.ref) {
          const spot = await inPage('target', { ref: args.ref });
          return spot.error ? fail(spot.error) : text(`Scrolled ${spot.label} into view.`);
        }
        const result = await inPage('scroll', { direction: args.direction });
        return result.error ? fail(result.error) : text(result.text);
      }
      case 'screenshot':
        if (empty()) return fail('No page is open: navigate first.');
        return screenshot(args.ref, sessionId, call);
      case 'console': {
        const seen = consoleSeen.get(sessionId) || 0;
        consoleSeen.set(sessionId, consoleCount);
        const fresh = consoleLog.filter((m) => m.n > seen
          && (!args.errors_only || m.level === 'error' || m.level === 'warning'));
        if (!fresh.length) return text(`No ${args.errors_only ? 'errors or warnings' : 'console messages'} since the last look.`);
        const shown = fresh.slice(-60).map((m) => `[${m.level}] ${m.text}`);
        const more = fresh.length > shown.length ? `(${fresh.length - shown.length} earlier ones not shown)\n` : '';
        return text(`${more}${shown.join('\n')}`);
      }
      case 'viewport': {
        forUser.setPreset(args.preset);
        await settle(200);
        const area = pageArea();
        const tall = page.PRESETS[preset] ? ` (a ${page.PRESETS[preset].height}px tall ${preset} screen shows more; the page scrolls)` : '';
        return text(`The page is now ${preset}: ${area.pageWidth}x${area.pageHeight}${tall}.`);
      }
      default:
        return fail(`Unknown browser action "${action}".`);
    }
  }

  function laidOut(ms = 2000) {
    const started = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if ((shown && bounds) || Date.now() - started > ms) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  /** The handler the run calls for a `browser` tool call. */
  function forAgent(sessionId, args = {}, { call } = {}) {
    // One page: actions run one at a time, in the order they came.
    const job = queue.then(async () => {
      busy += 1;
      clearTimeout(parkTimer);
      try {
        // The user sees what the agent does: the pane opens on the browser,
        // and the page gets its size before anything is clicked or captured.
        send('browser:reveal');
        // A page closed while the pane was is loaded again, unless the agent
        // is about to leave it anyway.
        if (String(args.action) === 'navigate') unpark();
        else await revive();
        // A page takes no click or key until it has been drawn once, and a
        // page under another window is hidden and never drawn: the agent
        // would be told "Clicked" while nothing happened. People leave the
        // app behind the window they work in, so the page counts as shown
        // while the agent uses it. (A minimized window still draws nothing.)
        awake(ensure().webContents, true);
        if (NEEDS_SCREEN.has(String(args.action))) await unminimize();
        // Loading needs no size (and the pane shows only once a page is there).
        if (!['navigate', 'console'].includes(String(args.action))) await laidOut();
        return await run(sessionId, args, call);
      } catch (err) {
        if (log) log.error(`browser: ${err.message}`);
        return { output: `The browser could not do that: ${err.message}`, is_error: true };
      } finally {
        busy -= 1;
        // Left to itself again, a hidden page rests as any other does.
        if (!busy && wc()) awake(wc(), false);
        schedulePark();
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  // A minimized window draws nothing at all, whatever its pages are told, so
  // a page loaded there takes no click or key, and no Chromium switch changes
  // that. The window comes back instead, without taking the keyboard: it shows
  // behind or beside what the person is working in, and they keep typing there.
  async function unminimize() {
    const win = getWindow();
    if (!win || win.isDestroyed() || !win.isMinimized()) return;
    win.showInactive();
    // Where showInactive leaves a minimized window as it is.
    if (win.isMinimized()) win.restore();
    if (log && log.info) log.info('browser: the window was minimized; shown again for the agent\'s page');
    // Time for the window to be back and the page to be drawn once.
    await settle(RESTORE_SETTLE_MS);
  }

  // Whether the page runs as a shown one whatever the window's state.
  function awake(contents, on) {
    try { contents.setBackgroundThrottling(!on); } catch { /* the page is gone */ }
  }

  function dispose() {
    clearTimeout(parkTimer);
    parkTimer = null;
    const win = getWindow();
    if (view && win && !win.isDestroyed()) {
      try { win.contentView.removeChildView(view); } catch { /* already gone */ }
    }
    if (wc()) view.webContents.close();
    view = null;
  }

  return { forUser, forAgent, approvalReason, dispose, isParked: () => Boolean(parked) && !view };
}

module.exports = { createBrowser, PARTITION, PARK_AFTER_MS };
