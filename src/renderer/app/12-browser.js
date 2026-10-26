'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. The browser view of the dock panel: its bar
// (back, forward, reload, the address, the page size) and the place the page
// is drawn. The page itself is not in this document: the main process draws
// it over #browserHost (src/main/browser.js), so this tells it where that is,
// and hides it while a dialog is open on top (a native page would cover it).

const BROWSER = {
  state: { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, preset: 'desktop' },
  sent: '',      // the last layout told to the main process
  frame: 0,      // the loop that follows the pane while something moves it
  still: 0,      // frames in a row the pane has not moved
};

// How many frames the pane is followed after it last moved: a slide that
// pauses for a frame is still followed to its end.
const BROWSER_SETTLE_FRAMES = 12;
// Transitions that only repaint: they never move the pane.
const PAINT_ONLY_TRANSITION = /^(opacity|color|background|border-color|box-shadow|filter|outline|text-shadow|fill|stroke)/;

const BROWSER_PRESETS = [['desktop', 'Desktop'], ['tablet', 'Tablet'], ['mobile', 'Mobile']];

const browserShown = () => TERM.open && TERM.view === 'browser';

function browserButton(iconName, title, run, className = 'icon-button') {
  const button = el('button', className);
  button.title = title;
  button.innerHTML = ICON[iconName];
  button.addEventListener('click', run);
  return button;
}

async function browserGo(text) {
  const address = String(text || '').trim();
  if (!address) return;
  try {
    BROWSER.state = await call(cf.browserNavigate, address);
  } catch (err) {
    flashHint(err.message);
  }
  updateBrowserBar();
}

function browserCommand(command) {
  call(cf.browserCommand, command).then((state) => {
    BROWSER.state = state;
    updateBrowserBar();
  }).catch((err) => flashHint(err.message));
}

// Opens a page in the app's browser: the background jobs' Open button, and the
// user's own address bar.
function openInAppBrowser(url) {
  openBrowserPanel();
  browserGo(url);
}

// The bar is built with the panel; a page loading or a new title only patches it.
function renderBrowserBar() {
  const bar = el('div', 'term-tabs browser-bar');
  const back = browserButton('arrowLeft', 'Back (Alt+Left)', () => browserCommand('back'), 'icon-button browser-back');
  const forward = browserButton('arrowRight', 'Forward (Alt+Right)', () => browserCommand('forward'), 'icon-button browser-forward');
  const reload = browserButton('refresh', 'Reload (F5)', () => browserCommand(BROWSER.state.loading ? 'stop' : 'reload'),
    'icon-button browser-reload');
  const address = el('input', 'browser-url');
  address.id = 'browserUrl';
  address.type = 'text';
  address.spellcheck = false;
  address.autocomplete = 'off';
  address.placeholder = 'Type an address, like localhost:3000';
  address.setAttribute('aria-label', 'Address');
  // While the user types an address, a page loading does not overwrite it.
  address.addEventListener('focus', () => address.select());
  address.addEventListener('input', () => { address.dataset.editing = '1'; });
  address.addEventListener('blur', () => {
    delete address.dataset.editing;
    address.value = BROWSER.state.url;
  });
  address.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      delete address.dataset.editing;
      browserGo(address.value);
      address.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      address.blur();
    }
  });
  const preset = el('select', 'browser-preset');
  preset.title = 'Page size';
  preset.setAttribute('aria-label', 'Page size');
  for (const [value, label] of BROWSER_PRESETS) {
    const option = el('option', null, label);
    option.value = value;
    preset.append(option);
  }
  preset.addEventListener('change', () => {
    call(cf.browserPreset, preset.value).then((state) => {
      BROWSER.state = state;
      updateBrowserBar();
    }).catch((err) => flashHint(err.message));
  });
  const devtools = browserButton('code', 'Developer tools (F12)', () => browserCommand('devtools'), 'icon-button browser-devtools');
  const external = browserButton('external', 'Open in your browser', () => browserCommand('external'), 'icon-button browser-external');
  bar.append(back, forward, reload, address, preset, devtools, external);
  queueMicrotask(updateBrowserBar);
  return bar;
}

function updateBrowserBar() {
  const s = BROWSER.state;
  const bar = document.querySelector('.browser-bar');
  if (bar) {
    bar.querySelector('.browser-back').disabled = !s.canGoBack;
    bar.querySelector('.browser-forward').disabled = !s.canGoForward;
    const reload = bar.querySelector('.browser-reload');
    reload.innerHTML = s.loading ? ICON.x : ICON.refresh;
    reload.title = s.loading ? 'Stop loading' : 'Reload (F5)';
    reload.disabled = !s.url;
    bar.querySelector('.browser-devtools').disabled = !s.url;
    bar.querySelector('.browser-external').disabled = !s.url;
    const address = bar.querySelector('.browser-url');
    if (!address.dataset.editing) address.value = s.url;
    bar.querySelector('.browser-preset').value = s.preset || 'desktop';
    bar.classList.toggle('loading', Boolean(s.loading));
  }
  renderBrowserEmpty();
  syncBrowserLayout();
}

// No page yet: what to open, with the dev servers running in the background.
function renderBrowserEmpty() {
  const host = $('browserHost');
  if (!host) return;
  const empty = !BROWSER.state.url;
  host.classList.toggle('empty', empty);
  host.replaceChildren();
  if (!empty) return;
  const box = el('div', 'browser-empty');
  box.append(icon('globe', 'icon browser-empty-icon'), el('div', 'browser-empty-title', 'Open a page'),
    el('div', 'browser-empty-text', 'Type an address above, or ask the agent to check your app here.'));
  const urls = [...new Set([...backgroundBySession.values()].flat().filter((job) => job.url).map((job) => job.url))];
  for (const url of urls.slice(0, 4)) {
    const link = el('button', 'btn small browser-empty-link');
    link.append(icon('external'), el('span', null, url));
    link.addEventListener('click', () => browserGo(url));
    box.append(link);
  }
  host.append(box);
}

// ── Where the page is drawn ────────────────────────────────────────────────
// A native page covers whatever is drawn over its place, so it steps aside
// while a dialog, the image viewer or the drop target is open.
const coveredByDialog = () => Boolean(document.querySelector('.overlay:not([hidden]), #viewer, #dropOverlay:not([hidden])'));

// Tells the main process where the pane is, if that changed. True when it did.
function sendBrowserLayout() {
  const host = $('browserHost');
  const visible = browserShown() && Boolean(BROWSER.state.url) && !coveredByDialog();
  const r = host.getBoundingClientRect();
  const layout = { visible: visible && r.width > 0 && r.height > 0, rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
  const key = JSON.stringify([layout.visible, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
  if (key === BROWSER.sent) return false;
  BROWSER.sent = key;
  cf.browserLayout(layout);
  return true;
}

// Something may have moved the pane: say where it is now, then follow it
// frame by frame until it has stayed put for a while. A sidebar sliding shut
// moves it without resizing it. A window where nothing moves draws nothing.
function syncBrowserLayout() {
  if (!$('browserHost') || typeof cf.browserLayout !== 'function') return;
  sendBrowserLayout();
  BROWSER.still = 0;
  if (browserShown() && !BROWSER.frame) BROWSER.frame = requestAnimationFrame(followBrowserLayout);
}

function followBrowserLayout() {
  BROWSER.frame = 0;
  if (sendBrowserLayout()) BROWSER.still = 0;
  else BROWSER.still++;
  if (browserShown() && BROWSER.still < BROWSER_SETTLE_FRAMES) BROWSER.frame = requestAnimationFrame(followBrowserLayout);
}

// What can move the pane: the window, the sidebar, the panels and the pane
// itself changing size, and anything sliding into place.
function watchBrowserLayout() {
  const resized = new ResizeObserver(() => syncBrowserLayout());
  for (const node of [$('browserHost'), document.querySelector('.sidebar'), document.querySelector('.main'),
    $('agentsPanel'), $('termPanel')]) {
    if (node) resized.observe(node);
  }
  const moving = (event) => {
    if (browserShown() && !PAINT_ONLY_TRANSITION.test(event.propertyName || '')) syncBrowserLayout();
  };
  for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) document.addEventListener(type, moving, true);
}

function onBrowserEvent(channel, payload) {
  if (channel === 'browser:state') {
    BROWSER.state = { ...BROWSER.state, ...payload };
    updateBrowserBar();
  } else if (channel === 'browser:reveal') {
    // The agent is using the browser: show it, without taking the user's focus.
    if (!browserShown()) openBrowserPanel({ focus: false });
  } else if (channel === 'browser:shortcut') {
    if (payload === 'terminal') toggleTerminalPanel();
    else if (payload === 'address') {
      const address = $('browserUrl');
      if (address) address.focus();
    }
  }
}

async function wireBrowser() {
  const host = el('div', 'browser-host');
  host.id = 'browserHost';
  $('termBody').append(host);
  if (typeof cf.onBrowser !== 'function') return;
  cf.onBrowser(onBrowserEvent);
  watchBrowserLayout();
  // Dialogs open and close by their hidden attribute or by being added.
  new MutationObserver(() => syncBrowserLayout()).observe(document.body, {
    childList: true, subtree: false, attributes: true, attributeFilter: ['hidden'],
  });
  for (const id of ['settings', 'dropOverlay']) {
    const node = $(id);
    if (node) new MutationObserver(() => syncBrowserLayout()).observe(node, { attributes: true, attributeFilter: ['hidden'] });
  }
  try { BROWSER.state = await call(cf.browserState); } catch { /* a blank page, then */ }
  renderBrowserEmpty();
}
