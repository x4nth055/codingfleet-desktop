'use strict';
// The desktop's local half of a run. Writes are atomic and completed before a
// tool starts, so replay after a process crash cannot unknowingly run it twice.
const fs = require('fs');
const path = require('path');

class RecoveryStore {
  constructor(file) {
    this.file = file;
    this.undoFile = file.replace(/\.json$/, '-undo.json');
    let active = {};
    let undo = {};
    try { ({ active = {}, undo = {} } = JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { /* first start */ }
    try { ({ undo = {} } = JSON.parse(fs.readFileSync(this.undoFile, 'utf8'))); }
    catch { /* old combined file or first start */ }
    this.data = { active, undo };
  }

  atomicWrite(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    const handle = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(handle, JSON.stringify(data));
      fs.fsyncSync(handle);
    } finally { fs.closeSync(handle); }
    fs.renameSync(temporary, file);
  }

  saveActive() { this.atomicWrite(this.file, { active: this.data.active }); }
  saveUndo() { this.atomicWrite(this.undoFile, { undo: this.data.undo }); }

  start(sessionId, cwd) {
    this.data.active[sessionId] = { sessionId, cwd, runId: null, calls: {}, changes: {} };
    this.saveActive();
    return this.data.active[sessionId];
  }

  active(sessionId) { return this.data.active[sessionId] || null; }

  setRunId(sessionId, runId) {
    const run = this.active(sessionId);
    if (run && run.runId !== runId) { run.runId = runId; this.saveActive(); }
  }

  call(sessionId, id) { return this.active(sessionId)?.calls?.[id] || null; }

  setCall(sessionId, id, patch) {
    const run = this.active(sessionId);
    if (!run) throw new Error('The local run journal is missing. Refusing to execute a tool.');
    run.calls[id] = { ...(run.calls[id] || {}), ...patch };
    if (patch.state === 'delivered') {
      // The server accepted it; only the idempotency marker is needed now.
      delete run.calls[id].output;
      delete run.calls[id].is_error;
    }
    this.saveActive();
  }

  setChange(sessionId, file, change) {
    const run = this.active(sessionId);
    if (!run) throw new Error('The local run journal is missing. Refusing to modify a file.');
    run.changes[file] = change;
    this.saveActive();
  }

  finish(sessionId, runId, files, maxUndo = 20) {
    if (runId && files.length) {
      this.data.undo[runId] = { sessionId, at: Date.now(), files };
      const ids = Object.keys(this.data.undo).sort((a, b) => this.data.undo[a].at - this.data.undo[b].at);
      for (const id of ids.slice(0, Math.max(0, ids.length - maxUndo))) delete this.data.undo[id];
    }
    this.saveUndo();
    delete this.data.active[sessionId];
    this.saveActive();
  }

  removeUndo(runId) { delete this.data.undo[runId]; this.saveUndo(); }
}

module.exports = { RecoveryStore };
