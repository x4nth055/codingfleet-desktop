'use strict';
// Commands that keep running: dev servers, watchers, long builds.
//
// Like Claude Code's background shells. run_command with background: true
// starts one and answers at once with its id; read_background returns what it
// printed since the agent last looked; stop_background ends it and everything
// it started. A command the agent waits for can move here too, when the user
// clicks "Run in background" on its step (adopt). A job outlives the run that
// started it — a dev server should still be up when the next message is sent —
// and is stopped when its session is deleted or the app quits. No Electron
// here: the CLI can use it too.
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
// What the window's log view shows of a job at most.
const MAX_TAIL_CHARS = 20_000;
// stop_after: the longest a job may be asked to run before it is stopped.
const MAX_STOP_AFTER_S = 24 * 3600;

// Colours and cursor moves, as dev servers print them to a terminal.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const stripAnsi = (text) => String(text || '').replace(ANSI, '');

// The address a dev server says it is listening on, as one on this computer:
// "Local: http://localhost:5173/", "Listening on http://0.0.0.0:8000". The
// last one printed wins: a server that moves to a free port says so last.
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s'"<>\x60)\]]*)?/gi;

/** The local address in `text`, opened from this computer, or null. */
function localUrl(text) {
  const found = stripAnsi(text).match(LOCAL_URL);
  if (!found) return null;
  const url = found[found.length - 1].replace(/[.,;:]+$/, '');
  return url.replace(/\/\/(0\.0\.0\.0|\[::\])(?=[:/]|$)/i, '//localhost');
}

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

  /**
   * Start `command` in `cwd` for `sessionId`. Returns the answer run_command gives.
   * `stopAfter`: seconds after which the job is stopped (run_command's stop_after).
   */
  start(sessionId, command, cwd, { stopAfter } = {}) {
    const running = [...this.jobs.values()].filter((j) => j.sessionId === sessionId && j.status === 'running');
    if (running.length >= MAX_RUNNING_PER_SESSION) {
      return { output: `error: ${running.length} background commands are already running in this session. `
        + 'Stop one with stop_background first.', is_error: true };
    }
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
    // A character split across two chunks must not turn into two broken ones.
    // (An adopted command's streams were set up the same way by runShell.)
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const job = this.track(sessionId, command, cwd, child, '');
    const limit = Math.min(Math.floor(Number(stopAfter) || 0), MAX_STOP_AFTER_S);
    if (limit > 0) {
      job.stopAfter = limit;
      const timer = setTimeout(() => {
        if (job.status !== 'running') return;
        job.reason = `Stopped after its ${limit} s limit (stop_after).`;
        this.stop(sessionId, job.id);
      }, limit * 1000);
      timer.unref?.();
      job.exited.then(() => clearTimeout(timer));
    }
    return {
      output: { id: job.id, pid: job.pid, status: 'running', ...(limit > 0 ? { stop_after: limit } : {}),
        note: `Started in the background.${limit > 0 ? ` It stops by itself after ${limit} s.` : ''} `
          + `Read its output with read_background("${job.id}").` },
      is_error: false,
    };
  }

  /**
   * Take over a command the agent was waiting for: the user clicked "Run in
   * background" on its step. `text` is what it printed so far, which the agent
   * gets with the call's result, so it counts as read. Returns what that
   * result says about the job.
   */
  adopt(sessionId, { child, command, cwd, text }) {
    const job = this.track(sessionId, command, cwd, child, text || '');
    job.readTo = job.dropped + job.text.length;
    return {
      id: job.id, pid: job.pid, status: job.status,
      note: 'The user moved this command to the background before it finished. It keeps running. '
        + `Read its new output with read_background("${job.id}"); stop it with stop_background("${job.id}") `
        + 'when it is no longer needed.',
    };
  }

  /** Keep `child` as a job of `sessionId`. */
  track(sessionId, command, cwd, child, text) {
    const id = `bg_${crypto.randomBytes(4).toString('hex')}`;
    const job = {
      id, sessionId, command, cwd, child, pid: child.pid || null,
      status: 'running', exitCode: null, started: Date.now(), ended: null,
      text: '', dropped: 0, readTo: 0, waiters: new Set(), url: null,
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
      // The window offers to open a dev server once it says where it is.
      const url = localUrl(job.text.slice(-4000));
      if (url && url !== job.url) {
        job.url = url;
        this.changed(job);
      }
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
    if (text) append(text);
    // An adopted command can have ended a moment before it was handed over.
    if (child.exitCode !== null || child.signalCode !== null) setTimeout(() => finish(child.exitCode), 200);
    this.changed(job);
    return job;
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
      output: { id: job.id, status: job.status, exit_code: job.exitCode, output: output || '(no new output)',
        ...(job.reason ? { reason: job.reason } : {}) },
      is_error: false,
    };
  }

  /**
   * The end of what a job printed, for a person to look at. Unlike read(), it
   * leaves alone what the agent has and has not read yet.
   */
  tail(sessionId, id, chars = MAX_TAIL_CHARS) {
    const job = this.find(sessionId, id);
    if (!job) return null;
    const size = Math.min(Math.max(Number(chars) || MAX_TAIL_CHARS, 1), MAX_TAIL_CHARS);
    return {
      id: job.id, status: job.status, exitCode: job.exitCode, url: job.url,
      text: stripAnsi(job.text.slice(-size)), cut: job.dropped + Math.max(0, job.text.length - size) > 0,
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
        started: j.started, ended: j.ended, pid: j.pid, url: j.url, stopAfter: j.stopAfter || null,
        tail: stripAnsi(j.text.slice(-2000)) }));
  }

  /** Stop every job, or every job of one session. */
  stopAll(sessionId) {
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && (!sessionId || job.sessionId === sessionId)) this.kill(job.child);
    }
  }
}

module.exports = {
  BackgroundJobs, MAX_READ_CHARS, MAX_BUFFER_CHARS, MAX_RUNNING_PER_SESSION, MAX_TAIL_CHARS, localUrl, stripAnsi,
};
