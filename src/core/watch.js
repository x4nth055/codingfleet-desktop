'use strict';

// Following a run another client started: the phone, the web chat, the app on
// another computer. Its events are read and passed on to the window, and
// nothing else: no tool call of it is run here, nothing is journaled, and no
// approval is asked. A run this app started is a Run (runner.js), never this.
//
// One watch per session. The server replays a run's events from its start
// every time they are asked for, so a watch that reconnects tells the window
// first ('watch.reconnecting') to drop what it drew.

const RETRIES = 5;

class Watches {
  // api: { runEvents(runId, signal) -> a promise of an async iterable of { event, data } }
  // emit(sessionId, runId, event, data): pass one event on to the window.
  // owned(sessionId): a run of this app is going, or being picked up again, there.
  constructor({ api, emit, owned, wait }) {
    this.api = api;
    this.emit = emit;
    this.owned = owned || (() => false);
    this.wait = wait || ((ms, signal) => new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    }));
    this.active = new Map(); // session id -> { runId, controller, done }
  }

  watching(sessionId) {
    const watch = this.active.get(sessionId);
    return watch ? watch.runId : null;
  }

  // True when the run is being followed (now, or already).
  start(sessionId, runId) {
    if (!sessionId || !runId || this.owned(sessionId)) return false;
    const current = this.active.get(sessionId);
    if (current && current.runId === runId) return true;
    if (current) this.stop(sessionId);
    const watch = { runId, controller: new AbortController(), done: null };
    this.active.set(sessionId, watch);
    watch.done = this.follow(sessionId, watch);
    return true;
  }

  stop(sessionId) {
    const watch = this.active.get(sessionId);
    if (!watch) return false;
    this.active.delete(sessionId);
    watch.controller.abort();
    return true;
  }

  stopAll() {
    for (const sessionId of [...this.active.keys()]) this.stop(sessionId);
  }

  async follow(sessionId, watch) {
    const { runId, controller } = watch;
    const mine = () => this.active.get(sessionId) === watch && !controller.signal.aborted;
    let ended = false;
    let failure = null;
    try {
      for (let attempt = 0; mine() && !ended; attempt++) {
        // A run of this app took the session over: this is no longer a watch.
        if (this.owned(sessionId)) break;
        try {
          if (attempt) this.emit(sessionId, runId, 'watch.reconnecting', {});
          // Opened first, then read: the API answers with a promise of the
          // stream (api.js openStream), which is not itself something to loop over.
          const events = await this.api.runEvents(runId, controller.signal);
          for await (const { event, data } of events) {
            if (!mine()) break;
            if (event === 'run.ended') ended = true;
            this.emit(sessionId, runId, event, data || {});
          }
          // The stream closed with no end: the run goes on, read it again.
          failure = null;
        } catch (err) {
          if (!mine()) break;
          failure = err;
          // Not this run's stream any more (it ended and another began), or not ours to read.
          if (!err || !err.transient) break;
        }
        if (ended || attempt >= RETRIES) break;
        await this.wait(Math.min(15000, 1000 * 2 ** attempt), controller.signal);
      }
    } finally {
      const current = this.active.get(sessionId) === watch;
      if (current) this.active.delete(sessionId);
      // However it ended, its connection ends with it. One left open is held
      // by the server until the run is over, and the server allows only so
      // many from one network address before it refuses every other request.
      controller.abort();
      if (current) {
        this.emit(sessionId, runId, 'watch.closed', {
          ended, error: failure && !ended ? String(failure.message || failure) : null,
        });
      }
    }
  }
}

module.exports = { Watches, RETRIES };
