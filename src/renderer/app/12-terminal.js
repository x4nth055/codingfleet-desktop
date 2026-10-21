'use strict';
/* global cf, Terminal, FitAddon, WebLinksAddon */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. The terminal panel: shells the user types in
// (core/terminal.js runs them), in tabs, under the conversation or on the
// right. Ctrl+` shows and hides it. The agent never sees these terminals.

const TERM_KEYS = {
  open: 'cf.term-open', position: 'cf.term-position', height: 'cf.term-height', width: 'cf.term-width',
};
const TERM_MIN_HEIGHT = 120;
const TERM_MIN_WIDTH = 300;
const TERM_DEFAULT_HEIGHT = 280;
const TERM_DEFAULT_WIDTH = 460;

const TERM = {
  open: false,
  position: 'bottom',     // 'bottom' | 'right'
  tabs: [],               // { id, shell, cwd, xterm, fit, host, exited }
  active: null,
  shells: null,
  height: null,
  width: null,
  starting: false,
};

function termStored(key) {
  try { return localStorage.getItem(TERM_KEYS[key]); } catch { return null; }
}
function termStore(key, value) {
  try { localStorage.setItem(TERM_KEYS[key], String(value)); } catch { /* kept for this run only */ }
}

// ── Colors and font ────────────────────────────────────────────────────────
// The terminal takes the theme's own colors; the ANSI colors are tuned for a
// dark or a light background.
const ANSI_DARK = {
  black: '#1b1f26', red: '#f4636b', green: '#3ecf8e', yellow: '#f0b44c', blue: '#7b8cff', magenta: '#c084fc',
  cyan: '#4fd1c5', white: '#c9ced6', brightBlack: '#5f6873', brightRed: '#ff8a91', brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d', brightBlue: '#a5b4fc', brightMagenta: '#d8b4fe', brightCyan: '#7ee8de', brightWhite: '#f3f5f8',
};
const ANSI_LIGHT = {
  black: '#1f2328', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df',
  cyan: '#1b7c83', white: '#6e7781', brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#116329',
  brightYellow: '#7d4e00', brightBlue: '#0550ae', brightMagenta: '#6639ba', brightCyan: '#136061', brightWhite: '#8c959f',
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(color, alpha) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  return hex ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : color;
}

function termTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  const accent = cssVar('--accent');
  return {
    ...(light ? ANSI_LIGHT : ANSI_DARK),
    background: cssVar('--well') || cssVar('--bg'),
    foreground: cssVar('--text'),
    cursor: accent,
    cursorAccent: cssVar('--bg'),
    selectionBackground: withAlpha(accent, light ? 0.25 : 0.35),
    scrollbarSliderBackground: withAlpha(cssVar('--muted') || '#888888', 0.25),
    scrollbarSliderHoverBackground: withAlpha(cssVar('--muted') || '#888888', 0.4),
    scrollbarSliderActiveBackground: withAlpha(cssVar('--muted') || '#888888', 0.5),
  };
}

const termFont = () => cssVar('--mono') || 'monospace';

// After the theme or the font changed in Preferences.
function refreshTerminalTheme() {
  const theme = termTheme();
  for (const tab of TERM.tabs) tab.xterm.options.theme = theme;
}

async function refreshTerminalFont() {
  const family = termFont();
  try { await document.fonts.load(`13px ${family}`); } catch { /* the fallback font, then */ }
  for (const tab of TERM.tabs) tab.xterm.options.fontFamily = family;
  fitTerminal();
}

// ── Terminals ──────────────────────────────────────────────────────────────
function terminalCwd() {
  const session = currentSession();
  return (session ? local(session.id).cwd : S.draftCwd) || (S.init && S.init.state.lastCwd) || null;
}

const termTab = (id) => TERM.tabs.find((tab) => tab.id === id);

function makeTab(view) {
  const host = el('div', 'term-host');
  const xterm = new Terminal({
    fontFamily: termFont(),
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: termTheme(),
  });
  const fit = new FitAddon.FitAddon();
  xterm.loadAddon(fit);
  // Links open in the browser, as every link in the app does.
  xterm.loadAddon(new WebLinksAddon.WebLinksAddon((_event, uri) => {
    if (/^https?:/i.test(uri)) window.open(uri);
  }));
  const tab = { id: view.id, shell: view.shell, cwd: view.cwd, xterm, fit, host, exited: null };
  xterm.attachCustomKeyEventHandler((event) => termKey(tab, event));
  xterm.onData((data) => {
    if (tab.exited == null) cf.writeTerminal(tab.id, data);
  });
  xterm.onResize(({ cols, rows }) => {
    if (tab.exited == null) cf.resizeTerminal(tab.id, cols, rows);
  });
  TERM.tabs.push(tab);
  $('termBody').append(host);
  xterm.open(host);
  return tab;
}

// Copy and paste the way terminals do: Ctrl+Shift+C / Ctrl+Shift+V, and Ctrl+C
// copies while text is selected (else it stops the command). Cmd on a Mac.
function termKey(tab, event) {
  if (event.type !== 'keydown') return true;
  const mac = S.init && S.init.platform === 'darwin';
  if (event.ctrlKey && event.code === 'Backquote') return false;
  const copyCombo = mac
    ? event.metaKey && event.code === 'KeyC'
    : event.ctrlKey && event.code === 'KeyC' && (event.shiftKey || tab.xterm.hasSelection());
  if (copyCombo) {
    if (tab.xterm.hasSelection()) {
      cf.copyText(tab.xterm.getSelection());
      tab.xterm.clearSelection();
    }
    event.preventDefault();
    return false;
  }
  // The browser pastes into xterm's own textarea; xterm sends it on.
  if ((mac ? event.metaKey : event.ctrlKey) && event.code === 'KeyV') return false;
  return true;
}

async function newTerminal(shellId) {
  if (TERM.starting) return;
  TERM.starting = true;
  try {
    const size = TERM.tabs.length ? { cols: TERM.tabs[0].xterm.cols, rows: TERM.tabs[0].xterm.rows } : {};
    await document.fonts.load(`13px ${termFont()}`).catch(() => {});
    const view = await call(cf.createTerminal, { cwd: terminalCwd(), shell: shellId, ...size });
    const tab = makeTab(view);
    showTerminal(tab.id);
  } catch (err) {
    flashHint(`Could not start a terminal: ${err.message}`);
    if (!TERM.tabs.length && TERM.open) closeTerminalPanel();
  } finally {
    TERM.starting = false;
  }
}

function showTerminal(id) {
  TERM.active = id;
  if (!TERM.open) openTerminalPanel();
  else renderTerminalPanel();
  const tab = termTab(id);
  if (tab) requestAnimationFrame(() => {
    fitTerminal();
    tab.xterm.focus();
  });
}

function closeTerminal(id) {
  const tab = termTab(id);
  if (!tab) return;
  if (tab.exited == null) cf.killTerminal(id);
  forgetTerminal(tab);
}

function forgetTerminal(tab) {
  const at = TERM.tabs.indexOf(tab);
  if (at === -1) return;
  TERM.tabs.splice(at, 1);
  tab.xterm.dispose();
  tab.host.remove();
  if (TERM.active === tab.id) {
    const next = TERM.tabs[Math.min(at, TERM.tabs.length - 1)];
    TERM.active = next ? next.id : null;
  }
  if (!TERM.tabs.length) {
    if (TERM.open) closeTerminalPanel();
  } else if (TERM.open) {
    showTerminal(TERM.active);
  } else {
    renderTerminalPanel();
  }
}

function onTerminalData({ id, data }) {
  const tab = termTab(id);
  if (tab) tab.xterm.write(data);
}

// A shell that ended on its own: `exit` closes the tab, as it does in other
// terminals; a failure stays, so what it said can still be read.
function onTerminalExit({ id, code }) {
  const tab = termTab(id);
  if (!tab || tab.exited != null) return;
  tab.exited = code;
  if (code === 0) {
    forgetTerminal(tab);
    return;
  }
  tab.xterm.write(`\r\n\x1b[2m[The shell exited with code ${code}. Close this tab, or press Enter for a new one.]\x1b[0m\r\n`);
  tab.xterm.onKey(({ domEvent }) => {
    if (domEvent.key === 'Enter') {
      forgetTerminal(tab);
      newTerminal();
    }
  });
  renderTerminalPanel();
}

// ── The panel ──────────────────────────────────────────────────────────────
function toggleTerminalPanel() {
  if (TERM.open) closeTerminalPanel();
  else openTerminalPanel();
}

function openTerminalPanel() {
  TERM.open = true;
  termStore('open', 1);
  renderTerminalPanel();
  if (!TERM.tabs.length) {
    newTerminal();
    return;
  }
  const tab = termTab(TERM.active) || TERM.tabs[0];
  TERM.active = tab.id;
  renderTerminalPanel();
  requestAnimationFrame(() => {
    fitTerminal();
    tab.xterm.focus();
  });
}

function closeTerminalPanel() {
  TERM.open = false;
  termStore('open', 0);
  renderTerminalPanel();
  if ($('settings').hidden) $('prompt').focus();
}

function setTerminalPosition(position) {
  if (position === TERM.position) return;
  TERM.position = position;
  termStore('position', position);
  renderTerminalPanel();
  requestAnimationFrame(() => {
    fitTerminal();
    const tab = termTab(TERM.active);
    if (tab) tab.xterm.focus();
  });
}

function applyTerminalSize() {
  const root = document.documentElement.style;
  if (TERM.height != null) root.setProperty('--term-height', `${TERM.height}px`);
  if (TERM.width != null) root.setProperty('--term-width', `${TERM.width}px`);
}

function clampTerminalHeight(px) {
  const main = document.querySelector('.main');
  const max = Math.max(TERM_MIN_HEIGHT, (main ? main.clientHeight : window.innerHeight) - 240);
  return Math.round(Math.min(max, Math.max(TERM_MIN_HEIGHT, px)));
}

// On the right, the conversation keeps the room it needs (MAIN_MIN) beside it.
function clampTerminalWidth(px) {
  const sidebar = document.querySelector('.sidebar');
  const side = sidebar ? sidebar.getBoundingClientRect().width : SIDEBAR_DEFAULT;
  const max = Math.max(TERM_MIN_WIDTH, Math.min(Math.round(window.innerWidth * 0.6), window.innerWidth - side - MAIN_MIN));
  return Math.round(Math.min(max, Math.max(TERM_MIN_WIDTH, px)));
}

// Dragging the edge: the top one at the bottom, the left one on the right.
function startTerminalDrag(event) {
  const panel = $('termPanel');
  if (event.button !== 0) return;
  event.preventDefault();
  const right = TERM.position === 'right';
  const stacked = terminalStacked();
  const start = right ? event.clientX : event.clientY;
  const rect = panel.getBoundingClientRect();
  const startSize = right ? rect.width : rect.height;
  document.body.classList.add(right ? 'panel-resizing' : 'term-resizing');
  const move = (e) => {
    e.preventDefault();
    if (stacked) applyPanelWidth(startSize + (start - e.clientX));
    else if (right) TERM.width = clampTerminalWidth(startSize + (start - e.clientX));
    else TERM.height = clampTerminalHeight(startSize + (start - e.clientY));
    applyTerminalSize();
    if (right) applySidebarWidth(sidebarWidth ?? SIDEBAR_DEFAULT);
    fitTerminal();
  };
  const up = () => {
    document.body.classList.remove('panel-resizing', 'term-resizing');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    if (stacked) savePanelWidth();
    else if (right && TERM.width != null) termStore('width', TERM.width);
    if (!right && TERM.height != null) termStore('height', TERM.height);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}

function resetTerminalSize() {
  if (TERM.position === 'right') {
    TERM.width = TERM_DEFAULT_WIDTH;
    termStore('width', TERM.width);
  } else {
    TERM.height = TERM_DEFAULT_HEIGHT;
    termStore('height', TERM.height);
  }
  applyTerminalSize();
  fitTerminal();
}

let fitFrame = 0;
function fitTerminal() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    const tab = termTab(TERM.active);
    if (!TERM.open || !tab || !tab.host.clientWidth || !tab.host.clientHeight) return;
    try { tab.fit.fit(); } catch { /* not laid out yet */ }
  });
}

function terminalButton(iconName, title, run, className = 'icon-button') {
  const button = el('button', className);
  button.title = title;
  button.innerHTML = ICON[iconName];
  button.addEventListener('click', run);
  return button;
}

function openShellMenu(anchor) {
  const existing = $('termShellMenu');
  if (existing && !existing.hidden) {
    closeMenus();
    return;
  }
  closeMenus();
  const show = (shells) => {
    let menu = $('termShellMenu');
    if (!menu) {
      menu = el('div', 'menu term-menu pref-menu');
      menu.id = 'termShellMenu';
      document.body.append(menu);
    }
    const list = el('div', 'menu-list');
    for (const shell of shells) {
      const row = el('button', 'menu-item');
      row.append(icon('terminal'), el('span', 'mi-name', shell.name));
      row.addEventListener('click', () => {
        closeMenus();
        newTerminal(shell.id);
      });
      list.append(row);
    }
    menu.replaceChildren(list);
    const rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    const width = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
    const below = rect.bottom + 6 + menu.offsetHeight < window.innerHeight;
    menu.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - 6 - menu.offsetHeight)}px`;
  };
  if (TERM.shells) {
    show(TERM.shells);
    return;
  }
  call(cf.terminalShells).then((shells) => {
    TERM.shells = shells;
    show(shells);
  }).catch((err) => flashHint(`Could not list the shells: ${err.message}`));
}

function renderTerminalPanel() {
  const panel = $('termPanel');
  const app = document.querySelector('.app');
  const right = TERM.position === 'right';
  const show = TERM.open;

  // The panel lives under the conversation, or as a column of its own.
  const parent = right ? app : document.querySelector('.main');
  if (panel.parentElement !== parent) parent.append(panel);
  panel.classList.toggle('right', right);
  panel.classList.toggle('bottom', !right);
  panel.hidden = !show;
  app.classList.toggle('with-term-right', show && right);
  if (show && right) {
    TERM.width = clampTerminalWidth(TERM.width ?? TERM_DEFAULT_WIDTH);
    applyTerminalSize();
  }
  applySidebarWidth(sidebarWidth ?? SIDEBAR_DEFAULT);
  renderTerminalToggle();
  if (!show) return;

  const head = $('termHead');
  head.replaceChildren();
  const title = el('div', 'term-title');
  title.append(icon('terminal'), el('span', null, 'Terminal'));
  const tabs = el('div', 'term-tabs');
  const list = el('div', 'term-tablist');
  for (const tab of TERM.tabs) {
    const item = el('div', `term-tab${tab.id === TERM.active ? ' selected' : ''}${tab.exited != null ? ' exited' : ''}`);
    const label = el('button', 'term-tab-label');
    label.title = `${tab.shell} in ${tab.cwd}`;
    label.append(icon('terminal'), el('span', null, `${tab.shell} · ${baseName(tab.cwd) || tab.cwd}`));
    label.addEventListener('click', () => showTerminal(tab.id));
    label.addEventListener('auxclick', (event) => {
      if (event.button === 1) closeTerminal(tab.id);
    });
    const close = terminalButton('x', 'Close this terminal', () => closeTerminal(tab.id), 'icon-button term-tab-close');
    item.append(label, close);
    list.append(item);
  }
  tabs.append(list);
  const add = el('div', 'term-add');
  add.append(
    terminalButton('plus', 'New terminal', () => newTerminal()),
    terminalButton('caret', 'New terminal with another shell', (event) => openShellMenu(event.currentTarget)),
  );
  tabs.append(add);
  const tools = el('div', 'term-tools');
  tools.append(
    terminalButton(right ? 'dockBottom' : 'dockRight', right ? 'Move the terminal to the bottom' : 'Move the terminal to the right',
      () => setTerminalPosition(right ? 'bottom' : 'right')),
    terminalButton('x', 'Hide the terminal (Ctrl+`)', closeTerminalPanel),
  );
  head.append(title, tabs, tools);

  for (const tab of TERM.tabs) tab.host.hidden = tab.id !== TERM.active;
  fitTerminal();
}

// The button in the top bar: shows and hides the panel.
function renderTerminalToggle() {
  const button = $('termToggle');
  if (button) button.classList.toggle('active', TERM.open);
}

function terminalToggleButton() {
  const button = el('button', `icon-button term-toggle${TERM.open ? ' active' : ''}`);
  button.id = 'termToggle';
  button.title = 'Terminal (Ctrl+`)';
  button.innerHTML = ICON.terminal;
  button.addEventListener('click', toggleTerminalPanel);
  return button;
}

// Under the sub-agents panel, in its column: the two share its width.
const terminalStacked = () => TERM.position === 'right' && document.querySelector('.app').classList.contains('with-panel');

// The width the panel takes on the right, for the sidebar's own limit.
function terminalRightWidth() {
  const panel = $('termPanel');
  return panel && !panel.hidden && TERM.position === 'right' && !terminalStacked()
    ? panel.getBoundingClientRect().width : 0;
}

async function wireTerminal() {
  const panel = $('termPanel');
  const grip = el('div', 'term-resizer');
  grip.title = 'Drag to resize the terminal. Double-click to reset.';
  grip.addEventListener('pointerdown', startTerminalDrag);
  grip.addEventListener('dblclick', resetTerminalSize);
  panel.prepend(grip);
  // Keys typed in a terminal are the shell's: the app's own shortcuts do not
  // see them, except Ctrl+` to hide the panel.
  panel.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.code === 'Backquote') return;
    if (event.target.closest('.term-host')) event.stopPropagation();
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'Backquote') {
      event.preventDefault();
      if (!$('settings').hidden) return;
      toggleTerminalPanel();
    }
  });
  new ResizeObserver(() => fitTerminal()).observe($('termBody'));
  window.addEventListener('resize', () => {
    if (TERM.height != null) TERM.height = clampTerminalHeight(TERM.height);
    if (TERM.width != null) TERM.width = clampTerminalWidth(TERM.width);
    applyTerminalSize();
  });

  TERM.position = termStored('position') === 'right' ? 'right' : 'bottom';
  const height = Number(termStored('height'));
  if (Number.isFinite(height) && height > 0) TERM.height = clampTerminalHeight(height);
  const width = Number(termStored('width'));
  if (Number.isFinite(width) && width > 0) TERM.width = clampTerminalWidth(width);
  applyTerminalSize();

  if (typeof cf.onTerminalData !== 'function') return;
  cf.onTerminalData(onTerminalData);
  cf.onTerminalExit(onTerminalExit);
  // A window that reloaded: its terminals kept running, with what they printed.
  try {
    const open = await call(cf.terminals);
    for (const view of open) {
      const tab = makeTab(view);
      tab.xterm.write(view.kept || '');
    }
    if (open.length) {
      TERM.active = open[open.length - 1].id;
      if (termStored('open') === '1') openTerminalPanel();
    }
  } catch { /* none to show */ }
  renderTerminalPanel();
}
