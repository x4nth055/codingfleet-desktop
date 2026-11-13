'use strict';
// The terminal panel's shells: real terminals (a pty each) the user types in,
// next to the conversation. The agent never sees them. Output is sent in small
// batches, and the last part of it is kept, so a window that reloads can show
// what a terminal printed before.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_TERMINALS = 12;
const KEEP_CHARS = 200_000;   // what a terminal remembers for a reload
const FLUSH_MS = 8;           // output collected this long goes in one message

function exists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function onPath(name, env = process.env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const file = path.join(dir, name);
    if (exists(file)) return file;
  }
  return null;
}

// The shells this computer has, the default one first.
function listShells({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') {
    const shells = [];
    const add = (id, name, file) => {
      if (file && exists(file) && !shells.some((s) => s.file === file)) shells.push({ id, name, file, args: ['-l'] });
    };
    if (env.SHELL) add(path.basename(env.SHELL), path.basename(env.SHELL), env.SHELL);
    for (const name of ['zsh', 'bash', 'fish']) {
      for (const dir of ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']) add(name, name, path.join(dir, name));
    }
    if (!shells.length) shells.push({ id: 'sh', name: 'sh', file: '/bin/sh', args: [] });
    return shells;
  }
  const shells = [];
  const roots = [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)'],
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const pwsh = onPath('pwsh.exe', env)
    || roots.map((root) => path.join(root, 'PowerShell', '7', 'pwsh.exe')).find(exists);
  if (pwsh) shells.push({ id: 'pwsh', name: 'PowerShell', file: pwsh, args: ['-NoLogo'] });
  shells.push({ id: 'powershell', name: pwsh ? 'Windows PowerShell' : 'PowerShell', file: 'powershell.exe', args: ['-NoLogo'] });
  const bash = roots.map((root) => path.join(root, 'Git', 'bin', 'bash.exe')).find(exists);
  if (bash) shells.push({ id: 'gitbash', name: 'Git Bash', file: bash, args: ['--login', '-i'] });
  shells.push({ id: 'cmd', name: 'Command Prompt', file: env.ComSpec || 'cmd.exe', args: [] });
  return shells;
}

// On Windows node-pty ends a terminal by first listing the processes in its
// console, and it gets that list by forking a helper script. The installed app
// cannot run a script that way: it has no "run as Node" mode (electronFuses in
// package.json), so the fork starts a second copy of the app instead — one per
// terminal closed, and on the way out a copy that can outlive the app it came
// from. The list is not needed: closing the console ends whatever is still
// attached to it. So the helper is never started.
function withoutListHelper(pty) {
  const agent = pty && pty._agent;
  if (agent && typeof agent._getConsoleProcessList === 'function') {
    agent._getConsoleProcessList = () => Promise.resolve([]);
  }
  return pty;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(done, ms) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await sleep(20);
  return done();
}

class Terminals {
  /**
   * @param {{ spawn: Function, env?: () => object, onData: (id: number, data: string) => void,
   *           onExit: (id: number, code: number) => void, shells?: () => object[], home?: string,
   *           running?: (pid: number) => boolean, end?: (pid: number) => void }} o
   */
  constructor({ spawn, env, onData, onExit, shells, home, running, end }) {
    this.spawn = spawn;
    this.env = env || (() => process.env);
    this.onData = onData;
    this.onExit = onExit;
    this.shells = shells || (() => listShells());
    this.home = home || os.homedir();
    this.running = running || isRunning;
    this.end = end || ((pid) => process.kill(pid, 'SIGKILL'));
    this.terms = new Map();
    this.nextId = 1;
  }

  create({ cwd, shell: shellId, cols, rows } = {}) {
    if (this.terms.size >= MAX_TERMINALS) throw new Error(`At most ${MAX_TERMINALS} terminals can be open.`);
    const shells = this.shells();
    const shell = shells.find((s) => s.id === shellId) || shells[0];
    let dir = this.home;
    try { if (cwd && fs.statSync(cwd).isDirectory()) dir = cwd; } catch { /* the home folder, then */ }
    const env = { ...this.env(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'CodingFleet' };
    const pty = withoutListHelper(this.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: clampSize(cols, 80),
      rows: clampSize(rows, 24),
      cwd: dir,
      env,
      useConpty: true,
    }));
    const id = this.nextId++;
    const term = { id, pty, shell: shell.name, shellId: shell.id, cwd: dir, kept: '', pending: '', timer: null, exited: null };
    this.terms.set(id, term);
    pty.onData((data) => this.output(term, data));
    pty.onExit(({ exitCode }) => {
      this.flush(term);
      term.exited = exitCode ?? 0;
      this.terms.delete(id);
      this.onExit(id, term.exited);
    });
    return this.view(term);
  }

  output(term, data) {
    term.kept = (term.kept + data).slice(-KEEP_CHARS);
    term.pending += data;
    if (!term.timer) term.timer = setTimeout(() => this.flush(term), FLUSH_MS);
  }

  flush(term) {
    clearTimeout(term.timer);
    term.timer = null;
    if (!term.pending) return;
    const data = term.pending;
    term.pending = '';
    this.onData(term.id, data);
  }

  write(id, data) {
    const term = this.terms.get(id);
    if (term && typeof data === 'string') term.pty.write(data);
  }

  resize(id, cols, rows) {
    const term = this.terms.get(id);
    if (!term) return;
    try { term.pty.resize(clampSize(cols, 80), clampSize(rows, 24)); } catch { /* it has just exited */ }
  }

  kill(id) {
    const term = this.terms.get(id);
    if (!term) return;
    try { term.pty.kill(); } catch { /* already gone */ }
  }

  killAll() {
    for (const id of [...this.terms.keys()]) this.kill(id);
  }

  count() {
    return this.terms.size;
  }

  /**
   * Close every terminal and wait until its shell is really gone, for an app
   * that is about to quit. node-pty tells of a shell's end from a thread of its
   * own, and it cannot bear that news arriving while the app is already being
   * taken down: the whole app then dies in native code, leaving a crash dump
   * and no error. A shell that ignores the closed console is ended by force.
   * Resolves in a fraction of a second as a rule, and after `patience` twice
   * over at worst.
   */
  async shutdown({ patience = 1000, settle = 100 } = {}) {
    const pids = [...this.terms.values()].map((term) => term.pty.pid).filter((pid) => Number.isInteger(pid) && pid > 0);
    this.killAll();
    const alive = () => pids.filter((pid) => this.running(pid));
    if (!await waitUntil(() => !alive().length, patience)) {
      for (const pid of alive()) {
        try { this.end(pid); } catch { /* gone in the meantime */ }
      }
      await waitUntil(() => !alive().length, patience);
    }
    // The news of each exit is on its way to this thread: let it land.
    if (pids.length) await sleep(settle);
    this.terms.clear();
  }

  view(term) {
    return { id: term.id, shell: term.shell, shellId: term.shellId, cwd: term.cwd };
  }

  // The open terminals with what each printed lately, for a window that reloaded.
  list() {
    return [...this.terms.values()].map((term) => ({ ...this.view(term), kept: term.kept }));
  }
}

function clampSize(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 2 && n <= 1000 ? n : fallback;
}

module.exports = { Terminals, listShells, MAX_TERMINALS, KEEP_CHARS };
