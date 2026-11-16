'use strict';
// This computer, as the account's phones see it. A phone cannot reach the
// computer directly: the desktop app tells the API it is there ("host"), with
// the sessions and folders it offers and the approvals it is waiting on, and
// waits for commands on a long poll. A command starts a run, makes a session
// in a folder, or answers an approval; the app does it as if its owner had
// typed it, and reports back.
//
// No Electron in here, so it can be tested on its own: the main process gives
// it the API, the state to publish and the handlers (main/phones.js).
const crypto = require('crypto');
const path = require('path');
const { setTimeout: delay } = require('node:timers/promises');

// What the server keeps of a host's state (assistant/api/remote.py). More is cut there.
const MAX_SESSIONS = 300;
const MAX_FOLDERS = 40;
const MAX_APPROVALS = 20;
const MAX_DETAIL_CHARS = 2000;

// process.platform, in the API's words.
const PLATFORMS = { win32: 'windows', darwin: 'macos', linux: 'linux' };

const SESSION_ID = /^[A-Za-z0-9_-]{1,40}$/;

// One folder, whatever way its path is written (Windows does not tell C:\App from c:\app).
function folderKey(cwd) {
  const resolved = path.resolve(cwd);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** The id a folder is offered under: made here, and it says nothing of the path. */
function folderId(cwd) {
  return crypto.createHash('sha256').update(folderKey(cwd)).digest('hex').slice(0, 16);
}

/** A folder's own name: all a phone is shown of where it is. */
function folderName(cwd) {
  const resolved = path.resolve(cwd);
  // A whole drive has no name of its own: "C:", or "Computer" for "/".
  return path.basename(resolved) || path.parse(resolved).root.replace(/[\\/]+$/, '') || 'Computer';
}

const cut = (value, max) => String(value == null ? '' : value).slice(0, max);

/**
 * What this computer tells the API about itself, and the folder each published
 * id stands for. An absolute path never goes in `state`: a session carries its
 * folder's name, a folder its name and an id made here. `folderPaths` stays on
 * this computer.
 *
 * @param {object} o
 * @param {string} o.name This computer's name.
 * @param {string} o.platform process.platform.
 * @param {string} o.version The app's version.
 * @param {string} o.permissionMode 'auto' or 'ask'.
 * @param {object} o.sessions The app's local state: session id -> { cwd, createdAt }.
 * @param {string} [o.lastCwd] The folder picked last.
 * @param {Array} [o.approvals] { callId, sessionId, runId, tool, title, detail, always }.
 * @returns {{ state: object, folderPaths: Map<string, string> }}
 */
function buildHostState({ name, platform, version, permissionMode, sessions, lastCwd, approvals } = {}) {
  const local = Object.entries(sessions || {})
    .filter(([id, entry]) => SESSION_ID.test(id) && entry && typeof entry.cwd === 'string' && path.isAbsolute(entry.cwd))
    // Newest first: past the limits, the old ones are the ones left out.
    .sort((a, b) => (Number(b[1].createdAt) || 0) - (Number(a[1].createdAt) || 0));

  const folderPaths = new Map();
  const folders = [];
  const offer = (cwd) => {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || folders.length >= MAX_FOLDERS) return;
    const id = folderId(cwd);
    if (folderPaths.has(id)) return;
    folderPaths.set(id, cwd);
    folders.push({ id, name: cut(folderName(cwd), 80) });
  };
  offer(lastCwd);
  for (const [, entry] of local) offer(entry.cwd);

  const state = {
    name: cut(name, 60),
    platform: PLATFORMS[platform] || '',
    version: cut(version, 20),
    permission_mode: permissionMode === 'auto' ? 'auto' : 'ask',
    sessions: local.slice(0, MAX_SESSIONS).map(([id, entry]) => ({ id, folder: cut(folderName(entry.cwd), 80) })),
    folders,
    approvals: (Array.isArray(approvals) ? approvals : []).filter((a) => a && a.callId).slice(0, MAX_APPROVALS)
      .map((a) => ({
        call_id: cut(a.callId, 64),
        session_id: cut(a.sessionId, 40),
        run_id: cut(a.runId, 40),
        tool: cut(a.tool, 60),
        title: cut(a.title, 200),
        detail: cut(a.detail, MAX_DETAIL_CHARS),
        // Asked every time, whatever the session allows: a phone says so too.
        ...(a.always ? { always: true } : {}),
      })),
  };
  return { state, folderPaths };
}

/** What a command's sender is told: { ok, session_id?, run_id?, error? }, nothing else. */
function commandResult(value) {
  const out = { ok: Boolean(value && value.ok === true) };
  for (const key of ['session_id', 'run_id', 'error']) {
    if (value && typeof value[key] === 'string' && value[key]) out[key] = value[key].slice(0, 500);
  }
  if (!out.ok && !out.error) out.error = 'This computer could not do that.';
  return out;
}

// The server said no in a way that asking again will not change: the key was
// refused (401, 403), or the server has no remote control (404).
const refused = (err) => Boolean(err) && typeof err.status === 'number' && err.status > 0 && !err.transient;

class RemoteHost {
  /**
   * @param {object} o
   * @param {object} o.api publishRemoteHost, forgetRemoteHost, remoteCommands, remoteCommandResult (core/api.js).
   * @param {() => object} o.state The state to publish now (buildHostState().state).
   * @param {Object<string, (command: object) => object|Promise<object>>} o.handlers By command type; each
   *   answers { ok, session_id?, run_id?, error? }. One that throws is reported as a failure.
   * @param {(status: number, err: Error) => void} [o.onHalt] The server refused: this host stopped by itself.
   * @param {(message: string) => void} [o.warn]
   * @param {number} [o.publishEveryMs] The server forgets a host after 75 seconds of silence.
   * @param {number} [o.waitSeconds] How long one long poll waits.
   * @param {number} [o.idleMs] The least time between two polls that brought nothing.
   * @param {(ms: number, signal: AbortSignal) => Promise<void>} [o.sleep]
   */
  constructor({ api, state, handlers, onHalt, warn, publishEveryMs = 25000, waitSeconds = 25, idleMs = 1000, sleep } = {}) {
    this.api = api;
    this.state = state;
    this.handlers = handlers || {};
    this.onHalt = onHalt || (() => {});
    this.warn = warn || (() => {});
    this.publishEveryMs = publishEveryMs;
    this.waitSeconds = waitSeconds;
    this.idleMs = idleMs;
    this.sleep = sleep || ((ms, signal) => delay(ms, undefined, { signal, ref: false }));
    this.session = null;  // the loop that is running, if any
    this.leaving = null;  // a stop() still saying goodbye to the server
    this.halted = null;   // the status that stopped the last loop, if the server did
  }

  get running() { return Boolean(this.session); }

  /** Starts publishing and listening. False when it already does: there is never a second loop. */
  start() {
    if (this.session) return false;
    const session = {
      controller: new AbortController(), published: null, publishing: null, again: false, force: false,
      refreshTimer: null, ticker: null, seen: new Set(),
    };
    this.session = session;
    this.halted = null;
    session.ticker = setInterval(() => this.publish(session, true), this.publishEveryMs);
    session.ticker.unref?.();
    this.loop(session).catch((err) => this.warn(`remote control stopped: ${err && err.message}`));
    return true;
  }

  /**
   * Stops: the long poll in flight is dropped, and the server is told this
   * computer no longer listens (best effort; it would find out in 75 seconds).
   */
  stop(options) {
    const session = this.session;
    if (!session) return this.leaving || Promise.resolve(false);
    this.end(session);
    const leaving = this.leave(session, options || {}).finally(() => {
      if (this.leaving === leaving) this.leaving = null;
    });
    this.leaving = leaving;
    return leaving;
  }

  /** Publishes now if what this computer offers has changed. Many calls in a row make one request. */
  refresh() {
    const session = this.session;
    if (!session || session.refreshTimer) return;
    session.refreshTimer = setTimeout(() => {
      session.refreshTimer = null;
      this.publish(session, false);
    }, 100);
    session.refreshTimer.unref?.();
  }

  end(session) {
    if (this.session === session) this.session = null;
    clearInterval(session.ticker);
    clearTimeout(session.refreshTimer);
    session.controller.abort();
  }

  async leave(session, { forget = true, timeoutMs } = {}) {
    // A publish on its way must not land after the goodbye.
    try { await session.publishing; } catch { /* dropped with the loop */ }
    if (forget) {
      try { await this.api.forgetRemoteHost(timeoutMs); } catch { /* offline, or signed out: nothing to forget */ }
    }
    return true;
  }

  halt(session, err) {
    if (this.session !== session) return;
    this.end(session);
    this.halted = err.status;
    try { this.onHalt(err.status, err); } catch { /* the owner's own trouble */ }
  }

  // One request at a time. `force` sends the state even when it has not
  // changed: that is what keeps this computer online on the server.
  publish(session, force) {
    if (this.session !== session) return Promise.resolve();
    if (force) session.force = true;
    if (session.publishing) {
      session.again = true;
      return session.publishing;
    }
    const job = (async () => {
      do {
        session.again = false;
        const mustSend = session.force;
        session.force = false;
        let state;
        try {
          state = this.state();
        } catch (err) {
          this.warn(`remote control: could not read what to publish: ${err.message}`);
          return;
        }
        const text = JSON.stringify(state);
        if (!mustSend && text === session.published) continue;
        try {
          await this.api.publishRemoteHost(state, session.controller.signal);
          session.published = text;
        } catch (err) {
          if (this.session !== session) return;
          if (refused(err)) {
            this.halt(session, err);
            return;
          }
          // Offline or a busy server: the next tick sends it, changed or not.
          session.published = null;
        }
      } while (session.again && this.session === session);
    })().catch(() => {}).finally(() => { session.publishing = null; });
    session.publishing = job;
    return job;
  }

  async loop(session) {
    // A stop still on its way to the server goes first, or its goodbye could
    // land after this start's hello.
    try { await this.leaving; } catch { /* its own */ }
    // The server sends commands only to a host it knows.
    await this.publish(session, true);
    let failures = 0;
    while (this.session === session) {
      const asked = Date.now();
      let commands = [];
      try {
        const answer = await this.api.remoteCommands(this.waitSeconds, session.controller.signal);
        commands = (answer && Array.isArray(answer.commands)) ? answer.commands : [];
        failures = 0;
      } catch (err) {
        if (this.session !== session) return;
        if (refused(err)) {
          this.halt(session, err);
          return;
        }
        // Offline, or the server is down or busy: again, more slowly each time.
        const wait = Math.min(60000, 2000 * 2 ** Math.min(failures++, 5));
        try { await this.sleep(wait + Math.floor(Math.random() * wait * 0.2), session.controller.signal); } catch { return; }
        continue;
      }
      // Not one after the other: an approval's answer must not wait behind a run that is starting.
      for (const command of commands) this.dispatch(session, command);
      // A server that answers at once with nothing would otherwise be asked without a pause.
      if (!commands.length && Date.now() - asked < this.idleMs) {
        try { await this.sleep(this.idleMs, session.controller.signal); } catch { return; }
      }
    }
  }

  async dispatch(session, command) {
    const id = command && command.id;
    if (typeof id !== 'string' || !id || session.seen.has(id)) return;
    if (session.seen.size > 500) session.seen.clear();
    session.seen.add(id);
    let result;
    try {
      const handler = Object.hasOwn(this.handlers, command.type) ? this.handlers[command.type] : null;
      result = handler ? commandResult(await handler(command))
        : { ok: false, error: 'This version of the desktop app cannot do that. Update it on the computer.' };
    } catch (err) {
      result = commandResult({ ok: false, error: String((err && err.message) || err || '') });
    }
    await this.report(id, result);
  }

  // The sender waits for this. Told even after a stop: what was done was done.
  async report(id, result) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.api.remoteCommandResult(id, result);
        return;
      } catch (err) {
        if (!err || !err.transient) {
          this.warn(`remote control: the result of command ${id} was not taken: ${err && err.message}`);
          return;
        }
        try { await this.sleep(1000 * 2 ** attempt); } catch { return; }
      }
    }
  }
}

module.exports = {
  RemoteHost, buildHostState, commandResult, folderId, folderName, PLATFORMS,
  MAX_SESSIONS, MAX_FOLDERS, MAX_APPROVALS, MAX_DETAIL_CHARS,
};
