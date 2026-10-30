'use strict';
// The desktop's local half of a run. Writes are atomic and completed before a
// tool starts, so replay after a process crash cannot unknowingly run it twice.
//
// The versions of the files a run changes (for undo, and for the edited-files
// card after a crash) are kept beside the journal, one file per version, named
// by the hash of its text and written once, when it is first seen. The journal
// only names them, so the write that has to finish before each step of a tool
// call stays small however many files the run has touched. A version no run
// names any more is deleted.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Text shorter than this stays in the journal: a file of its own costs more.
const INLINE_CHARS = 1024;
const COPY_NAME = /^[0-9a-f]{64}$/;

class RecoveryStore {
  constructor(file) {
    this.file = file;
    this.undoFile = file.replace(/\.json$/, '-undo.json');
    this.copiesDir = file.replace(/\.json$/, '-copies');
    this.hashes = new WeakMap(); // a version ({ exists, text }) -> { hash, text } of its copy
    this.copies = new Set();     // the copies on disk, by hash
    try {
      for (const name of fs.readdirSync(this.copiesDir)) {
        const hash = name.slice(0, -'.txt'.length);
        if (name.endsWith('.txt') && COPY_NAME.test(hash)) this.copies.add(hash);
        // Half a copy, from a write a crash cut short.
        else if (name.endsWith('.tmp')) fs.rmSync(path.join(this.copiesDir, name), { force: true });
      }
    } catch { /* none yet */ }
    // A journal that is there but could not be read is not taken for an empty
    // one here: its copies stay until it is written again.
    let intact = true;
    const read = (name) => {
      try {
        return JSON.parse(fs.readFileSync(name, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') intact = false;
        return null;
      }
    };
    const journal = read(file) || {};
    const active = journal.active || {};
    let undo = journal.undo || {}; // an older journal kept both in one file
    const undoJournal = read(this.undoFile);
    if (undoJournal) undo = undoJournal.undo || {};
    for (const run of Object.values(active)) {
      for (const [name, change] of Object.entries(run.changes || {})) run.changes[name] = this.unpackChange(change);
    }
    for (const saved of Object.values(undo)) saved.files = (saved.files || []).map((entry) => this.unpackChange(entry));
    this.data = { active, undo };
    // A copy written just before a crash, that the journal never came to name.
    if (intact) this.prune();
  }

  atomicWrite(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    const handle = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(handle, data);
      fs.fsyncSync(handle);
    } finally { fs.closeSync(handle); }
    fs.renameSync(temporary, file);
  }

  copyPath(hash) { return path.join(this.copiesDir, `${hash}.txt`); }

  // The copy a version's text is in, if it has one and the text is unchanged.
  // A version read back and not read yet is its copy by definition.
  copyOf(version) {
    const known = version && this.hashes.get(version);
    if (!known || known.edited) return null;
    return known.unread || known.text === version.text ? known.hash : null;
  }

  // A version as the journal holds it: its text, or the name of the copy that
  // holds it, written first if it is not on disk yet.
  pack(version) {
    if (!version) return version;
    const rest = {};
    for (const key of Object.keys(version)) if (key !== 'text') rest[key] = version[key];
    let hash = this.copyOf(version);
    if (!hash || !this.copies.has(hash)) {
      const { text } = version;
      if (typeof text !== 'string' || text.length < INLINE_CHARS) return { ...rest, text };
      hash = crypto.createHash('sha256').update(text).digest('hex');
      this.hashes.set(version, { hash, text });
      if (!this.copies.has(hash)) {
        this.atomicWrite(this.copyPath(hash), text);
        this.copies.add(hash);
      }
    }
    return { ...rest, copy: hash };
  }

  // A version read back. Its text is read from its copy when something first
  // asks for it — undo, or a run picked up after a crash — not when the app
  // starts. A copy that is gone gives text: null, which undo reports as a file
  // it could not put back.
  unpack(version) {
    if (!version || typeof version.copy !== 'string') return version;
    const { copy, ...rest } = version;
    const out = { ...rest };
    if (!COPY_NAME.test(copy)) {
      out.text = null;
      return out;
    }
    const known = { hash: copy, unread: true, text: undefined };
    const file = this.copyPath(copy);
    Object.defineProperty(out, 'text', {
      enumerable: true,
      configurable: true,
      get() {
        if (known.unread) {
          try { known.text = fs.readFileSync(file, 'utf8'); } catch { known.text = null; }
          known.unread = false;
        }
        return known.text;
      },
      set(value) {
        known.unread = false;
        known.text = value;
        known.edited = true;
      },
    });
    this.hashes.set(out, known);
    return out;
  }

  packChange(change) {
    if (!change) return change;
    const out = { ...change, before: this.pack(change.before) };
    if (change.after !== undefined) out.after = this.pack(change.after);
    return out;
  }

  unpackChange(change) {
    if (!change) return change;
    const out = { ...change, before: this.unpack(change.before) };
    if (change.after !== undefined) out.after = this.unpack(change.after);
    return out;
  }

  saveActive() {
    const active = {};
    for (const [id, run] of Object.entries(this.data.active)) {
      const changes = {};
      for (const [name, change] of Object.entries(run.changes || {})) changes[name] = this.packChange(change);
      active[id] = { ...run, changes };
    }
    this.atomicWrite(this.file, JSON.stringify({ active }));
  }

  saveUndo() {
    const undo = {};
    for (const [id, saved] of Object.entries(this.data.undo)) {
      undo[id] = { ...saved, files: (saved.files || []).map((entry) => this.packChange(entry)) };
    }
    this.atomicWrite(this.undoFile, JSON.stringify({ undo }));
  }

  // Deletes the copies no run names any more: a version replaced by a newer
  // one, and the versions of runs that can no longer be undone.
  prune() {
    const keep = new Set();
    const note = (version) => {
      const hash = this.copyOf(version);
      if (hash) keep.add(hash);
    };
    for (const run of Object.values(this.data.active)) {
      for (const change of Object.values(run.changes || {})) { note(change && change.before); note(change && change.after); }
    }
    for (const saved of Object.values(this.data.undo)) {
      for (const entry of saved.files || []) { note(entry && entry.before); note(entry && entry.after); }
    }
    for (const hash of [...this.copies]) {
      if (keep.has(hash)) continue;
      try {
        fs.unlinkSync(this.copyPath(hash));
        this.copies.delete(hash);
      } catch (err) {
        if (err.code === 'ENOENT') this.copies.delete(hash);
      }
    }
  }

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
      delete run.calls[id].approval;
    }
    this.saveActive();
  }

  setChange(sessionId, file, change) {
    const run = this.active(sessionId);
    if (!run) throw new Error('The local run journal is missing. Refusing to modify a file.');
    run.changes[file] = change;
    this.saveActive();
    this.prune();
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
    this.prune();
  }

  removeUndo(runId) {
    delete this.data.undo[runId];
    this.saveUndo();
    this.prune();
  }
}

module.exports = { RecoveryStore, INLINE_CHARS };
