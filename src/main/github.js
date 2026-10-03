'use strict';
// ---------------------------------------------------------------------------
// Pull requests, through the GitHub CLI (`gh`).
//
// Git alone can fetch a pull request's commits but cannot open one, list them,
// or post a review: that is GitHub's API. `gh` speaks it and keeps its own
// sign-in, so this app never holds a GitHub token. What lives here: finding
// `gh` (a fresh install is not on this process's PATH yet), installing it,
// signing in through the browser, and reading a repository's pull requests.
// Creating and reviewing them is the agent's job: it runs `gh` in its shell,
// which finds the same binary because the folder it is in joins PATH.
// ---------------------------------------------------------------------------
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOST = 'github.com';
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const LOGIN_TIMEOUT_MS = 16 * 60_000;    // a device code lives 15 minutes
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const EXE = process.platform === 'win32' ? 'gh.exe' : 'gh';

// No prompts, colors, spinners or "a new version is out" lines: `gh` is read
// by a program here, not a person.
const quiet = () => ({
  ...process.env,
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_SPINNER_DISABLED: '1',
  NO_COLOR: '1',
  CLICOLOR: '0',
});

function exec(file, args, { cwd, timeout = TIMEOUT_MS, env = quiet() } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      cwd, env, windowsHide: true, timeout, maxBuffer: MAX_BUFFER, encoding: 'utf8',
    }, (err, stdout, stderr) => resolve({
      ok: !err,
      out: String(stdout || ''),
      err: String(stderr || '').trim(),
      missing: Boolean(err && err.code === 'ENOENT'),
    }));
  });
}

// Where installers put `gh` when this app's PATH, taken at launch, does not
// know yet — or never will: an app opened from the macOS Finder gets a PATH
// without Homebrew in it.
function knownPlaces() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'GitHub CLI'),
      process.env.ProgramW6432 && path.join(process.env.ProgramW6432, 'GitHub CLI'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'GitHub CLI'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
      path.join(home, 'scoop', 'shims'),
    ].filter(Boolean);
  }
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/home/linuxbrew/.linuxbrew/bin',
    path.join(home, '.local', 'bin'), '/snap/bin'];
}

// A folder the agent's shell should also look in: joined to PATH once, so a
// `gh` installed a minute ago works there without restarting the app.
function joinPath(dir) {
  const parts = String(process.env.PATH || '').split(path.delimiter);
  const same = (a) => (process.platform === 'win32' ? a.toLowerCase() : a) === (process.platform === 'win32' ? dir.toLowerCase() : dir);
  if (!parts.some(same)) process.env.PATH = [dir, ...parts.filter(Boolean)].join(path.delimiter);
}

let ghPath = null;

/** The `gh` binary and its version, or null when it is not installed. */
async function locate() {
  const tries = [ghPath, 'gh', ...knownPlaces().map((dir) => path.join(dir, EXE))].filter(Boolean);
  for (const file of [...new Set(tries)]) {
    if (file !== 'gh' && !fs.existsSync(file)) continue;
    const res = await exec(file, ['--version'], { timeout: 10_000 });
    if (!res.ok) continue;
    ghPath = file;
    if (path.isAbsolute(file)) joinPath(path.dirname(file));
    const version = (res.out.match(/gh version (\S+)/) || [])[1] || '';
    return { file, version };
  }
  ghPath = null;
  return null;
}

const gh = (args, opts) => exec(ghPath || 'gh', args, opts);

// ── The repository ─────────────────────────────────────────────────────────
/** "owner/name" from a remote URL on github.com, or null. */
function parseRemote(url) {
  const text = String(url || '').trim();
  const match = text.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], name: match[2] } : null;
}

async function git(args, cwd) {
  return exec('git', ['--no-optional-locks', ...args], { cwd, env: process.env });
}

// The remote a pull request would go to: `upstream` in a fork, else `origin`,
// else whichever one is on GitHub.
async function githubRepo(root) {
  const remotes = await git(['remote', '-v'], root);
  if (!remotes.ok) return null;
  const found = new Map();
  for (const line of remotes.out.split('\n')) {
    const [name, url] = line.trim().split(/\s+/);
    const repo = parseRemote(url);
    if (name && repo && !found.has(name)) found.set(name, repo);
  }
  const pick = found.get('upstream') || found.get('origin') || [...found.values()][0];
  if (!pick) return null;
  const remote = [...found.entries()].find(([, repo]) => repo === pick)[0];
  return { ...pick, remote, slug: `${pick.owner}/${pick.name}`, url: `https://${HOST}/${pick.owner}/${pick.name}` };
}

// ── Signing in ─────────────────────────────────────────────────────────────
let userCache = { at: 0, login: null };

async function signedInUser() {
  // Both answered from this computer: no network, so a dropped connection is
  // never taken for a sign-out. The token alone is not enough: the Windows
  // keyring can keep one that gh itself no longer counts as signed in.
  const [token, account] = await Promise.all([
    gh(['auth', 'token', '--hostname', HOST], { timeout: 10_000 }),
    gh(['config', 'get', 'user', '--host', HOST], { timeout: 10_000 }),
  ]);
  const login = account.ok ? account.out.trim() : '';
  if (token.ok && login) return { signedIn: true, user: login };
  // A token in GH_TOKEN or GITHUB_TOKEN works with no account in the config.
  const fromEnv = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!token.ok || !fromEnv) {
    userCache = { at: 0, login: null };
    return { signedIn: false, user: null };
  }
  if (userCache.login && Date.now() - userCache.at < 10 * 60_000) return { signedIn: true, user: userCache.login };
  const me = await gh(['api', 'user', '--jq', '.login'], { timeout: 15_000 });
  const found = me.ok ? me.out.trim() : null;
  if (found) userCache = { at: Date.now(), login: found };
  return { signedIn: true, user: found };
}

/**
 * Where `gh` stands for the folder a session works in: installed, signed in,
 * and which GitHub repository the folder is.
 */
async function status(root) {
  const found = await locate();
  const repo = root ? await githubRepo(root) : null;
  if (!found) return { installed: false, installer: await installer(), repo };
  const auth = await signedInUser();
  return { installed: true, version: found.version, ...auth, repo };
}

/**
 * The one-time code in what `gh auth login --web` prints. The wording moves
 * between versions — "First copy your one-time code: AB12-CD34" before 2.100,
 * "One-time code (AB12-CD34) copied to clipboard" after — so only the line
 * mentioning a code and the code's own shape are relied on.
 */
function deviceCode(text) {
  const match = String(text || '').match(/code\b[^\n]*?\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/i);
  return match ? match[1].toUpperCase() : null;
}

let login = null;

/**
 * `gh auth login` in the browser. `gh` prints a one-time code and waits while
 * the user types it on github.com; `onCode` hands the code to the window.
 */
function signIn(onCode) {
  if (login) return login.promise;
  const child = spawn(ghPath || 'gh', [
    'auth', 'login', '--hostname', HOST, '--git-protocol', 'https', '--web', '--scopes', 'repo,read:org',
  ], { env: quiet(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '';
  let told = false;
  let entered = false;
  const read = (chunk) => {
    text += chunk.toString('utf8');
    const code = deviceCode(text);
    const shown = text.match(/https:\/\/github\.com\/login\/device\S*/);
    const url = (shown || [])[0] || `https://${HOST}/login/device`;
    if (!told && (code || shown)) {
      told = true;
      // No code found once the URL is out: gh changed its wording again.
      // Its own words go to the window, so the user can still read the code.
      onCode(code ? { code, url } : { code: null, url, message: text.trim().split(/\r?\n/).slice(-4).join('\n') });
    }
    // An older `gh` may still wait for Enter before it starts to poll.
    if (!entered && /press enter/i.test(text)) {
      entered = true;
      child.stdin.write('\n');
    }
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);

  const current = { child, cancelled: false };
  current.promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill(), LOGIN_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new Error('The GitHub CLI is not installed.') : err);
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (current.cancelled) return reject(new Error('Sign-in cancelled.'));
      if (code !== 0) {
        const last = text.trim().split(/\r?\n/).filter(Boolean).pop();
        return reject(new Error(last || 'GitHub sign-in did not finish.'));
      }
      // What `gh auth login` offers to do when a person runs it: let `git push`
      // over HTTPS use this sign-in, so a pull request's branch can be pushed.
      await gh(['auth', 'setup-git', '--hostname', HOST]);
      userCache = { at: 0, login: null };
      resolve(await signedInUser());
    });
  }).finally(() => { login = null; });
  login = current;
  return current.promise;
}

function cancelSignIn() {
  if (!login) return false;
  login.cancelled = true;
  login.child.kill();
  return true;
}

async function signOut() {
  const { user } = await signedInUser();
  const args = ['auth', 'logout', '--hostname', HOST];
  if (user) args.push('--user', user);
  const res = await gh(args);
  userCache = { at: 0, login: null };
  if (!res.ok) throw new Error(res.err || 'Could not sign out of GitHub.');
  return true;
}

// ── Installing ─────────────────────────────────────────────────────────────
/** How `gh` can be installed from here, or null: the window then links to cli.github.com. */
async function installer() {
  if (process.platform === 'win32') {
    const winget = await exec('winget', ['--version'], { timeout: 10_000, env: process.env });
    return winget.ok ? 'winget' : null;
  }
  if (process.platform === 'darwin') {
    for (const brew of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
      if (fs.existsSync(brew)) return 'brew';
    }
  }
  return null;
}

let installing = null;

/** Installs `gh` with the system's package manager; `onLine` gets its output. */
function install(onLine) {
  if (installing) return installing;
  installing = (async () => {
    const how = await installer();
    let file;
    let args;
    if (how === 'winget') {
      file = 'winget';
      args = ['install', '--id', 'GitHub.cli', '--exact', '--source', 'winget',
        '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'];
    } else if (how === 'brew') {
      file = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((b) => fs.existsSync(b));
      args = ['install', 'gh'];
    } else {
      throw Object.assign(new Error('Install the GitHub CLI from cli.github.com, then come back.'), { code: 'manual' });
    }
    await new Promise((resolve) => {
      const child = spawn(file, args, { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' }, windowsHide: true });
      const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
      const read = (chunk) => {
        // winget redraws a progress bar with \r and box characters: only words go on.
        for (const line of chunk.toString('utf8').split(/[\r\n]+/)) {
          const clean = line.replace(/[^\x20-\x7E]/g, '').trim();
          if (clean.length > 2 && /[a-z]{3}/i.test(clean)) onLine(clean.slice(0, 160));
        }
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('error', () => { clearTimeout(timer); resolve(); });
      child.on('close', () => { clearTimeout(timer); resolve(); });
    });
    // Whatever the installer's exit code says ("already installed" is an
    // error to winget), `gh` answering is what counts.
    const found = await locate();
    if (!found) throw new Error('The GitHub CLI did not install. Try again, or install it from cli.github.com.');
    return { version: found.version };
  })().finally(() => { installing = null; });
  return installing;
}

// ── Pull requests ──────────────────────────────────────────────────────────
const PR_FIELDS = 'number,title,author,headRefName,baseRefName,isDraft,reviewDecision,reviewRequests,url,updatedAt,additions,deletions';

function slimPr(pr, me) {
  const requests = (pr.reviewRequests || []).map((r) => r.login || r.name || r.slug).filter(Boolean);
  return {
    number: pr.number,
    title: pr.title,
    author: pr.author && pr.author.login,
    head: pr.headRefName,
    base: pr.baseRefName,
    draft: Boolean(pr.isDraft),
    decision: pr.reviewDecision || '',
    url: pr.url,
    updatedAt: pr.updatedAt,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    state: pr.state || 'OPEN',
    mine: Boolean(me && pr.author && pr.author.login === me),
    askedOfMe: Boolean(me && requests.includes(me)),
  };
}

const defaultBranches = new Map(); // slug -> branch

/**
 * The open pull requests of the folder's repository, the one for the branch
 * checked out (if any), and what a new one would compare.
 */
async function pulls(root) {
  if (!(await locate())) throw new Error('The GitHub CLI is not installed.');
  const repo = await githubRepo(root);
  if (!repo) throw new Error('This folder has no GitHub remote.');
  const { user } = await signedInUser();
  const target = ['--repo', repo.slug];

  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const branch = head.ok && head.out.trim() !== 'HEAD' ? head.out.trim() : '';
  const known = defaultBranches.get(repo.slug);
  const [list, current, view] = await Promise.all([
    gh(['pr', 'list', ...target, '--state', 'open', '--limit', '40', '--json', PR_FIELDS], { cwd: root }),
    // The pull request of the branch checked out here, open or not.
    branch ? gh(['pr', 'view', branch, ...target, '--json', `${PR_FIELDS},state`], { cwd: root }) : { ok: false },
    known ? null : gh(['repo', 'view', repo.slug, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']),
  ]);
  if (!list.ok) throw new Error(list.err.split('\n').pop() || 'Could not list pull requests.');
  const base = known || (view && view.ok ? view.out.trim() : '');
  if (base) defaultBranches.set(repo.slug, base);

  let ahead = null;
  if (branch && base) {
    const count = await git(['rev-list', '--count', `${repo.remote}/${base}..HEAD`], root);
    if (count.ok) ahead = Number(count.out.trim()) || 0;
  }

  let parsed = [];
  try { parsed = JSON.parse(list.out || '[]'); } catch { /* an empty list */ }
  let branchPr = null;
  if (current.ok) {
    try { branchPr = slimPr(JSON.parse(current.out), user); } catch { /* none */ }
  }
  const prs = parsed.map((pr) => slimPr(pr, user));
  // Waiting on me first, then the newest.
  prs.sort((a, b) => (b.askedOfMe - a.askedOfMe) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { repo, user, branch, base, ahead, current: branchPr, prs };
}

module.exports = {
  status, pulls, install, signIn, cancelSignIn, signOut, locate, parseRemote, deviceCode,
};
