'use strict';
// Live end-to-end test of the browser tool with a real model: the Agent API
// offers it (browser_use: true), the model calls it, and this computer runs
// the calls through the desktop's own runner and browser, on a small todo app
// served here, with a bug to find.
//   CODINGFLEET_API_KEY=cf_sk_... CODINGFLEET_API_BASE=http://127.0.0.1:8010/v1 npx electron test/e2e-browser.cjs
//   E2E_MODELS=claude-haiku-5.5-native-e2e,gpt-6-luna-instant  to pick the models
//   E2E_SHOTS=<folder>  to keep a picture of the window after each model
const { app, BrowserWindow, desktopCapturer } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-browser-agent-')));

const MODELS = (process.env.E2E_MODELS || 'claude-haiku-5.5-native-e2e,gpt-6-luna-instant,deepseek-v4.1-flash-low')
  .split(',').map((m) => m.trim()).filter(Boolean);
const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

// A todo app whose Add button logs an error and adds nothing: the bug to find.
const APP = `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<title>Todo app</title><style>body{font:16px system-ui;margin:24px} li{margin:4px 0}</style></head><body>
<h1>My todos</h1>
<form id="f"><label for="t">New todo</label> <input id="t" name="t" placeholder="What needs doing?"> <button>Add</button></form>
<ul id="list"><li>Walk the dog</li></ul>
<script>
  window.seen = { submits: 0, typed: '' };
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault();
    window.seen.submits++;
    window.seen.typed = document.getElementById('t').value;
    console.error('Could not save the todo: TODO_STORE_FULL (the list holds one item)');
  });
</script></body></html>`;

const task = (url) => `My todo app is running at ${url}. Using the browser tool: open it, add a todo named `
  + "'Buy milk' with its form, then read the browser console. Answer in two short sentences: did adding work, "
  + 'and what exact error did the console show?';
const SITE_TASK = 'Use the browser tool to open https://example.com and tell me its main heading, in a few words.';
const PHONE_TASK = (url) => `Check how my app at ${url} looks on a phone: with the browser tool, switch the page to the `
  + 'mobile size, then take a screenshot and look at it. Do not use read_page. In one sentence, quote the main heading '
  + 'you see in the picture and say whether the Add button fits on the screen.';
// Models that cannot see pictures: they are not offered screenshots.
const BLIND = /ling-3|deepseek-v4-pro/;

app.whenReady().then(async () => {
  const api = require('../src/core/api');
  const { Run } = require('../src/core/runner');
  const { createBrowser } = require('../src/main/browser');
  api.configure({ client: `desktop/${require('../package.json').version}` });

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(APP);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://localhost:${server.address().port}/`;

  const win = new BrowserWindow({ x: 60, y: 60, width: 1100, height: 760, show: true, title: 'Browser tool e2e' });
  await win.loadURL('data:text/html,<body style="background:#16181d"></body>');
  const browser = createBrowser({ getWindow: () => win, send: () => {}, log: { error: console.error } });
  browser.forUser.setLayout({ visible: true, rect: { x: 0, y: 0, width: 1100, height: 760 } });
  const page = async (js) => {
    const view = win.contentView.children[0];
    return view.webContents.executeJavaScript(js);
  };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-browser-agent-cwd-'));
  console.log(`api: ${api.API_BASE}\napp: ${url}\nmodels: ${MODELS.join(', ')}\n`);

  async function runTask(model, message, decide) {
    const session = await api.createSession({
      executor: 'client', model, capabilities: { code_execution: true },
      system_message: `You are CodingFleet's coding agent on the user's computer. Working directory: ${cwd}. Be brief.`,
    });
    const calls = [];
    const outputs = [];
    const asked = [];
    let answer = '';
    let ended = null;
    const run = new Run({
      sessionId: session.id,
      cwd,
      // The app's own rule (main.js approve): the browser's reason, or none.
      approve: (call) => {
        const reason = call.name === 'browser' ? browser.approvalReason(call.arguments) : null;
        if (reason) asked.push(reason);
        return reason ? decide(reason) : 'allow';
      },
      clientHandlers: new Map([['browser', async (args, context) => {
        calls.push(args);
        const result = await browser.forAgent(session.id, args, context);
        outputs.push(result);
        return result;
      }]]),
      onEvent: (event, data) => {
        if (event === 'text.delta') answer += data.text;
        if (event === 'run.ended') ended = data;
      },
    });
    const started = Date.now();
    await run.start({ message, model, browser_use: true });
    return { calls, outputs, asked, answer: answer.trim(), ended, seconds: Math.round((Date.now() - started) / 1000) };
  }

  const describe = (calls) => calls.map((c) => c.action + (c.ref ? `(${c.ref})` : c.url ? `(${c.url})` : '')).join(', ');

  try {
    for (const [i, model] of MODELS.entries()) {
      await browser.forUser.navigate('about:blank');
      const r = await runTask(model, task(url), () => 'allow');
      const seen = await page('JSON.stringify(window.seen || null)').then(JSON.parse).catch(() => null);
      console.log(`\n[${model}] ${r.calls.length} browser calls in ${r.seconds} s: ${describe(r.calls)}`);
      const failed = r.outputs.filter((o) => o.is_error).map((o) => (typeof o.output === 'string' ? o.output : o.output.text));
      if (failed.length) console.log(`      tool errors: ${failed.join(' | ').slice(0, 400)}`);
      console.log(`      answer: ${r.answer.slice(0, 300)}`);
      check(`${model}: the run ended normally`, r.ended && r.ended.reason === 'completed', JSON.stringify(r.ended));
      check(`${model}: it opened the app`, r.calls.some((c) => c.action === 'navigate'));
      check(`${model}: it read the page before acting`, r.calls.some((c) => c.action === 'read_page' || c.action === 'find'));
      check(`${model}: it typed 'Buy milk' and submitted`, seen && seen.submits >= 1 && /buy milk/i.test(seen.typed), JSON.stringify(seen));
      check(`${model}: it read the console`, r.calls.some((c) => c.action === 'console'));
      check(`${model}: its answer names the error`, /TODO_STORE_FULL/.test(r.answer), r.answer.slice(0, 120));
      check(`${model}: a localhost page never asked the user`, r.asked.length === 0, r.asked.join('; '));
      const consoleText = r.outputs.map((o) => (o.output && o.output.text) || '').join('\n');
      check(`${model}: the console held this page's error once`, (consoleText.match(/TODO_STORE_FULL/g) || []).length === 1, consoleText.slice(0, 160));

      // The look of the page, for a model that can see: a phone size and a picture.
      if (!BLIND.test(model)) {
        const look = await runTask(model, PHONE_TASK(url), () => 'allow');
        const pictures = look.outputs.filter((o) => o.output && o.output.data);
        console.log(`[${model}, phone] ${look.calls.length} calls in ${look.seconds} s: ${describe(look.calls)}\n      answer: ${look.answer.slice(0, 200)}`);
        check(`${model}: it switched the page to the mobile size`, look.calls.some((c) => c.action === 'viewport' && c.preset === 'mobile'));
        check(`${model}: it took a screenshot, and the picture reached it`, pictures.length >= 1 && /My todos/i.test(look.answer),
          `${pictures.length} pictures; ${look.answer.slice(0, 80)}`);
        check(`${model}: the phone run ended normally`, look.ended && look.ended.reason === 'completed', JSON.stringify(look.ended));
        await browser.forUser.setPreset('desktop');
      }
      if (process.env.E2E_SHOTS) {
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1100, height: 760 } });
        const own = sources.find((s) => s.name === 'Browser tool e2e');
        if (own) fs.writeFileSync(path.join(process.env.E2E_SHOTS, `e2e-${i}-${model.replace(/[^\w.-]+/g, '_')}.png`), own.thumbnail.toPNG());
      }
    }

    // Another site waits for the user; here the user says no, and the model is told.
    const model = MODELS[0];
    const r = await runTask(model, SITE_TASK, () => 'deny');
    console.log(`\n[${model}, example.com, denied] ${r.calls.length} calls: ${describe(r.calls)}\n      asked: ${r.asked.join('; ')}\n      answer: ${r.answer.slice(0, 200)}`);
    check(`${model}: opening example.com asked the user`, r.asked.includes('uses example.com in the browser'), r.asked.join('; '));
    const state = browser.forUser.state();
    check(`${model}: a denied site was never opened`, !/example\.com/.test(state.url), state.url);
    check(`${model}: the run still ended normally`, r.ended && r.ended.reason === 'completed', JSON.stringify(r.ended));
  } catch (err) {
    check('no exception', false, err.stack);
  } finally {
    browser.dispose();
    server.close();
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    app.exit(failed ? 1 : 0);
  }
});
