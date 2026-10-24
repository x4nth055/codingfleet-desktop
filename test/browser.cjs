'use strict';
// The browser tool on a real page: a small app served on localhost, driven
// through src/main/browser.js the way a run drives it.
// Run with: npx electron test/browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createBrowser } = require('../src/main/browser');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-browser-')));

const PAGE = `<!doctype html><html><head><title>Todo test</title><meta name="viewport" content="width=device-width">
<style>body{font:16px sans-serif;margin:20px} .gone{display:none} li{margin:4px 0}</style></head><body>
<h1>My todos</h1>
<p>Things to do <b>today</b>, in order.</p>
<label for="new">New todo</label> <input id="new" placeholder="What needs doing?">
<button id="add">Add</button>
<label><input type="checkbox" id="done"> Show done</label>
<select id="sort" aria-label="Sort"><option>Newest</option><option>Oldest</option></select>
<input type="password" id="pw" aria-label="Password" value="secret">
<ul id="list"></ul>
<p class="gone">Hidden text that must not be read</p>
<a href="/about">About this app</a>
<div style="height:2000px"></div><p id="end">The end of the page</p>
<script>
  const add = () => {
    const input = document.getElementById('new');
    if (!input.value) { console.error('Nothing to add'); return; }
    const li = document.createElement('li'); li.textContent = input.value; document.getElementById('list').append(li);
    input.value = '';
  };
  document.getElementById('add').onclick = add;
  document.getElementById('new').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  console.log('app ready');
</script></body></html>`;
const ABOUT = '<!doctype html><title>About</title><h1>About</h1><p>A test page.</p>';

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(req.url.startsWith('/about') ? ABOUT : PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://localhost:${server.address().port}`;
  const win = new BrowserWindow({ width: 1100, height: 800, show: true, x: 40, y: 40 });
  await win.loadURL('data:text/html,<body style="background:#222"></body>');
  const events = [];
  const images = [];
  const policy = { sites: [], anySite: false };
  const browser = createBrowser({
    policy: () => policy,
    getWindow: () => win,
    send: (channel, payload) => events.push([channel, payload]),
    log: { error: (m) => console.error(m) },
    onImage: (_s, shot) => images.push(shot),
  });
  browser.forUser.setLayout({ visible: true, rect: { x: 0, y: 0, width: 1000, height: 700 } });
  const act = async (args) => { if (process.env.CF_DEBUG) console.log('>', JSON.stringify(args)); const r = await browser.forAgent('S', args, { call: { id: `c${Math.random()}` } }); if (process.env.CF_DEBUG) console.log('<', JSON.stringify(r).slice(0, 300)); return r; };
  const textOf = (result) => (typeof result.output === 'string' ? result.output : result.output.text);
  let checks = 0;
  const check = (cond, message) => { assert.ok(cond, message); checks++; };

  try {
    // Nothing open yet.
    let r = await act({ action: 'read_page' });
    check(r.is_error && /No page is open/.test(r.output), 'read_page before navigate says to navigate');

    r = await act({ action: 'navigate', url: `localhost:${server.address().port}` });
    check(!r.is_error && /Opened "Todo test" http:\/\/localhost/.test(textOf(r)), `navigate: ${textOf(r)}`);
    check(events.some(([c]) => c === 'browser:reveal'), 'the pane is revealed for the agent');

    r = await act({ action: 'read_page' });
    const listing = textOf(r);
    check(/^Page "Todo test" http:\/\/localhost/.test(listing), 'read_page header');
    check(/heading 1 "My todos"/.test(listing), 'heading');
    check(/text "Things to do today, in order\."/.test(listing), 'inline text joined into one line');
    check(/\[ref_\d+\] textbox "New todo" placeholder="What needs doing\?"/.test(listing), `labelled field: ${listing}`);
    check(/\[ref_\d+\] button "Add"/.test(listing), 'button');
    check(/\[ref_\d+\] checkbox "Show done"/.test(listing), 'checkbox');
    check(/combobox "Sort" value="Newest" options="Newest \| Oldest"/.test(listing), 'select');
    check(/textbox "Password" value=\(hidden\)/.test(listing) && !listing.includes('secret'), 'a password is never read');
    check(!listing.includes('Hidden text'), 'hidden text is not read');
    check(/link "About this app" → \/about/.test(listing), 'link');
    const ref = (pattern) => new RegExp(`\\[(ref_\\d+)\\] ${pattern}`).exec(listing)[1];

    r = await act({ action: 'find', query: 'add' });
    check(/1 match for "add":\n\[ref_\d+\] button "Add"/.test(textOf(r)), `find: ${textOf(r)}`);

    // Click with nothing typed: the app logs an error, and the result says so.
    r = await act({ action: 'click', ref: ref('button "Add"') });
    // The error it logs is mentioned when it lands within the click's settle
    // time; on a busy machine it may land after, and console reads it below.
    check(/^Clicked button "Add"\./.test(textOf(r)), `click: ${textOf(r)}`);

    r = await act({ action: 'type', ref: ref('textbox "New todo"'), text: 'Buy milk', submit: true });
    check(/Typed 8 characters into textbox "New todo".* and pressed Enter\.$/.test(textOf(r)), `type, and an error said once: ${textOf(r)}`);
    r = await act({ action: 'type', ref: ref('textbox "New todo"'), text: 'Walk the dog' });
    r = await act({ action: 'click', ref: ref('button "Add"') });
    r = await act({ action: 'read_page' });
    check(/text "Buy milk"\ntext "Walk the dog"/.test(textOf(r)), `typed items listed: ${textOf(r)}`);

    r = await act({ action: 'click', ref: ref('checkbox "Show done"') });
    r = await act({ action: 'find', query: 'show done' });
    check(/checkbox "Show done" checked/.test(textOf(r)), 'checkbox clicked');

    r = await act({ action: 'console', errors_only: true });
    check(/\[error\] Nothing to add \(\/:\d+\)/.test(textOf(r)) && !/app ready/.test(textOf(r)), `console errors: ${textOf(r)}`);
    r = await act({ action: 'console' });
    check(/No console messages since the last look/.test(textOf(r)), 'console reads each message once');

    r = await act({ action: 'scroll', direction: 'down' });
    check(/Scrolled down: now at \d+ of \d+/.test(textOf(r)), `scroll: ${textOf(r)}`);
    r = await act({ action: 'press', keys: 'Control+Hyper' });
    check(r.is_error && /Unknown key/.test(r.output), 'a bad key is refused');

    r = await act({ action: 'screenshot' });
    // In device pixels: 1000x700 on a 100% display, more on a scaled one.
    check(!r.is_error && r.output.data && Math.abs(r.output.width / r.output.height - 1000 / 700) < 0.01
      && r.output.width >= 1000 && Math.max(r.output.width, r.output.height) <= 1280, `screenshot ${r.output.width}x${r.output.height}`);
    check(images.length === 1 && images[0].title === 'The page', 'the picture goes to the call details');
    r = await act({ action: 'screenshot', ref: ref('button "Add"') });
    check(!r.is_error && r.output.width < 200 && /\(button "Add"\)/.test(r.output.text), `element screenshot ${r.output.width}x${r.output.height}`);

    r = await act({ action: 'viewport', preset: 'mobile' });
    check(/The page is now mobile: 390x700/.test(textOf(r)), `viewport: ${textOf(r)}`);
    r = await act({ action: 'read_page' });
    check(/Viewport 390x700/.test(textOf(r)), `the page sees the phone width: ${textOf(r).split('\n')[1]}`);
    // Clicking still lands on the right element in the narrower, centered page.
    r = await act({ action: 'click', ref: ref('checkbox "Show done"') });
    r = await act({ action: 'find', query: 'show done' });
    check(!/checkbox "Show done" checked/.test(textOf(r)), `a click on the phone-sized page: ${textOf(r)}`);
    r = await act({ action: 'screenshot' });
    check(!r.is_error && Math.abs(r.output.width / r.output.height - 390 / 700) < 0.02, `the phone page alone ${r.output.width}x${r.output.height}`);
    // A tablet in a pane narrower than it: the page is scaled down, and clicks still land.
    browser.forUser.setLayout({ visible: true, rect: { x: 0, y: 0, width: 460, height: 700 } });
    r = await act({ action: 'viewport', preset: 'tablet' });
    check(/The page is now tablet: 820x\d+/.test(textOf(r)), `tablet: ${textOf(r)}`);
    r = await act({ action: 'click', ref: ref('checkbox "Show done"') });
    r = await act({ action: 'find', query: 'show done' });
    check(/checkbox "Show done" checked/.test(textOf(r)), `a click on the scaled page: ${textOf(r)}`);
    browser.forUser.setLayout({ visible: true, rect: { x: 0, y: 0, width: 1000, height: 700 } });
    r = await act({ action: 'viewport', preset: 'desktop' });

    r = await act({ action: 'click', ref: ref('link "About this app"') });
    check(/Now on "About" http:\/\/localhost:\d+\/about/.test(textOf(r)), `link click navigates: ${textOf(r)}`);
    r = await act({ action: 'click', ref: ref('button "Add"') });
    check(r.is_error && /read_page again/.test(r.output), 'an old ref says to read again');
    r = await act({ action: 'back' });
    check(/Went back to "Todo test"/.test(textOf(r)), 'back');

    r = await act({ action: 'navigate', url: `http://localhost:${server.address().port + 1}/` });
    check(r.is_error && /Is the dev server running\?/.test(r.output), `a dead local server: ${r.output}`);
    r = await act({ action: 'navigate', url: 'file:///etc/passwd' });
    check(r.is_error && /http or https/.test(r.output), 'file: is refused');

    // Approvals: localhost runs at once; another site asks (one reason for
    // opening and using it, which the session then remembers), typing every time.
    const reason = (args) => browser.approvalReason(args);
    check(reason({ action: 'navigate', url: base }) === null, 'localhost needs no OK');
    check(reason({ action: 'read_page' }) === null, 'reading a local page needs no OK');
    check(reason({ action: 'navigate', url: 'https://example.com/a' }) === 'uses example.com in the browser', 'a site asks');
    // 127.0.0.2 reaches this computer but is not localhost: it stands in for a site.
    const foreign = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(ABOUT); });
    await new Promise((resolve) => foreign.listen(0, '127.0.0.2', resolve));
    const site = `127.0.0.2:${foreign.address().port}`;
    r = await act({ action: 'navigate', url: `http://${site}/` });
    check(!r.is_error, `the stand-in site opens: ${textOf(r)}`);
    check(reason({ action: 'read_page' }) === `uses ${site} in the browser`, 'using the site asks, with the same reason as opening it');
    check(reason({ action: 'type', ref: 'ref_1', text: 'x' }) === `types into ${site}`, 'typing into it asks');
    check(reason({ action: 'press', keys: 'Enter' }) === `types into ${site}`, 'and so does pressing Enter there');
    check(reason({ action: 'press', keys: 'Escape' }) === `uses ${site} in the browser`, 'other keys are only using it');
    // Every site allowed: opening and using ask no more, typing still does.
    policy.anySite = true;
    check(reason({ action: 'navigate', url: 'https://example.com/' }) === null, 'any site: opening needs no OK');
    check(reason({ action: 'read_page' }) === null, 'any site: using needs no OK');
    check(reason({ action: 'type', ref: 'ref_1', text: 'x' }) === `types into ${site}`, 'any site: typing still asks');
    policy.anySite = false;
    // A site on the user's list is trusted like localhost, typing included.
    policy.sites = ['127.0.0.2'];
    check(reason({ action: 'read_page' }) === null && reason({ action: 'type', ref: 'ref_1', text: 'x' }) === null,
      'a listed site never asks');
    check(reason({ action: 'navigate', url: 'https://example.com/' }) === 'uses example.com in the browser', 'other sites still ask');
    policy.sites = [];
    foreign.close();
  } finally {
    browser.dispose();
    server.close();
  }
  console.log(`PASS browser tool: ${checks} checks`);
  app.exit(0);
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
