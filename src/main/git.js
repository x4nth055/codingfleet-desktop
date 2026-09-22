'use strict';
// ---------------------------------------------------------------------------
// Git in the folder a session works in.
//
// The window shows what is uncommitted above the prompt — "+531 −12" — and the
// diff of any file behind it. All of it runs here in the main process: the
// window has no filesystem and no way to start a program, and a path it sends
// back is only ever read if the repository this process found contains it.
// ---------------------------------------------------------------------------
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const { addedFile, countLines, parseUnifiedDiff } = require('../core/git-diff');
const tools = require('../core/tools');

const TIMEOUT_MS = 20_000;
const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_FILES = 300;             // rows handed to the window
const MAX_UNTRACKED_FILES = 200;   // read to say what a new folder adds
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;
const MAX_WALK_DEPTH = 6;
// Folders a walk does not descend into: a new project directory holding its
// dependencies must not turn the count above the prompt into a minute of work.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'bower_components', 'vendor', '__pycache__', '.venv', 'venv',
  'dist', 'build', 'target', '.next', '.nuxt', '.cache', 'coverage',
]);

// `git --no-optional-locks`: never let one of our reads rewrite the index. It
// would be rude in a repository someone else is working in — and the write
// would wake the file watcher that asked for this, starting it all again.
function git(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', ['--no-optional-locks', ...args], {
      cwd, windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8',
    }, (err, stdout) => resolve({ ok: !err, out: String(stdout || ''), err: err || null }));
  });
}

/** The repository a folder is in, or null. Git walks up from anywhere inside it. */
async function repoAt(dir) {
  if (!dir) return null;
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  const { ok, out } = await git(['rev-parse', '--show-toplevel'], dir);
  const root = ok ? out.trim() : '';
  return root ? path.normalize(root) : null;
}

/** `git status --porcelain=v1 -z`: the branch first, then one record per file. */
function parseStatus(out) {
  const records = out.split('\0');
  const files = [];
  let branch = '';
  let detached = false;
  let noCommits = false;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith('## ')) {
      const head = record.slice(3);
      if (head.startsWith('No commits yet on ')) {
        branch = head.slice('No commits yet on '.length).trim();
        noCommits = true;
      } else if (head.startsWith('HEAD (no branch)')) {
        detached = true;
      } else {
        branch = head.split('...')[0].split(' ')[0].trim();
      }
      continue;
    }
    if (record.length < 3) continue;
    const index = record[0];
    const worktree = record[1];
    if (index === '!') continue; // ignored: not something the user changed
    // In -z mode a rename or copy carries the original path as the next record.
    if (index === 'R' || index === 'C') i++;
    files.push({ path: record.slice(3), index, worktree });
  }
  return { files, branch, detached, noCommits };
}

/** `git diff --numstat -z` output, added to what is already known per path. */
function addNumstat(counts, out) {
  for (const record of String(out || '').split('\0')) {
    if (!record) continue;
    const parts = record.split('\t');
    if (parts.length < 3) continue;
    const [added, removed] = parts;
    const file = parts.slice(2).join('\t');
    const found = counts.get(file) || { added: 0, removed: 0, binary: false };
    if (added === '-' || removed === '-') found.binary = true;
    else {
      found.added += Number(added) || 0;
      found.removed += Number(removed) || 0;
    }
    counts.set(file, found);
  }
  return counts;
}

const STATUS_NAMES = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'modified', U: 'conflict',
};

function statusOf(entry) {
  if (entry.index === '?' || entry.worktree === '?') return 'untracked';
  if (entry.index === 'U' || entry.worktree === 'U' || (entry.index === 'A' && entry.worktree === 'A')) return 'conflict';
  return STATUS_NAMES[entry.index === ' ' ? entry.worktree : entry.index] || 'modified';
}

// What a file not in git adds: its line count, and whether it is text at all.
function readText(abs) {
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { added: 0, binary: false };
  }
  if (!stat.isFile()) return { added: 0, binary: false };
  if (stat.size > MAX_UNTRACKED_BYTES) return { added: 0, binary: true };
  let bytes;
  try {
    bytes = fs.readFileSync(abs);
  } catch {
    return { added: 0, binary: false };
  }
  if (bytes.subarray(0, 8000).includes(0)) return { added: 0, binary: true };
  return { added: countLines(bytes.toString('utf8')), binary: false };
}

// A new folder that git collapsed into one record ("?? out/"): every file in it
// is an addition. Bounded, and it says so when the bound is reached.
function walkUntracked(root, rel, budget) {
  const rows = [];
  const queue = [[path.join(root, rel), rel, 0]];
  while (queue.length && rows.length < budget) {
    const [abs, shown, depth] = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (rows.length >= budget) break;
      const child = `${shown}/${entry.name}`;
      if (entry.isDirectory()) {
        if (depth < MAX_WALK_DEPTH && !SKIP_DIRS.has(entry.name)) {
          queue.push([path.join(abs, entry.name), child, depth + 1]);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      rows.push({ path: child, ...readText(path.join(abs, entry.name)) });
    }
  }
  return rows;
}

/**
 * What is uncommitted in `dir`: the repository, the branch, and one row per
 * changed file with its added and removed line counts.
 */
async function summary(dir) {
  const root = await repoAt(dir);
  if (!root) return { repo: null };
  const [status, worktree, index] = await Promise.all([
    git(['status', '--porcelain=v1', '-z', '--branch'], root),
    git(['diff', '--numstat', '-z', '--no-renames'], root),
    git(['diff', '--numstat', '-z', '--no-renames', '--cached'], root),
  ]);
  const repo = {
    root,
    name: path.basename(root) || root,
    branch: '',
    detached: false,
    noCommits: false,
  };
  if (!status.ok) return { repo, files: [], added: 0, removed: 0, count: 0, truncated: false };

  const parsed = parseStatus(status.out);
  repo.branch = parsed.branch;
  repo.detached = parsed.detached;
  repo.noCommits = parsed.noCommits;
  if (parsed.detached) {
    const head = await git(['rev-parse', '--short', 'HEAD'], root);
    repo.commit = head.ok ? head.out.trim() : '';
  }

  const counts = new Map();
  addNumstat(counts, worktree.out);
  addNumstat(counts, index.out);

  const files = [];
  let budget = MAX_UNTRACKED_FILES;
  let truncated = parsed.files.length > MAX_FILES;
  for (const entry of parsed.files) {
    const status2 = statusOf(entry);
    if (status2 === 'untracked') {
      // git marks an untracked folder with a trailing slash: it is a prefix,
      // not part of the name.
      const rel = entry.path.replace(/\/$/, '');
      const abs = path.join(root, rel);
      let stat;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const room = budget;
        const walked = room > 0 ? walkUntracked(root, rel, room) : [];
        budget = Math.max(0, budget - walked.length);
        // A walk that filled its whole budget was probably cut short.
        if (walked.length >= room) truncated = true;
        if (!walked.length) {
          files.push({ path: rel, added: 0, removed: 0, status: 'untracked', binary: false, partial: true });
          continue;
        }
        for (const row of walked) files.push({ ...row, removed: 0, status: 'untracked', partial: false });
      } else {
        const read = readText(abs);
        files.push({ path: rel, ...read, removed: 0, status: 'untracked', partial: false });
      }
      continue;
    }
    const found = counts.get(entry.path) || { added: 0, removed: 0, binary: false };
    files.push({
      path: entry.path,
      added: found.added,
      removed: found.removed,
      binary: found.binary,
      status: status2,
      staged: entry.index !== ' ' && entry.index !== '?',
      partial: false,
    });
  }

  if (files.length > MAX_FILES) {
    files.length = MAX_FILES;
    truncated = true;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const added = files.reduce((sum, f) => sum + f.added, 0);
  const removed = files.reduce((sum, f) => sum + f.removed, 0);
  return { repo, files, added, removed, count: files.length, truncated };
}

/**
 * One file's diff, as the window draws it. The path is resolved inside the
 * repository that was found, never wherever it points on its own.
 */
async function diffFor(dir, rel) {
  const root = await repoAt(dir);
  if (!root) throw new Error('This folder is not a git repository.');
  const shown = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!shown) throw new Error('No file was given.');
  const abs = path.resolve(root, shown);
  if (!tools.isInside(root, abs)) throw new Error('That file is outside the repository.');

  const status = await git(['status', '--porcelain=v1', '-z', '--', shown], root);
  if (status.out.startsWith('??')) {
    const read = readText(abs);
    if (read.binary) return { path: shown, added: 0, removed: 0, hunks: [], truncated: false, binary: true, untracked: true };
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      throw new Error(`${shown} could not be read.`);
    }
    return { path: shown, ...addedFile(text), untracked: true };
  }

  const args = ['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U3'];
  let out = await git([...args, 'HEAD', '--', shown], root);
  if (!out.ok) {
    // A repository without a commit yet has no HEAD to compare against.
    const [staged, pending] = await Promise.all([
      git([...args, '--cached', '--', shown], root),
      git([...args, '--', shown], root),
    ]);
    out = { ok: staged.ok || pending.ok, out: staged.out + pending.out };
  }
  if (!out.ok) return { path: shown, added: 0, removed: 0, hunks: [], truncated: false, binary: true };
  return { path: shown, ...parseUnifiedDiff(out.out) };
}

// ---------------------------------------------------------------------------
// Watching. One repository at a time — the one the window is showing — so the
// count above the prompt keeps up with whatever writes there next: the agent,
// an editor, or a terminal, without a timer running for every session.
// ---------------------------------------------------------------------------
let watched = null;
let watchToken = 0;

// Churn that says nothing about what is uncommitted: git's object database and
// the logs it appends to while it works.
const NOISE = /[\\/]\.git[\\/](objects|logs|hooks|lfs)[\\/]/;

function stopWatch() {
  watchToken++;
  if (!watched) return;
  if (watched.watcher) watched.watcher.close();
  if (watched.interval) clearInterval(watched.interval);
  if (watched.timer) clearTimeout(watched.timer);
  watched = null;
}

/**
 * Follow a folder: call `onChange` when something in its repository moves.
 * @returns {Promise<string|null>} the repository root being watched, if any
 */
async function watch(dir, onChange) {
  const token = ++watchToken;
  if (watched) {
    if (watched.watcher) watched.watcher.close();
    if (watched.interval) clearInterval(watched.interval);
    if (watched.timer) clearTimeout(watched.timer);
    watched = null;
  }
  if (!dir) return null;
  const root = await repoAt(dir);
  if (!root || token !== watchToken) return null;

  const state = { root, onChange, watcher: null, interval: null, timer: null, signature: null };
  watched = state;
  const fire = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      if (watched === state) state.onChange();
    }, 400);
  };

  try {
    state.watcher = fs.watch(root, { recursive: true }, (_event, name) => {
      if (typeof name === 'string' && NOISE.test(name)) return;
      fire();
    });
    state.watcher.on('error', () => { /* the folder went away; the next status notices */ });
  } catch {
    // No recursive watching here (Linux): ask git itself, slowly, whether
    // anything it cares about moved.
    state.interval = setInterval(async () => {
      if (watched !== state) return;
      const { ok, out } = await git(['status', '--porcelain=v1', '-z'], root);
      if (!ok) return;
      if (state.signature != null && out !== state.signature) fire();
      state.signature = out;
    }, 5000);
  }
  return root;
}

module.exports = { summary, diffFor, repoAt, watch, stopWatch };
