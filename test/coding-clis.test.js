'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const clis = require('../src/core/coding-clis');
const guard = require('../src/core/guard');
const words = require('../src/renderer/lib/tool-words');
const { createCodingAgents } = require('../src/main/coding-agents');

const jwt = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cf-clis-'));

// ── Parsers ─────────────────────────────────────────────────────────────────

test('versions are read from what each CLI prints', () => {
  assert.equal(clis.parseVersion('codex-cli 0.48.0'), '0.48.0');
  assert.equal(clis.parseVersion('2.1.258 (Claude Code)'), '2.1.258');
  assert.equal(clis.parseVersion('\x1b[1mv1.0.12\x1b[0m\n'), '1.0.12');
  assert.equal(clis.parseVersion('2026.07.01-41b2de7'), '2026.07.01-41b2de7');
  assert.equal(clis.parseVersion('aider 0.86.1'), '0.86.1');
  assert.equal(clis.parseVersion('no version here'), null);
});

test('codex login status: ChatGPT, API key, signed out', () => {
  assert.deepEqual(clis.parseCodexStatus({ code: 0, text: 'Logged in using ChatGPT\n' }), { signedIn: true, method: 'ChatGPT account' });
  assert.deepEqual(clis.parseCodexStatus({ code: 0, text: 'Logged in using an API key - sk-proj-***abcd' }), { signedIn: true, method: 'API key' });
  assert.deepEqual(clis.parseCodexStatus({ code: 1, text: 'Not logged in' }), { signedIn: false });
  assert.deepEqual(clis.parseCodexStatus({ code: null, text: '' }), { signedIn: null });
});

test("Codex's plan comes from the ID token's plan claim, and nothing else leaves", () => {
  const auth = {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt({ email: 'dev@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', chatgpt_account_id: 'acc_1' } }),
      access_token: 'secret-access', refresh_token: 'secret-refresh',
    },
  };
  const got = clis.codexPlanFromAuth(JSON.stringify(auth));
  assert.deepEqual(got, { plan: 'Plus', account: 'dev@example.com' });
  assert.ok(!JSON.stringify(got).includes('secret'));
  // Older files keep the token as { raw_jwt }.
  const old = { tokens: { id_token: { raw_jwt: jwt({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } }) } } };
  assert.equal(clis.codexPlanFromAuth(JSON.stringify(old)).plan, 'Pro');
  assert.deepEqual(clis.codexPlanFromAuth('not json'), {});
  assert.deepEqual(clis.codexPlanFromAuth(JSON.stringify({ tokens: { id_token: 'x' } })), {});
  assert.equal(clis.codexPlanFromAuth(JSON.stringify({ tokens: { id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'unknown' } }) } })).plan, null);
});

test('claude auth status: the JSON, signed out and in', () => {
  const out = '{\n  "loggedIn": false,\n  "authMethod": "none",\n  "apiProvider": "firstParty"\n}';
  assert.deepEqual(clis.parseClaudeStatus({ code: 1, text: out }),
    { signedIn: false, method: null, plan: null, account: null, org: null });
  const inJson = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'a@b.c', orgName: "A's Org" });
  assert.deepEqual(clis.parseClaudeStatus({ code: 0, text: inJson }),
    { signedIn: true, method: 'Claude account', plan: 'Max', account: 'a@b.c', org: "A's Org" });
  assert.equal(clis.parseClaudeStatus({ code: 0, text: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }) }).method, 'API key');
  assert.equal(clis.parseClaudeStatus({ code: 0, text: 'garbage' }).signedIn, true);
});

test('Gemini CLI: Google sign-in, API key, Vertex, nothing', () => {
  const nested = '{\n  // comment\n  "security": { "auth": { "selectedType": "oauth-personal" } }\n}';
  assert.deepEqual(clis.geminiStatus({ settingsText: nested, hasOauthCreds: true, accountsText: '{"active":"me@gmail.com","old":[]}', env: {} }),
    { signedIn: true, method: 'Google account', account: 'me@gmail.com' });
  assert.equal(clis.geminiStatus({ settingsText: nested, hasOauthCreds: false, env: {} }).signedIn, false);
  assert.deepEqual(clis.geminiStatus({ settingsText: '{"selectedAuthType":"gemini-api-key"}', env: { GEMINI_API_KEY: 'k' } }),
    { signedIn: true, method: 'API key (GEMINI_API_KEY)' });
  assert.equal(clis.geminiStatus({ settingsText: '{"selectedAuthType":"vertex-ai"}', env: { GOOGLE_CLOUD_PROJECT: 'p' } }).signedIn, true);
  assert.deepEqual(clis.geminiStatus({ settingsText: null, hasOauthCreds: false, env: {} }), { signedIn: false });
  assert.equal(clis.geminiStatus({ settingsText: null, hasOauthCreds: true, env: {} }).signedIn, true);
});

test('opencode auth list, cursor-agent status, Copilot, Amp, Aider', () => {
  const list = '\x1b[90m┌\x1b[0m  Credentials ~/.local/share/opencode/auth.json\n│\n●  Anthropic oauth\n│\n●  OpenAI api\n│\n└  2 credentials\n';
  assert.deepEqual(clis.parseOpencodeAuth({ code: 0, text: list }),
    { signedIn: true, method: '2 providers', account: 'Anthropic oauth, OpenAI api' });
  assert.deepEqual(clis.parseOpencodeAuth({ code: 0, text: '┌  Credentials\n│\n└  0 credentials' }), { signedIn: false });

  assert.deepEqual(clis.parseCursorStatus({ text: '✓ Logged in as dev@example.com' }, {}),
    { signedIn: true, method: 'Cursor account', account: 'dev@example.com' });
  assert.equal(clis.parseCursorStatus({ text: 'Not logged in' }, {}).signedIn, false);
  assert.equal(clis.parseCursorStatus({ text: '' }, { CURSOR_API_KEY: 'k' }).signedIn, true);
  assert.equal(clis.parseCursorStatus({ text: '' }, {}).signedIn, null);

  assert.equal(clis.copilotStatus({ env: { GH_TOKEN: 't' } }).method, 'GitHub token (GH_TOKEN)');
  assert.deepEqual(clis.copilotStatus({ configText: '{"last_logged_in_user":{"host":"https://github.com","login":"octo"}}', env: {} }),
    { signedIn: true, method: 'GitHub account', account: 'octo' });
  assert.equal(clis.copilotStatus({ configText: null, env: {} }).signedIn, null);

  assert.equal(clis.ampStatus({ env: { AMP_API_KEY: 'sgamp_x' } }).signedIn, true);
  assert.equal(clis.ampStatus({ hasSecrets: true, env: {} }).method, 'Amp account');
  assert.equal(clis.ampStatus({ hasSecrets: false, env: {} }).signedIn, false);

  assert.equal(clis.aiderStatus({ env: { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: ' ' } }).method, 'API keys: ANTHROPIC');
  assert.equal(clis.aiderStatus({ env: {}, hasConfig: true }).signedIn, null);
  assert.equal(clis.aiderStatus({ env: {} }).signedIn, false);
});

test('a key is reported by its variable name, never its value', () => {
  const env = { GEMINI_API_KEY: 'AIza-secret', CURSOR_API_KEY: 'cur-secret', AMP_API_KEY: 'sgamp-secret', OPENAI_API_KEY: 'sk-secret', GH_TOKEN: 'gho-secret' };
  const all = JSON.stringify([clis.geminiStatus({ env }), clis.parseCursorStatus({ text: '' }, env),
    clis.copilotStatus({ env }), clis.ampStatus({ env }), clis.aiderStatus({ env })]);
  assert.ok(!/secret/.test(all), all);
});

// ── Finding and starting ────────────────────────────────────────────────────

test('PATH search: PATHEXT on Windows, and an extensionless script there is skipped', () => {
  const files = new Set(['C:\\tools\\copilot', 'C:\\npm\\codex.cmd', 'C:\\bin\\claude.exe']);
  const exists = (f) => files.has(f);
  const env = { PATH: 'C:\\tools;"C:\\npm";C:\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(clis.findOnPath('codex', { env, platform: 'win32', exists }), 'C:\\npm\\codex.cmd');
  assert.equal(clis.findOnPath('claude', { env, platform: 'win32', exists }), 'C:\\bin\\claude.exe');
  assert.equal(clis.findOnPath('copilot', { env, platform: 'win32', exists }), null);
  const posix = new Set(['/home/u/.local/bin/claude']);
  assert.equal(clis.findOnPath('claude', { env: { PATH: '/usr/bin:/home/u/.local/bin' }, platform: 'linux', exists: (f) => posix.has(f) }),
    '/home/u/.local/bin/claude');
});

test('commands that start a CLI, and ones that only mention it', () => {
  const cases = [
    ['codex exec --sandbox workspace-write "fix the tests"', ['codex']],
    ['cd app && claude -p "review" --permission-mode acceptEdits', ['claude']],
    ['& "C:\\Users\\a\\.local\\bin\\claude.exe" -p hi', ['claude']],
    ['FOO=1 npx @openai/codex exec hi', ['codex']],
    ['cmd /c gemini -p "x"; opencode run "y"', ['gemini', 'opencode']],
    ['echo hi | cursor-agent -p "z" --output-format text', ['cursor']],
    ['copilot -p "a" -s', ['copilot']],
    ['amp -x "do it"', ['amp']],
    ['aider --message "x" --yes-always', ['aider']],
    ['git log --grep codex', []],
    ['npm install -g @openai/codex', []],
    ['echo "claude -p is great"', []],
    ['agent status', []],
    ['', []],
  ];
  for (const [command, ids] of cases) assert.deepEqual(clis.clisInCommand(command), ids, command);
});

test('what new sessions are told: only installed CLIs that are switched on and not off', () => {
  const detected = { clis: [
    { id: 'codex', installed: true, version: '0.48.0', signedIn: true, method: 'ChatGPT account', plan: 'Plus' },
    { id: 'claude', installed: true, version: '2.1.258', signedIn: false },
    { id: 'gemini', installed: false },
  ] };
  assert.equal(clis.agentInstructions(detected, {}), '');
  assert.equal(clis.agentInstructions(detected, { codex: { access: 'off', tellAgent: true } }), '');
  assert.equal(clis.agentInstructions(detected, { gemini: { access: 'allowed', tellAgent: true } }), '');
  const text = clis.agentInstructions(detected, {
    codex: { access: 'allowed', tellAgent: true }, claude: { access: 'ask', tellAgent: true },
  });
  assert.match(text, /Codex \(OpenAI\) 0\.48\.0: signed in with ChatGPT account, Plus plan\./);
  assert.match(text, /Run: codex exec --sandbox workspace-write "<task>"/);
  assert.match(text, /Claude Code \(Anthropic\) 2\.1\.258: not signed in yet.*The user approves each run\./);
  assert.match(text, /Run: claude -p "<task>" --permission-mode acceptEdits/);
  assert.match(text, /background: true/);
  assert.match(text, /--dangerously-skip-permissions/);
  assert.doesNotMatch(text, /Gemini/);
});

test('detection of one CLI, with its version, sign-in and plan', async () => {
  const home = tmpDir();
  fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ tokens: {
    id_token: jwt({ email: 'me@x.io', 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } }) } }));
  const calls = [];
  const run = async (file, args) => {
    calls.push(args.join(' '));
    if (args[0] === '--version') return { code: 0, text: 'codex-cli 0.48.0\n' };
    if (args.join(' ') === 'login status') return { code: 0, text: 'Logged in using ChatGPT\n' };
    return { code: 2, text: '' };
  };
  const got = await clis.detectOne(clis.byId.get('codex'), { env: { CODEX_HOME: home }, run, find: () => '/bin/codex' });
  assert.deepEqual(calls, ['--version', 'login status']);
  assert.equal(got.installed, true);
  assert.equal(got.version, '0.48.0');
  assert.equal(got.signedIn, true);
  assert.equal(got.method, 'ChatGPT account');
  assert.equal(got.plan, 'Pro');
  assert.equal(got.account, 'me@x.io');
});

test("VS Code's copilot launcher without the CLI is not an installed CLI", async () => {
  const run = async () => ({ code: 127, text: 'GitHub Copilot CLI was not found. Run copilot in a terminal to install it.' });
  const got = await clis.detectOne(clis.byId.get('copilot'), { env: {}, run, find: () => 'C:\\vscode\\copilot.exe' });
  assert.equal(got.installed, false);
  assert.match(got.note, /was not found/);
});

test('`agent` counts as the Cursor CLI only from a Cursor folder', async () => {
  const run = async (file, args) => (args[0] === '--version' ? { code: 0, text: '2026.07.01' } : { code: 0, text: 'Not logged in' });
  const cursor = clis.byId.get('cursor');
  const elsewhere = await clis.detectOne(cursor, { env: {}, run, find: (bin) => (bin === 'agent' ? '/usr/bin/agent' : null) });
  assert.equal(elsewhere.installed, false);
  const inCursor = await clis.detectOne(cursor, { env: {}, run, find: (bin) => (bin === 'agent' ? '/home/u/.cursor/bin/agent' : null) });
  assert.equal(inCursor.installed, true);
  assert.equal(inCursor.signedIn, false);
});

test('detection runs real programs: a fake codex on PATH, a hanging one times out', { timeout: 30000 }, async () => {
  const dir = tmpDir();
  const win = process.platform === 'win32';
  if (win) {
    fs.writeFileSync(path.join(dir, 'codex.cmd'), [
      '@echo off',
      'if "%1"=="--version" (echo codex-cli 0.48.0& exit /b 0)',
      'if "%1"=="login" (echo Logged in using an API key - sk-***& exit /b 0)',
      'exit /b 2', ''].join('\r\n'));
  } else {
    const file = path.join(dir, 'codex');
    fs.writeFileSync(file, '#!/bin/sh\n[ "$1" = "--version" ] && { echo "codex-cli 0.48.0"; exit 0; }\n'
      + '[ "$1" = "login" ] && { echo "Logged in using an API key - sk-***"; exit 0; }\nexit 2\n');
    fs.chmodSync(file, 0o755);
  }
  const env = { ...process.env, PATH: dir, CODEX_HOME: dir };
  const { clis: found } = await clis.detectAll({ env });
  const codex = found.find((d) => d.id === 'codex');
  assert.equal(codex.installed, true);
  assert.equal(codex.version, '0.48.0');
  assert.deepEqual([codex.signedIn, codex.method], [true, 'API key']);
  assert.equal(found.filter((d) => d.installed).length, 1);

  const slow = await clis.runFile(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeout: 500 });
  assert.equal(slow.timedOut, true);
});

test('login shell PATH is merged without repeats', () => {
  assert.equal(clis.mergePath('/usr/bin:/bin', '/bin:/home/u/.local/bin:/usr/bin'), '/usr/bin:/bin:/home/u/.local/bin');
});

// ── The approval and the window's words ─────────────────────────────────────

test('"starts Codex on this computer" is asked every time, with its own words', () => {
  const reason = 'starts Codex on this computer';
  assert.equal(guard.alwaysAsk(reason), true);
  assert.equal(guard.mustAsk(reason, { auto: true, allowedThisSession: true }), true);
  assert.equal(words.alwaysAsked(reason), true);
  assert.equal(words.reasonText(reason), 'wants to start Codex on this computer');
  assert.equal(words.reasonText('starts Codex and Claude Code on this computer'), 'wants to start Codex and Claude Code on this computer');
});

// ── The main-process part ───────────────────────────────────────────────────

function agents({ prefs = {}, jobs = new Map() } = {}) {
  const state = { codingAgents: prefs, sessions: { s1: { label: 'Fix login' } } };
  const sent = [];
  const logFile = path.join(tmpDir(), 'log.json');
  const ca = createCodingAgents({
    getState: () => state,
    saveState: () => {},
    send: (channel, payload) => sent.push([channel, payload]),
    logFile,
    log: { info() {}, warn() {} },
    backgroundJobs: { jobs },
    sessionLabel: (id) => (state.sessions[id] || {}).label || null,
  });
  return { ca, state, sent, logFile };
}

const runCall = (command) => ({ name: 'run_command', arguments: { command } });

test('approval follows each CLI\'s choice; other commands are left alone', () => {
  const { ca } = agents({ prefs: { codex: { access: 'allowed' }, claude: { access: 'off' } } });
  assert.equal(ca.approval(runCall('npm test')), null);
  assert.equal(ca.approval({ name: 'fs_read', arguments: { path: 'codex' } }), null);
  assert.deepEqual(ca.approval(runCall('codex exec "x"')), { ids: ['codex'], allow: true });
  assert.deepEqual(ca.approval(runCall('claude -p "x"')), { ids: ['claude'], refuse: ['claude'] });
  // Not chosen yet: ask each time.
  assert.deepEqual(ca.approval(runCall('gemini -p "x"')), { ids: ['gemini'], reason: 'starts Gemini CLI on this computer' });
  assert.deepEqual(ca.approval(runCall('codex exec a; gemini -p b')),
    { ids: ['codex', 'gemini'], reason: 'starts Codex and Gemini CLI on this computer' });
});

test('an off CLI is refused with the reason, and the refusal is logged', async () => {
  const { ca } = agents({ prefs: { claude: { access: 'off' } } });
  let ran = false;
  const result = await ca.runCommand('s1', { command: 'claude -p "x"' }, { cwd: '/p' }, async () => { ran = true; });
  assert.equal(ran, false);
  assert.equal(result.is_error, true);
  assert.match(result.output, /Claude Code is turned off in the CodingFleet app/);
  const [entry] = ca.view().log;
  assert.deepEqual([entry.status, entry.clis, entry.session, entry.cwd], ['refused', ['claude'], 'Fix login', '/p']);
});

test('a run is logged from start to end; the output is never kept', async () => {
  const { ca, logFile } = agents({ prefs: { codex: { access: 'allowed' } } });
  const result = await ca.runCommand('s1', { command: 'codex exec "secret task"' }, { cwd: '/p' },
    async () => ({ output: { stdout: 'PRIVATE OUTPUT', stderr: '', exit_code: 0 }, is_error: false }));
  assert.equal(result.output.stdout, 'PRIVATE OUTPUT');
  const failed = await ca.runCommand('s1', { command: 'codex exec "x"' }, { cwd: '/p' },
    async () => ({ output: { stdout: '', stderr: 'boom', exit_code: 3 }, is_error: false }));
  assert.equal(failed.output.exit_code, 3);
  const [last, first] = ca.view().log;
  assert.deepEqual([first.status, first.exitCode, first.background], ['done', 0, false]);
  assert.ok(first.ms >= 0);
  assert.deepEqual([last.status, last.exitCode], ['failed', 3]);
  // Untouched commands are not logged.
  await ca.runCommand('s1', { command: 'npm test' }, { cwd: '/p' }, async () => ({ output: { exit_code: 0 }, is_error: false }));
  assert.equal(ca.view().log.length, 2);
  await new Promise((r) => setTimeout(r, 400)); // the debounced save
  const saved = fs.readFileSync(logFile, 'utf8');
  assert.ok(saved.includes('secret task'));
  assert.ok(!saved.includes('PRIVATE OUTPUT'));
});

test('a background run ends in the log when its job exits', async () => {
  let exit;
  const job = { id: 'bg_1', exitCode: null, exited: new Promise((r) => { exit = r; }) };
  const { ca } = agents({ prefs: { gemini: { access: 'allowed' } }, jobs: new Map([['bg_1', job]]) });
  await ca.runCommand('s1', { command: 'gemini -p "x"', background: true }, { cwd: '/p' },
    async () => ({ output: { id: 'bg_1', status: 'running' }, is_error: false }));
  assert.equal(ca.view().log[0].status, 'running');
  job.exitCode = 0;
  exit();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([ca.view().log[0].status, ca.view().log[0].background], ['done', true]);
  // A job moved to the background by the user while the agent waited.
  let exit2;
  const job2 = { id: 'bg_2', exitCode: null, exited: new Promise((r) => { exit2 = r; }) };
  const second = agents({ prefs: { gemini: { access: 'allowed' } }, jobs: new Map([['bg_2', job2]]) }).ca;
  await second.runCommand('s1', { command: 'gemini -p "y"' }, { cwd: '/p' },
    async () => ({ output: { stdout: '', exit_code: null, background: { id: 'bg_2' } }, is_error: false }));
  exit2(); // killed: no exit code
  await new Promise((r) => setImmediate(r));
  assert.equal(second.view().log[0].status, 'stopped');
});

test('choices are checked and saved; declined runs are logged', () => {
  const { ca, state } = agents();
  assert.throws(() => ca.setPref({ id: 'nope', access: 'off' }), /No such coding agent/);
  assert.throws(() => ca.setPref({ id: 'codex', access: 'maybe' }), /off, ask or allowed/);
  ca.setPref({ id: 'codex', access: 'allowed' });
  ca.setPref({ id: 'codex', tellAgent: true });
  assert.deepEqual(state.codingAgents.codex, { access: 'allowed', tellAgent: true });
  assert.deepEqual(ca.view().prefs.claude, { access: 'ask', tellAgent: false });
  ca.declined('s1', runCall('codex exec "x"'), '/p');
  assert.equal(ca.view().log[0].status, 'declined');
  ca.clearLog();
  assert.equal(ca.view().log.length, 0);
});

test('new sessions are told about what was detected and switched on', () => {
  const { ca, state } = agents({ prefs: { codex: { access: 'ask', tellAgent: true } } });
  assert.equal(ca.instructions(), '');
  state.codingAgentsDetected = { clis: [{ id: 'codex', installed: true, version: '1.0.0', signedIn: true }] };
  assert.match(ca.instructions(), /Codex \(OpenAI\) 1\.0\.0: signed in\. The user approves each run\./);
});
