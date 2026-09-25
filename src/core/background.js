'use strict';
// Commands that keep running: dev servers, watchers, long builds.
//
// Like Claude Code's background shells. run_command with background: true
// starts one and answers at once with its id; read_background returns what it
// printed since the agent last looked; stop_background ends it and everything
// it started. A job outlives the run that started it — a dev server should
// still be up when the next message is sent — and is stopped when its session
// is deleted or the app quits. No Electron here: the CLI can use it too.
const { spawn } = require('child_process');
const crypto = require('crypto');

// What one job keeps of its output. Past this the oldest part is dropped and
// the next read says how much.
const MAX_BUFFER_CHARS = 1_000_000;
// What one read returns at most: the newest part, with a note on the rest.
const MAX_READ_CHARS = 50_000;
const MAX_WAIT_S = 30;
// A session can hold only so many running jobs; a model that starts servers
// in a loop is stopped here instead of by the operating system.
const MAX_RUNNING_PER_SESSION = 8;

class BackgroundJobs {
  /**
   * @param {{ shell: { file: string, args: (c: string) => string[], name: string },
   *           env?: () => object, kill: (child) => void }} o
   */
  constructor({ shell, env, kill }) {
    this.shell = shell;
    this.env = env || (() => process.env);
    this.kill = kill;
    this.jobs = new Map(); // id -> job
    this.listeners = new Set();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(job) {
    for (const listener of this.listeners) {
      try { listener(job.sessionId, this.list(job.sessionId)); } catch { /* a listener must not stop a job */ }
    }
  }

  /** Start `command` in `cwd` for `sessionId`. Returns the answer run_command gives. */
  start(sessionId, command, cwd) {
    const running = [...this.jobs.values()].filter((j) => j.sessionId === sessionId && j.status === 'running');
    if (running.length >= MAX_RUNNING_PER_SESSION) {
      return { output: `error: ${running.length} background commands are already running in this session. `
        + 'Stop one with stop_background first.', is_error: true };
    }
    const id = `bg_${crypto.randomBytes(4).toString('hex')}`;
    let child;
    try {
      child = spawn(this.shell.file, this.shell.args(command), {
        cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: this.env(),
      });
    } catch (err) {
      return { output: `error: could not start ${this.shell.name}: ${err.message}`, is_error: true };
    }
    child.stdin.end();
    const job = {
      id, sessionId, command, cwd, child, pid: child.pid || null,
      status: 'running', exitCode: null, started: Date.now(), ended: null,
      text: '', dropped: 0, readTo: 0, waiters: new Set(),
    };
    job.exited = new Promise((resolve) => { job.markExited = resolve; });
    const append = (chunk) => {
      job.text += chunk.toString('utf8');
      if (job.text.length > MAX_BUFFER_CHARS) {
        const cut = job.text.length - MAX_BUFFER_CHARS;
        job.text = job.text.slice(cut);
        job.dropped += cut;
      }
      this.wake(job);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const finish = (code, err) => {
      if (job.status !== 'running') return;
      if (err) job.text += `\n[could not run: ${err.message}]\n`;
      job.status = 'exited';
      job.exitCode = err ? null : code;
      job.ended = Date.now();
      job.markExited();
      this.wake(job);
      this.changed(job);
    };
    child.on('error', (err) => finish(null, err));
    child.on('exit', (code) => setTimeout(() => finish(code), 200));
    this.jobs.set(id, job);
    this.changed(job);
    return {
      output: { id, pid: job.pid, status: 'running',
        note: `Started in the background. Read its output with read_background("${id}").` },
      is_error: false,
    };
  }

  wake(job) {
    for (const resolve of job.waiters) resolve();
    job.waiters.clear();
  }

  find(sessionId, id) {
    const job = this.jobs.get(String(id || ''));
    return job && job.sessionId === sessionId ? job : null;
  }

  /** What the job printed since the last read, waiting up to `wait` seconds for something new. */
  async read(sessionId, id, wait = 0, signal) {
    const job = this.find(sessionId, id);
    if (!job) return { output: `error: no background command with id ${id} in this session.`, is_error: true };
    const seconds = Math.min(Math.max(Number(wait) || 0, 0), MAX_WAIT_S);
    const unread = () => job.dropped + job.text.length - job.readTo;
    if (seconds && !unread() && job.status === 'running') {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, seconds * 1000);
        job.waiters.add(done);
        signal?.addEventListener('abort', done, { once: true });
      });
    }
    let output = '';
    const start = job.readTo - job.dropped;
    if (start < 0) output += `[${-start} characters were dropped before this read]\n`;
    let fresh = job.text.slice(Math.max(start, 0));
    if (fresh.length > MAX_READ_CHARS) {
      output += `[${fresh.length - MAX_READ_CHARS} earlier characters of this read skipped]\n`;
      fresh = fresh.slice(-MAX_READ_CHARS);
    }
    output += fresh;
    job.readTo = job.dropped + job.text.length;
    return {
      output: { id: job.id, status: job.status, exit_code: job.exitCode, output: output || '(no new output)' },
      is_error: false,
    };
  }

  /** Stop a job and every process it started. */
  async stop(sessionId, id) {
    const job = this.find(sessionId, id);
    if (!job) return { output: `error: no background command with id ${id} in this session.`, is_error: true };
    if (job.status === 'running') {
      this.kill(job.child);
      let timer;
      await Promise.race([job.exited, new Promise((resolve) => { timer = setTimeout(resolve, 5000); })]);
      clearTimeout(timer);
      if (job.status === 'running') {
        job.status = 'exited';
        job.ended = Date.now();
        this.changed(job);
      }
    }
    return { output: { id: job.id, status: 'stopped', exit_code: job.exitCode }, is_error: false };
  }

  /** The session's jobs, newest first, for the window. */
  list(sessionId) {
    return [...this.jobs.values()]
      .filter((j) => !sessionId || j.sessionId === sessionId)
      .sort((a, b) => b.started - a.started)
      .map((j) => ({ id: j.id, command: j.command, status: j.status, exitCode: j.exitCode,
        started: j.started, ended: j.ended, pid: j.pid,
        tail: j.text.slice(-2000) }));
  }

  /** Stop every job, or every job of one session. */
  stopAll(sessionId) {
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && (!sessionId || job.sessionId === sessionId)) this.kill(job.child);
    }
  }
}

module.exports = { BackgroundJobs, MAX_READ_CHARS, MAX_BUFFER_CHARS, MAX_RUNNING_PER_SESSION };
