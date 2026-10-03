'use strict';
// Live end-to-end test of computer use with a real model: the Agent API
// offers the computer tool (computer_use: true), the model calls it, this
// computer runs the calls through the desktop's own runner and controller,
// and the page in a test window shows what the agent did.
//   CODINGFLEET_API_KEY=cf_sk_... CODINGFLEET_API_BASE=http://127.0.0.1:8765/v1 npx electron test/e2e-computer-agent.cjs
//   E2E_MODELS=claude-sonnet-5-medium,gpt-5.6-luna-instant  to pick the models (the third default,
//   deepseek-v4-pro-instant, cannot see images: it works from the elements list alone)
// Windows only for now; every input goes to the test window, kept on top.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-computer-agent-')));

const MODELS = (process.env.E2E_MODELS || 'claude-sonnet-5-medium,gpt-5.6-luna-instant,deepseek-v4-pro-instant')
  .split(',').map((m) => m.trim()).filter(Boolean);
const results = [];
const check = (label, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  - ${detail}` : ''}`);
};

const TASK = "A window titled 'Computer use target' is open on my screen. Using the computer tool, in that window: "
  + "type 'hello from the agent' into the Name field, tick the 'I agree' checkbox, then click the Go button. "
  + 'Start with the elements action on that window. When it is done, answer in one short sentence.';

app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  if (process.platform !== 'win32') {
    console.log('SKIP  runs on Windows');
    app.exit(0);
    return;
  }
  const api = require('../src/core/api');
  const { Run } = require('../src/core/runner');
  const { createComputer } = require('../src/main/computer');
  const { WindowsComputer } = require('../src/main/computer/win');
  api.configure({ client: `desktop/${require('../package.json').version}` });
  const probe = new WindowsComputer({ cacheDir: path.join(app.getPath('userData'), 'probe') });
  const cursorAtStart = await probe.cursor();

  const target = new BrowserWindow({ x: 60, y: 60, width: 900, height: 640, show: false, title: 'Computer use target' });
  target.setAlwaysOnTop(true, 'floating');
  const page = (js) => target.webContents.executeJavaScript(js);
  const stops = [];
  const computer = createComputer({
    getWindow: () => null,
    enabled: () => true,
    cacheDir: path.join(app.getPath('userData'), 'computer'),
    log: { info() {}, warn: console.warn, error: console.error },
    onStop: (id) => stops.push(id),
    isOwnWindow: (w) => Boolean(w) && w.title === 'CodingFleet is using your computer',
  });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-computer-agent-cwd-'));
  console.log(`api: ${api.API_BASE || process.env.CODINGFLEET_API_BASE}\nmodels: ${MODELS.join(', ')}\n`);

  try {
    for (const model of MODELS) {
      await target.loadFile(path.join(__dirname, 'fixtures', 'computer-page.html'));
      target.show();
      target.focus();
      const session = await api.createSession({
        executor: 'client', model, capabilities: { code_execution: true },
        system_message: `You are an agent working on the user's computer. Working directory: ${cwd}. Be brief.`,
      });
      const calls = [];
      const results_ = [];
      let answer = '';
      let ended = null;
      const run = new Run({
        sessionId: session.id,
        cwd,
        approve: () => 'allow',
        clientHandlers: new Map([['computer', async (args, context) => {
          calls.push(args);
          const result = await computer.forAgent(session.id, args, context);
          results_.push(result);
          return result;
        }]]),
        onEvent: (event, data) => {
          if (event === 'text.delta') answer += data.text;
          if (event === 'run.ended') ended = data;
        },
      });
      const started = Date.now();
      await run.start({ message: TASK, model, computer_use: true });
      computer.endRun(session.id);
      const seconds = Math.round((Date.now() - started) / 1000);
      const seen = await page("({ name: document.getElementById('name').value, agree: document.getElementById('agree').checked, go: window.seen.go })");
      console.log(`\n[${model}] ${calls.length} computer calls in ${seconds} s: ${calls.map((c) => c.action + (c.element != null ? `#${c.element}` : '')).join(', ')}`);
      const failed = results_.filter((r) => r.is_error).map((r) => (typeof r.output === 'string' ? r.output : r.output.text));
      if (failed.length) console.log(`      errors: ${failed.join(' | ')}`);
      console.log(`      answer: ${answer.trim().slice(0, 200)}`);
      check(`${model}: the run ended normally`, ended && ended.reason === 'completed', JSON.stringify(ended));
      check(`${model}: the model used the computer tool`, calls.length > 0);
      check(`${model}: it read the window with elements`, calls.some((c) => c.action === 'elements'));
      check(`${model}: the Name field says what it was told`, seen.name === 'hello from the agent', JSON.stringify(seen.name));
      check(`${model}: the checkbox is ticked`, seen.agree === true);
      check(`${model}: Go was clicked`, seen.go >= 1, `go=${seen.go}`);
      const pictures = results_.filter((r) => r.output && r.output.data).length;
      console.log(`      pictures sent: ${pictures} of ${results_.length} results`);
    }
  } catch (err) {
    check('no exception', false, err.stack);
  } finally {
    await probe.move(cursorAtStart[0], cursorAtStart[1]).catch(() => {});
    probe.stop();
    computer.dispose();
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    app.exit(failed ? 1 : 0);
  }
});
