'use strict';
// The tools an Agent API run sends to the client (executor="client"), run on
// this machine. Output shapes follow the API reference: commands return
// { stdout, stderr, exit_code }; the fs_* tools return text, and a failure is
// text that starts with "error:".
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const CLIENT_TOOLS = new Set(['execute_code', 'run_command', 'fs_read', 'fs_write', 'fs_edit', 'fs_glob']);
const MAX_OUTPUT_CHARS = 200_000;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 600;
const MAX_GLOB_RESULTS = 500;
// Directories fs_glob does not walk into: huge, and never what a search means.
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv']);

// Git Bash when Git for Windows is installed: models write Unix commands far
// more reliably than PowerShell. Windows PowerShell 5.1 otherwise.
function findShell() {
  if (process.platform !== 'win32') {
    const preferred = process.env.SHELL && /\/(bash|zsh)$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/bash';
    return { name: path.basename(preferred), file: preferred, args: (c) => ['-c', c], unix: true };
  }
  const roots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
  ].filter(Boolean);
  for (const root of roots) {
    const bash = path.join(root, 'Git', 'bin', 'bash.exe');
    if (fs.existsSync(bash)) return { name: 'Git Bash', file: bash, args: (c) => ['-c', c], unix: true };
  }
  return {
    name: 'Windows PowerShell',
    file: 'powershell.exe',
    args: (c) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', c],
    unix: false,
  };
}

const SHELL = findShell();

function clip(text) {
  if (typeof text !== 'string' || text.length <= MAX_OUTPUT_CHARS) return text;
  const half = MAX_OUTPUT_CHARS / 2;
  return `${text.slice(0, half)}\n...[${text.length - MAX_OUTPUT_CHARS} characters cut]...\n${text.slice(-half)}`;
}

const resolvePath = (cwd, p) => path.resolve(cwd || process.cwd(), String(p == null || p === '' ? '.' : p));

function isInside(cwd, target) {
  const rel = path.relative(path.resolve(cwd), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

function runShell(command, { cwd, timeout, signal } = {}) {
  const seconds = Math.min(Math.max(Number(timeout) || DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(SHELL.file, SHELL.args(command), {
        cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: process.env,
      });
    } catch (err) {
      resolve({ stdout: '', stderr: `Could not start ${SHELL.name}: ${err.message}`, exit_code: null });
      return;
    }
    child.stdin.end();
    // Kept a little past the cap, so clip() can still show the tail.
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += d.toString('utf8'); });

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, seconds * 1000);
    const onAbort = () => killTree(child);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const finish = (code, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (err) stderr += `${stderr ? '\n' : ''}Could not start ${SHELL.name}: ${err.message}`;
      if (timedOut) stderr += `${stderr ? '\n' : ''}Stopped after ${seconds} seconds (timeout).`;
      resolve({ stdout: clip(stdout), stderr: clip(stderr), exit_code: timedOut || err ? null : code });
    };
    child.on('error', (err) => finish(null, err));
    child.on('close', (code) => finish(code));
    // A command that leaves a background process holding the pipes never
    // sends 'close'. Its exit is enough, after a moment for the last output.
    child.on('exit', (code) => setTimeout(() => finish(code), 200));
  });
}

async function fsRead(args, cwd) {
  const file = resolvePath(cwd, args.path);
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? 'error: file not found' : `error: ${err.message}`;
  }
  if (text.includes('\0')) return 'error: this is a binary file';
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const offset = Math.max(0, Number(args.offset) || 0);
  const limit = Number(args.limit) > 0 ? Number(args.limit) : lines.length;
  const picked = lines.slice(offset, offset + limit);
  if (args.with_line_numbers === false) return clip(picked.join(''));
  return clip(picked.map((line, i) => `${String(offset + i + 1).padStart(4)}| ${line}`).join(''));
}

async function fsWrite(args, cwd) {
  if (typeof args.content !== 'string') return 'error: content must be a string';
  const file = resolvePath(cwd, args.path);
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, args.content, 'utf8');
    return 'File created.';
  } catch (err) {
    return `error: ${err.message}`;
  }
}

const count = (text, part) => text.split(part).length - 1;

async function fsEdit(args, cwd) {
  let before = args.old;
  let after = args.new;
  if (typeof before !== 'string' || typeof after !== 'string') return 'error: old and new must be strings';
  if (!before) return 'error: old_string is empty';
  const file = resolvePath(cwd, args.path);
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? 'error: file not found' : `error: ${err.message}`;
  }
  let found = count(text, before);
  if (found === 0 && text.includes('\r\n') && before.includes('\n')) {
    // A Windows file: the model writes \n, the file has \r\n.
    before = before.replace(/\r?\n/g, '\r\n');
    after = after.replace(/\r?\n/g, '\r\n');
    found = count(text, before);
  }
  if (found === 0) return 'error: old_string not found';
  if (!args.all && found > 1) return `error: old_string appears ${found} times, must be unique (use all=true)`;
  const updated = args.all ? text.split(before).join(after) : text.replace(before, () => after);
  try {
    await fsp.writeFile(file, updated, 'utf8');
    return 'File edited.';
  } catch (err) {
    return `error: ${err.message}`;
  }
}

async function fsGlob(args, cwd) {
  let pattern = String(args.pat || '').replace(/\\/g, '/');
  if (!pattern) return 'error: pat is required';
  let base = resolvePath(cwd, args.path);
  if (path.isAbsolute(pattern)) {
    base = path.parse(pattern).root;
    pattern = pattern.slice(base.length);
  }
  const found = [];
  try {
    const exclude = (entry) => SKIP_DIRS.has(path.basename(typeof entry === 'string' ? entry : entry.name));
    for await (const entry of fsp.glob(pattern, { cwd: base, exclude })) {
      found.push(entry);
      if (found.length >= MAX_GLOB_RESULTS * 4) break;
    }
  } catch (err) {
    return `error: ${err.message}`;
  }
  const rows = await Promise.all(found.map(async (entry) => {
    const abs = path.resolve(base, entry);
    let mtime = 0;
    try {
      const stat = await fsp.stat(abs);
      mtime = stat.isFile() ? stat.mtimeMs : 0;
    } catch { /* vanished */ }
    const shown = isInside(cwd, abs) ? path.relative(cwd, abs) || '.' : abs;
    return { shown: shown.replace(/\\/g, '/'), mtime };
  }));
  if (!rows.length) return 'none';
  rows.sort((a, b) => b.mtime - a.mtime);
  const lines = rows.slice(0, MAX_GLOB_RESULTS).map((r) => r.shown);
  if (rows.length > MAX_GLOB_RESULTS) lines.push(`... ${rows.length - MAX_GLOB_RESULTS} more`);
  return lines.join('\n');
}

async function executeCode(args, cwd, signal) {
  const filename = String(args.filename || '');
  if (args.code) {
    if (!filename) return { output: { stdout: '', stderr: 'filename is required with code', exit_code: null }, is_error: true };
    const file = resolvePath(cwd, filename);
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, String(args.code), 'utf8');
    } catch (err) {
      return { output: { stdout: '', stderr: `Could not write ${filename}: ${err.message}`, exit_code: null }, is_error: true };
    }
  }
  if (!args.command) return { output: { stdout: `File saved to ${filename}.`, stderr: '', exit_code: 0 }, is_error: false };
  return { output: await runShell(String(args.command), { cwd, timeout: args.timeout, signal }), is_error: false };
}

const asText = (output) => ({ output, is_error: typeof output === 'string' && output.startsWith('error:') });

async function executeTool(name, args, { cwd, signal } = {}) {
  args = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'run_command':
      if (!args.command) return { output: { stdout: '', stderr: 'command is required', exit_code: null }, is_error: true };
      return { output: await runShell(String(args.command), { cwd, timeout: args.timeout, signal }), is_error: false };
    case 'execute_code':
      return executeCode(args, cwd, signal);
    case 'fs_read':
      return asText(await fsRead(args, cwd));
    case 'fs_write':
      return asText(await fsWrite(args, cwd));
    case 'fs_edit':
      return asText(await fsEdit(args, cwd));
    case 'fs_glob':
      return asText(await fsGlob(args, cwd));
    default:
      return { output: `error: ${name} cannot run on this computer`, is_error: true };
  }
}

// Why the user must approve this call, or null when it is safe to run: reads
// inside the project folder run freely; commands, changes and anything outside
// the folder wait for the user.
function approvalReason(name, args, cwd) {
  args = args || {};
  if (name === 'view_image') {
    return isInside(cwd, resolvePath(cwd, args.source)) ? null : 'reads outside the project folder';
  }
  // A picture of the screen can hold anything that is open on it, project or
  // not, so it always waits for the user.
  if (name === 'take_screenshot') return 'takes a picture of your screen';
  if (name === 'fs_read' || name === 'fs_glob') {
    return isInside(cwd, resolvePath(cwd, args.path)) && !path.isAbsolute(String(args.pat || ''))
      ? null
      : 'reads outside the project folder';
  }
  if (name === 'run_command' || (name === 'execute_code' && args.command)) return 'runs a command';
  return 'changes files';
}

// The file a call writes, for the edited-files card, or null. run_command can
// write files too, but what it touched cannot be known from its arguments.
function writeTarget(name, args, cwd) {
  args = args || {};
  if ((name === 'fs_write' || name === 'fs_edit') && args.path) return resolvePath(cwd, args.path);
  if (name === 'execute_code' && args.code && args.filename) return resolvePath(cwd, args.filename);
  return null;
}

module.exports = {
  CLIENT_TOOLS,
  SHELL,
  MAX_OUTPUT_CHARS,
  executeTool,
  approvalReason,
  writeTarget,
  isInside,
  resolvePath,
  runShell,
};
