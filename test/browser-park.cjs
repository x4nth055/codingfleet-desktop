'use strict';
// A page left behind a closed browser pane is closed after a while, its
// address kept, and loaded again when the pane opens or the agent uses the
// browser. A pane only covered by a dialog keeps its page.
// Run with: npx electron test/browser-park.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createBrowser } = require('../src/main/browser');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-browser-park-')));

// A dev server's app: it holds memory and keeps a timer going.
const PAGE = `<!doctype html><title>Dev app</title><h1>Dev app</h1><p id="ticks">0</p>
<script>window.keep = new Array(2e6).fill(1); let n = 0; setInterval(() => { document.getElementById('ticks').textContent = ++n; }, 50);</script>`;
const ABOUT = '<!doctype html><title>About</title><h1>About</h1>';
const LONG = '<!doctype html><title>Long</title><h1>Long</h1><div style="height:4000px"></div><p>The end</p>';
const PARK_MS = 600;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The renderer processes alive: the window's own, and the page's while it is open.
const renderers = () => app.getAppMetrics().filter((m) => m.type === 'Tab').length;

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url.startsWith('/about') ? ABOUT : req.url.startsWith('/long') ? LONG : PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://localhost:${server.address().port}/`;
  const win = new BrowserWindow({ width: 1100, height: 800, show: false });
  await win.loadURL('data:text/html,<body style="background:#222"></body>');
  const sent = [];
  const browser = createBrowser({
    getWindow: () => win,
    send: (channel, payload) => sent.push([channel, payload]),
    log: { error: (m) => console.error(m), warn: (m) => console.error(m) },
    parkAfterMs: PARK_MS,
  });
  const rect = { x: 0, y: 0, width: 1000, height: 700 };
  const layout = (open, visible = open) => browser.forUser.setLayout({ visible, open, rect });
  const act = (args) => browser.forAgent('S', args, { call: { id: `c${Math.random()}` } });
  const text = (result) => (typeof result.output === 'string' ? result.output : result.output.text);
  let checks = 0;
  const check = (cond, message) => { assert.ok(cond, message); checks++; };

  try {
    const alone = renderers();
    layout(true);
    let state = await browser.forUser.navigate(base);
    check(state.url === base && renderers() === alone + 1, 'the page is open, in a process of its own');

    // Covered by a dialog: the pane is still open, so the page stays.
    layout(true, false);
    await sleep(PARK_MS * 2);
    check(!browser.isParked() && renderers() === alone + 1, 'a page under a dialog is kept');

    // The pane closed: after a while the page is closed, its address kept.
    layout(false);
    await sleep(PARK_MS / 2);
    check(!browser.isParked(), 'not at once');
    await sleep(PARK_MS * 2);
    check(browser.isParked(), 'closed once the pane has been closed a while');
    await sleep(500);
    check(renderers() === alone, `its process is gone (${renderers()} renderers, ${alone} before it)`);
    state = browser.forUser.state();
    check(state.url === base && state.title === 'Dev app' && !state.loading, 'the address is still shown');
    check(sent.some(([channel, payload]) => channel === 'browser:state' && payload.url === base), 'and the window was told');
    browser.forUser.back();
    browser.forUser.forward();
    browser.forUser.stop();
    check(browser.isParked(), 'back, forward and stop on a closed page do nothing');

    // The pane opened again: the page is loaded again.
    layout(true);
    await sleep(1500);
    state = browser.forUser.state();
    check(!browser.isParked() && state.url === base && renderers() === alone + 1, 'opening the pane loads the page again');
    let read = await act({ action: 'read_page' });
    check(!read.is_error && /Dev app/.test(text(read)), 'and it is the page');

    // The agent uses a parked page: it is loaded again before the action.
    layout(false);
    await sleep(PARK_MS * 2.5);
    check(browser.isParked(), 'parked again');
    read = await act({ action: 'read_page' });
    check(!read.is_error && /Dev app/.test(text(read)), `the agent's read loads it first: ${text(read).slice(0, 80)}`);
    check(sent.some(([channel]) => channel === 'browser:reveal'), 'and asks the window to show the pane');
    // No window opened the pane here: after the agent is done, it is parked again.
    await sleep(PARK_MS * 2.5);
    check(browser.isParked(), 'parked again after the agent is done');

    // The agent going somewhere else does not load the old page first.
    const nav = await act({ action: 'navigate', url: `${base}about` });
    check(!nav.is_error && /About/.test(text(nav)) && !browser.isParked(), 'navigate from a parked page goes straight there');
    await sleep(PARK_MS * 2.5);
    check(browser.isParked() && browser.forUser.state().url === `${base}about`, 'the new page is parked in its turn');

    // ...and keeps the history it had: back is the page before.
    layout(true);
    await sleep(1500);
    state = browser.forUser.state();
    check(state.url === `${base}about` && state.canGoBack, `the history survived navigating from a parked page: ${JSON.stringify(state)}`);
    check(/^Opened "About"/.test(text(nav)), `and the agent was told about the new page: ${text(nav)}`);

    // So does the user's own address.
    state = await browser.forUser.navigate(base);
    check(state.url === base && !browser.isParked() && state.canGoBack, 'the user\'s address replaces a parked page, after its history');

    // Back and forward, and where a page was scrolled to, through a park.
    await browser.forUser.navigate(`${base}about`);
    await browser.forUser.navigate(`${base}long`);
    const scrolledTo = async () => Number(/scrolled to (\d+)/.exec(text(await act({ action: 'read_page' })))[1]);
    await act({ action: 'scroll', direction: 'down' });
    await act({ action: 'scroll', direction: 'down' });
    const scroll = await scrolledTo();
    check(scroll > 0, `the long page is scrolled (${scroll}px)`);
    await sleep(6000); // Chromium keeps the state of a page in a hidden window every 5 s
    layout(false);
    await sleep(PARK_MS * 2.5);
    state = browser.forUser.state();
    check(browser.isParked() && state.url === `${base}long` && state.canGoBack && !state.canGoForward,
      `parked, still able to go back: ${JSON.stringify(state)}`);
    browser.forUser.back();
    await sleep(1500);
    state = browser.forUser.state();
    check(!browser.isParked() && state.url === `${base}about` && state.canGoBack && state.canGoForward,
      `back on a parked page loads the page before, with its history: ${JSON.stringify(state)}`);
    browser.forUser.forward();
    await sleep(1500);
    state = browser.forUser.state();
    check(state.url === `${base}long` && !state.canGoForward, 'and forward comes back');
    const again = await scrolledTo();
    check(Math.abs(again - scroll) <= 2, `where the page was scrolled to is back: ${again}px, was ${scroll}px`);
    browser.forUser.back();
    await sleep(1200);
    browser.forUser.back();
    await sleep(1200);
    check(browser.forUser.state().url === base, 'and back goes all the way it went before the park');
    const agentBack = await act({ action: 'back' });
    check(!agentBack.is_error, `the agent's back works on that history too: ${text(agentBack)}`);

    // Clearing the browser's data while a page is parked keeps its address,
    // not its history.
    await browser.forUser.navigate(`${base}about`);
    layout(false);
    await sleep(PARK_MS * 2.5);
    check(browser.isParked() && browser.forUser.state().canGoBack, 'parked with a history');
    await browser.forUser.clearData();
    state = browser.forUser.state();
    check(browser.isParked() && state.url === `${base}about` && !state.canGoBack && !state.canGoForward,
      'clearing the data leaves the parked address, without its history');
    console.log(`PASS browser park: ${checks} checks`);
    server.close();
    app.exit(0);
  } catch (err) {
    console.error(`FAILED after ${checks} checks:`, err.message);
    server.close();
    app.exit(1);
  }
});
