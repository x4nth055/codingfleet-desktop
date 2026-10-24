'use strict';
// Coding agents installed on this computer (Codex, Claude Code, Gemini CLI,
// ...): which are here, which version, whether they are signed in, and on
// which plan when the CLI says so. The user decides in Settings whether
// CodingFleet agents may start each one, and whether new sessions are told
// about it; the agent then runs it with run_command like any other command.
//
// What this module never does: read or keep another tool's credentials. The
// sign-in state comes from each CLI's own status command where it has one
// (`codex login status`, `claude auth status`, `cursor-agent status`,
// `opencode auth list`), else from its non-secret settings and from which
// environment variables are SET (never their values). One exception, for the
// plan name only: Codex keeps no plan in any status output, so the plan claim
// is decoded from the ID token in its auth.json, in this process; nothing
// else from that file is read on, kept, logged or sent anywhere.
//
// Anthropic's terms for Claude Code (code.claude.com/docs/en/legal-and-compliance,
// checked Oct 24 2026): a product may not offer Claude.ai login or route
// requests through a user's plan, and may not collect, store or intermediate
// Claude credentials; it does not prevent "an end user from signing in to the
// unmodified Claude Code binary with their own Claude subscription". Running
// the user's own, unmodified `claude` with their own sign-in is that case.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATUS_TIMEOUT_MS = 8000;
const VERSION_TIMEOUT_MS = 8000;
const MAX_OUTPUT = 64 * 1024;

// Plan names as the CLIs spell them, as a person would read them.
const PLAN_NAMES = {
  free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', max: 'Max', team: 'Team', business: 'Business',
  enterprise: 'Enterprise', edu: 'Edu', education: 'Edu',
};
const planName = (value) => {
  const key = String(value || '').trim().toLowerCase();
  if (!key || key === 'unknown') return null;
  return PLAN_NAMES[key] || key.replace(/(^|[\s_-])\w/g, (m) => m.toUpperCase()).replace(/_/g, ' ');
};

const stripAnsi = (text) => String(text || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');
const firstLine = (text) => stripAnsi(text).split('\n').map((l) => l.trim()).find(Boolean) || '';

/** The first JSON object in `text` (a CLI may print a banner first), or null. */
function jsonIn(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  try { return JSON.parse(s.slice(start, s.lastIndexOf('}') + 1)); } catch { return null; }
}

/** A version number in a CLI's --version output ("codex-cli 0.48.0", "2.1.258 (Claude Code)"). */
function parseVersion(text) {
  const m = /\bv?(\d+\.\d+(?:\.\d+)?(?:[-+.][0-9A-Za-z.-]+)?)/.exec(stripAnsi(text));
  return m ? m[1] : null;
}

// Environment variables that hold a key, reported by name only.
const setVars = (env, names) => names.filter((name) => typeof env[name] === 'string' && env[name].trim());

// ── Status parsers (pure, tested) ──────────────────────────────────────────

/** `codex login status`: "Logged in using ChatGPT" / "Logged in using an API key - sk-…" / "Not logged in". */
function parseCodexStatus({ code, text }) {
  const t = stripAnsi(text);
  if (/not logged in|logged out|no credentials/i.test(t)) return { signedIn: false };
  if (code === 0 || /logged in/i.test(t)) {
    const method = /chatgpt/i.test(t) ? 'ChatGPT account' : /api key/i.test(t) ? 'API key' : null;
    return { signedIn: true, method };
  }
  return { signedIn: code === 1 ? false : null };
}

/**
 * The plan (and e-mail) in Codex's auth.json, from the ID token's claims:
 * "https://api.openai.com/auth".chatgpt_plan_type. Only those two values
 * leave this function; the token itself is dropped here.
 */
function codexPlanFromAuth(fileText) {
  try {
    const auth = JSON.parse(fileText);
    const idToken = auth && auth.tokens && auth.tokens.id_token;
    const raw = typeof idToken === 'string' ? idToken : idToken && idToken.raw_jwt;
    if (typeof raw !== 'string' || raw.split('.').length < 2) return {};
    const claims = JSON.parse(Buffer.from(raw.split('.')[1], 'base64url').toString('utf8'));
    const openai = claims['https://api.openai.com/auth'] || {};
    return {
      plan: planName(openai.chatgpt_plan_type),
      account: typeof claims.email === 'string' ? claims.email : null,
    };
  } catch {
    return {};
  }
}

/** `claude auth status` (JSON; exit 0 signed in, 1 not). */
function parseClaudeStatus({ code, text }) {
  const data = jsonIn(text);
  if (!data) return { signedIn: code === 0 ? true : code === 1 ? false : null };
  const signedIn = data.loggedIn === true;
  const how = String(data.authMethod || '');
  const method = !signedIn ? null
    : /api|console/i.test(how) ? 'API key'
      : /oauth|claude|subscription/i.test(how) ? 'Claude account'
        : how || null;
  return {
    signedIn,
    method,
    plan: signedIn ? planName(data.subscriptionType) : null,
    account: signedIn ? (data.email || data.emailAddress || data.account || null) : null,
    org: signedIn ? (data.orgName || data.organizationName || null) : null,
  };
}

/** Gemini CLI has no status command: its settings say how it signs in. */
function geminiStatus({ settingsText, hasOauthCreds, accountsText, env }) {
  let settings = {};
  try {
    // The settings file may have // comments.
    settings = JSON.parse(String(settingsText || '{}').replace(/^\s*\/\/.*$/gm, ''));
  } catch { settings = {}; }
  const type = (settings.security && settings.security.auth && settings.security.auth.selectedType)
    || settings.selectedAuthType || null;
  const keys = setVars(env, ['GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  let account = null;
  try { account = JSON.parse(accountsText || '{}').active || null; } catch { /* none */ }
  if (/oauth|login-with-google|code-assist/i.test(type || '') || (!type && hasOauthCreds)) {
    return hasOauthCreds
      ? { signedIn: true, method: 'Google account', account }
      : { signedIn: false, note: 'Set to sign in with Google, but no saved sign-in was found.' };
  }
  if (/vertex/i.test(type || '')) {
    return { signedIn: Boolean(keys.length || env.GOOGLE_CLOUD_PROJECT), method: 'Vertex AI' };
  }
  if (keys.length) return { signedIn: true, method: `API key (${keys[0]})` };
  return { signedIn: false };
}

/** `opencode auth list`: one "●  Provider method" line per saved credential. */
function parseOpencodeAuth({ code, text }) {
  const lines = stripAnsi(text).split('\n');
  const providers = [];
  for (const line of lines) {
    const m = /^[\s│|]*[●•*]\s+(.+?)\s*$/.exec(line);
    if (m && !/credentials?$|environment/i.test(m[1])) providers.push(m[1].replace(/\s{2,}/g, ' '));
  }
  if (providers.length) {
    return { signedIn: true, method: providers.length === 1 ? providers[0] : `${providers.length} providers`, account: providers.join(', ') };
  }
  if (/\b0 credentials\b/i.test(stripAnsi(text))) return { signedIn: false };
  return { signedIn: null };
}

/** `cursor-agent status`: "Logged in as you@example.com" / "Not logged in". */
function parseCursorStatus({ text }, env) {
  const t = stripAnsi(text);
  const m = /logged in as\s+([^\s]+)/i.exec(t);
  if (m) return { signedIn: true, method: 'Cursor account', account: m[1] };
  if (setVars(env, ['CURSOR_API_KEY']).length) return { signedIn: true, method: 'API key (CURSOR_API_KEY)' };
  if (/not logged in|not authenticated|login required|unauthenticated/i.test(t)) return { signedIn: false };
  return { signedIn: null };
}

/** Copilot CLI: no status command. A token in the environment, or the login it records in its config. */
function copilotStatus({ configText, env }) {
  const vars = setVars(env, ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']);
  if (vars.length) return { signedIn: true, method: `GitHub token (${vars[0]})` };
  let config = null;
  try { config = JSON.parse(configText || 'null'); } catch { config = null; }
  const user = config && (config.last_logged_in_user || (Array.isArray(config.logged_in_users) && config.logged_in_users[0]));
  if (user) return { signedIn: true, method: 'GitHub account', account: user.login || (typeof user === 'string' ? user : null) };
  return { signedIn: null, note: 'Copilot CLI has no status command. Start it in a terminal: it asks you to /login if needed.' };
}

/** Amp: an access token in AMP_API_KEY, or a saved `amp login`. */
function ampStatus({ hasSecrets, env }) {
  if (setVars(env, ['AMP_API_KEY']).length) return { signedIn: true, method: 'Access token (AMP_API_KEY)' };
  if (hasSecrets) return { signedIn: true, method: 'Amp account' };
  return { signedIn: false };
}

const AIDER_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'XAI_API_KEY', 'MISTRAL_API_KEY'];

/** Aider signs in to nothing: it uses provider API keys from the environment or its config. */
function aiderStatus({ env, hasConfig }) {
  const keys = setVars(env, AIDER_KEYS);
  if (keys.length) return { signedIn: true, method: `API keys: ${keys.map((k) => k.replace(/_API_KEY$/, '')).join(', ')}` };
  if (hasConfig) return { signedIn: null, method: 'Keys may be in .aider.conf.yml' };
  return { signedIn: false, note: 'No provider API key found in the environment.' };
}

// ── The catalog ─────────────────────────────────────────────────────────────
// `bins`: the command names, first match wins. `headless`: how an agent runs
// it to completion without a person at the keyboard, and what to add when it
// must change files. Flags checked against each CLI's docs on Oct 24 2026.
const CATALOG = [
  {
    id: 'codex', name: 'Codex', vendor: 'OpenAI', bins: ['codex'],
    signIn: 'codex login', install: 'https://developers.openai.com/codex/cli',
    headless: 'codex exec --sandbox workspace-write "<task>"',
    tips: 'Prints progress, then the final answer last. Outside a git repository add --skip-git-repo-check. '
      + 'Continue its last session with: codex exec resume --last "<follow-up>".',
    note: 'Uses your own ChatGPT plan or OpenAI API key.',
  },
  {
    id: 'claude', name: 'Claude Code', vendor: 'Anthropic', bins: ['claude'],
    signIn: 'claude auth login', install: 'https://code.claude.com/docs/en/setup',
    headless: 'claude -p "<task>" --permission-mode acceptEdits',
    tips: 'Prints the final answer only. Continue its last conversation in this folder with: claude -c -p "<follow-up>".',
    note: 'Runs your own, unmodified Claude Code with your own sign-in. CodingFleet never reads or keeps your '
      + 'Claude credentials. Usage counts against your Claude plan, whose limits Anthropic sets for ordinary, '
      + 'individual use; for heavy automated use Anthropic points to an API key (claude auth login --console).',
  },
  {
    id: 'gemini', name: 'Gemini CLI', vendor: 'Google', bins: ['gemini'],
    signIn: 'gemini', install: 'https://geminicli.com/docs/get-started/installation',
    headless: 'gemini -p "<task>" --approval-mode auto_edit',
    tips: 'Prints the final answer. Headless runs need a saved Google sign-in or GEMINI_API_KEY.',
    note: 'Uses your own Google account or Gemini API key.',
  },
  {
    id: 'opencode', name: 'OpenCode', vendor: 'SST', bins: ['opencode'],
    signIn: 'opencode auth login', install: 'https://opencode.ai/docs',
    headless: 'opencode run "<task>"',
    tips: 'Choose a model with --model provider/model. Continue its last session with: opencode run --continue "<follow-up>".',
    note: 'Uses the providers you signed in to in OpenCode.',
  },
  {
    id: 'cursor', name: 'Cursor CLI', vendor: 'Cursor', bins: ['cursor-agent', 'agent'],
    // `agent` is too common a name to trust: only when it lives in a Cursor folder.
    binMatch: { agent: /cursor/i },
    signIn: 'cursor-agent login', install: 'https://cursor.com/cli',
    headless: 'cursor-agent -p "<task>" --output-format text',
    tips: 'Add --force when the task must change files or run commands without asking.',
    note: 'Uses your own Cursor plan.',
  },
  {
    id: 'copilot', name: 'GitHub Copilot CLI', vendor: 'GitHub', bins: ['copilot'],
    signIn: 'copilot login', install: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
    headless: 'copilot -p "<task>" -s --no-ask-user --allow-tool write',
    tips: 'Let it run a command family with --allow-tool "shell(npm:*)". -s prints the answer without session details.',
    note: 'Uses your own GitHub Copilot plan.',
  },
  {
    id: 'amp', name: 'Amp', vendor: 'Sourcegraph', bins: ['amp'],
    signIn: 'amp login', install: 'https://ampcode.com/manual',
    headless: 'amp -x "<task>"',
    tips: 'Execute mode prints the final answer and exits. It uses paid Amp credits, not the free tier.',
    note: 'Uses your own Amp account.',
  },
  {
    id: 'aider', name: 'Aider', vendor: 'Aider', bins: ['aider'],
    signIn: null, install: 'https://aider.chat/docs/install.html',
    headless: 'aider --message "<task>" --yes-always --no-auto-commits',
    tips: 'Name the files it may edit after the message (aider --message "..." src/a.py). Without '
      + '--no-auto-commits it commits every change.',
    note: 'Uses your own provider API keys.',
  },
];

const byId = new Map(CATALOG.map((cli) => [cli.id, cli]));
// Command names that start a CLI. Not the ones trusted only by their folder
// (Cursor's `agent`): in a command line there is no folder to check.
const BIN_TO_ID = new Map(CATALOG.flatMap((cli) => cli.bins
  .filter((bin) => !(cli.binMatch && cli.binMatch[bin])).map((bin) => [bin, cli.id])));

// ── Finding a command on PATH ──────────────────────────────────────────────

/** The file `bin` runs, from PATH (and PATHEXT on Windows), or null. */
function findOnPath(bin, { env = process.env, platform = process.platform, exists = fileExists } = {}) {
  const pathVar = env.PATH || env.Path || '';
  const sep = platform === 'win32' ? ';' : ':';
  const dirs = pathVar.split(sep).map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  // Windows runs only files with an extension it knows; an extensionless
  // shell script next to an .exe (VS Code's copilot shim) is for Git Bash.
  const exts = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()).filter(Boolean)
    : [''];
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = join(dir, bin + ext);
      if (exists(file)) return file;
    }
  }
  return null;
}

function fileExists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

/**
 * Run `file args` with no input and a time limit. Never throws:
 * { code, text (stdout+stderr), timedOut, error }.
 */
function runFile(file, args, { env = process.env, timeout = STATUS_TIMEOUT_MS, cwd = os.homedir() } = {}) {
  return new Promise((resolve) => {
    let child;
    const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
    try {
      // Node refuses to start a .cmd without a shell. The arguments are this
      // module's own constants, never input.
      child = batch
        ? spawn(`"${file}" ${args.join(' ')}`, { shell: true, env, cwd, windowsHide: true })
        : spawn(file, args, { env, cwd, windowsHide: true });
    } catch (err) {
      resolve({ code: null, text: '', timedOut: false, error: err.message });
      return;
    }
    let text = '';
    const add = (chunk) => { if (text.length < MAX_OUTPUT) text += chunk.toString('utf8'); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.stdin.end();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ text, timedOut: false, error: null, ...result });
    };
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
        else child.kill('SIGKILL');
      } catch { /* gone */ }
      finish({ code: null, timedOut: true });
    }, timeout);
    child.on('error', (err) => finish({ code: null, error: err.message }));
    child.on('close', (code) => finish({ code }));
  });
}

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// ── Detection ───────────────────────────────────────────────────────────────

/** Where a CLI keeps its files, honouring the overrides each one documents. */
function homes(env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return {
    home,
    codex: env.CODEX_HOME || path.join(home, '.codex'),
    gemini: path.join(env.GEMINI_CLI_HOME || home, '.gemini'),
    copilot: env.COPILOT_HOME || path.join(home, '.copilot'),
    amp: path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'amp'),
  };
}

async function statusOf(cli, file, env, run) {
  const h = homes(env);
  switch (cli.id) {
    case 'codex': {
      const status = parseCodexStatus(await run(file, ['login', 'status']));
      if (status.signedIn && status.method === 'ChatGPT account') {
        const text = readText(path.join(h.codex, 'auth.json'));
        if (text) Object.assign(status, codexPlanFromAuth(text));
      }
      return status;
    }
    case 'claude':
      return parseClaudeStatus(await run(file, ['auth', 'status']));
    case 'gemini':
      return geminiStatus({
        settingsText: readText(path.join(h.gemini, 'settings.json')),
        hasOauthCreds: fileExists(path.join(h.gemini, 'oauth_creds.json')),
        accountsText: readText(path.join(h.gemini, 'google_accounts.json')),
        env,
      });
    case 'opencode':
      return parseOpencodeAuth(await run(file, ['auth', 'list']));
    case 'cursor':
      return parseCursorStatus(await run(file, ['status']), env);
    case 'copilot':
      return copilotStatus({ configText: readText(path.join(h.copilot, 'config.json')), env });
    case 'amp':
      return ampStatus({ hasSecrets: fileExists(path.join(h.amp, 'secrets.json')), env });
    case 'aider':
      return aiderStatus({ env, hasConfig: fileExists(path.join(h.home, '.aider.conf.yml')) });
    default:
      return { signedIn: null };
  }
}

/** One CLI: { id, name, vendor, installed, path, version, signedIn, method, plan, account, note, error }. */
async function detectOne(cli, { env = process.env, platform = process.platform, run = runFile, find = findOnPath } = {}) {
  const base = { id: cli.id, name: cli.name, vendor: cli.vendor, installed: false, path: null, version: null,
    signedIn: null, method: null, plan: null, account: null, note: null, error: null };
  let file = null;
  for (const bin of cli.bins) {
    const found = find(bin, { env, platform });
    if (found && (!cli.binMatch || !cli.binMatch[bin] || cli.binMatch[bin].test(found))) { file = found; break; }
  }
  if (!file) return base;
  const versionRun = await run(file, ['--version'], { env, timeout: VERSION_TIMEOUT_MS });
  const versionText = stripAnsi(versionRun.text);
  // VS Code puts a `copilot` launcher on PATH that only says the CLI is missing.
  if (versionRun.code === 127 || /was not found|is not installed|command not found/i.test(versionText)) {
    return { ...base, path: file, note: firstLine(versionText).slice(0, 200) || 'Its command is here, but the CLI itself is not installed.' };
  }
  const result = { ...base, installed: true, path: file, version: parseVersion(versionText) };
  if (versionRun.timedOut) result.note = 'It did not answer --version in time.';
  try {
    Object.assign(result, await statusOf(cli, file, env, (f, args) => run(f, args, { env, timeout: STATUS_TIMEOUT_MS })));
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

/** Every CLI in the catalog, checked at once. */
async function detectAll(options = {}) {
  const found = await Promise.all(CATALOG.map((cli) => detectOne(cli, options).catch((err) => ({
    id: cli.id, name: cli.name, vendor: cli.vendor, installed: false, error: err.message,
  }))));
  return { checkedAt: Date.now(), clis: found };
}

/**
 * The PATH a login shell sets up (macOS and Linux). An app started from the
 * Dock or a desktop menu inherits a short PATH without ~/.local/bin, nvm or
 * Homebrew, so neither detection nor the agent's commands would find the CLIs.
 */
async function loginShellPath({ env = process.env, platform = process.platform } = {}) {
  if (platform === 'win32') return null;
  const shell = env.SHELL || '/bin/bash';
  const marker = '__CF_PATH__';
  const res = await runFile(shell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], { env, timeout: 4000 });
  const m = new RegExp(`${marker}(.*?)${marker}`).exec(res.text || '');
  return m && m[1] ? m[1] : null;
}

/** `current` with the directories of `extra` it lacks added at the end. */
function mergePath(current, extra, sep = ':') {
  const have = String(current || '').split(sep).filter(Boolean);
  const add = String(extra || '').split(sep).filter((d) => d && !have.includes(d));
  return [...have, ...add].join(sep);
}

// ── Which CLIs a command starts ─────────────────────────────────────────────

/**
 * The catalog ids of the CLIs a command line starts: a known command name at
 * the start of the line or after ; & | && || ( ` $( , past env assignments,
 * `sudo`, `npx`, `&` (PowerShell's call operator), `cmd /c` and `start`.
 * Arguments are not commands: `git log codex` starts nothing.
 */
function clisInCommand(command) {
  const ids = new Set();
  const segments = String(command || '').split(/&&|\|\||[;&|\n(`]|\$\(/);
  for (let segment of segments) {
    segment = segment.trim();
    let words = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    const strip = (w) => w.replace(/^["']|["']$/g, '');
    while (words.length) {
      const w = strip(words[0]).toLowerCase();
      if (/^[a-z_][a-z0-9_]*=/i.test(words[0]) || ['sudo', 'npx', 'bunx', 'pnpx', 'start', 'exec', 'time', 'nohup', 'call'].includes(w)) {
        words = words.slice(1);
      } else if (w === 'cmd' || w === 'cmd.exe') {
        words = words.slice(1).filter((x, i) => !(i === 0 && /^\/[ck]$/i.test(x)));
      } else if (w === 'pnpm' && strip(words[1] || '').toLowerCase() === 'dlx') {
        words = words.slice(2);
      } else break;
    }
    if (!words.length) continue;
    const base = strip(words[0]).replace(/\\/g, '/').split('/').pop().toLowerCase()
      .replace(/\.(exe|cmd|bat|ps1)$/, '').replace(/^@[^/]+\//, '');
    const id = BIN_TO_ID.get(base);
    if (id) ids.add(id);
  }
  return [...ids];
}

// ── What the agent is told ──────────────────────────────────────────────────

const ACCESS = ['off', 'ask', 'allowed'];
const DEFAULT_PREF = { access: 'ask', tellAgent: false };
const prefOf = (prefs, id) => {
  const p = (prefs && prefs[id]) || {};
  return { access: ACCESS.includes(p.access) ? p.access : DEFAULT_PREF.access, tellAgent: p.tellAgent === true };
};

/** The detected CLIs a new session is told about: installed, not off, and switched on. */
function toldClis(detected, prefs) {
  return ((detected && detected.clis) || []).filter((d) => {
    const p = prefOf(prefs, d.id);
    return d.installed && byId.has(d.id) && p.access !== 'off' && p.tellAgent;
  });
}

function signInWords(d) {
  if (d.signedIn === false) return 'not signed in yet: if it fails for that, tell the user to sign in';
  if (d.signedIn !== true) return 'sign-in not known';
  const bits = [d.method && `signed in with ${d.method}`, d.plan && `${d.plan} plan`].filter(Boolean);
  return bits.join(', ') || 'signed in';
}

/** The system-message section for the CLIs the user lets agents use; '' when none. */
function agentInstructions(detected, prefs) {
  const clis = toldClis(detected, prefs);
  if (!clis.length) return '';
  const lines = [
    'Coding agents installed on this computer that the user lets you use. Each runs with the user\'s own sign-in',
    'and plan. Use one when the user asks for it by name, or to hand it a large, well-defined coding task:',
    '- Start it with run_command and background: true (a run can take many minutes), then call read_background',
    '  until it ends. Give the whole task in ONE prompt: the goal, the files, the expected result. Quote the',
    '  prompt for the shell. Work in the session folder unless the task says otherwise.',
    '- When it ends, read its answer, check its changes (git status, git diff) and tell the user what it did.',
    '- Never add flags that skip its safety checks (--dangerously-skip-permissions, --yolo,',
    '  --dangerously-bypass-approvals-and-sandbox, --allow-all-tools) unless the user asks for that.',
  ];
  for (const d of clis) {
    const cli = byId.get(d.id);
    const access = prefOf(prefs, d.id).access === 'ask' ? ' The user approves each run.' : '';
    lines.push('', `${cli.name} (${cli.vendor})${d.version ? ` ${d.version}` : ''}: ${signInWords(d)}.${access}`,
      `  Run: ${cli.headless}`, `  ${cli.tips}`);
  }
  return lines.join('\n');
}

module.exports = {
  CATALOG, ACCESS, DEFAULT_PREF, byId, prefOf,
  parseVersion, parseCodexStatus, codexPlanFromAuth, parseClaudeStatus, geminiStatus, parseOpencodeAuth,
  parseCursorStatus, copilotStatus, ampStatus, aiderStatus, planName,
  findOnPath, runFile, detectOne, detectAll, loginShellPath, mergePath,
  clisInCommand, toldClis, agentInstructions,
};
