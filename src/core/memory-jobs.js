'use strict';
// Project memory work that covers every project at once: moving the notes when
// the user changes where they are kept, making each project's folder and
// index, and counting the entries. With hundreds of projects that is thousands
// of file operations. They run on a thread of their own (memory-worker.js), so
// the window and the sessions that are running never wait for them.
//
// No Electron in this file: the CLI can use it as it is.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const memory = require('./project-memory');

const WORKER_FILE = path.join(__dirname, 'memory-worker.js');
// The thread ends when it had no work for this long, and starts again on demand.
const IDLE_MS = 10_000;

const dirOf = (cwd, settings, appDir) => memory.memoryDir(cwd, { ...settings, appDir });

// The folders that are still there, each one once.
function existing(cwds) {
  const seen = new Map();
  for (const cwd of Array.isArray(cwds) ? cwds : []) {
    if (typeof cwd !== 'string' || !cwd) continue;
    const key = memory.FOLDS_CASE ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
    if (seen.has(key)) continue;
    try { if (fs.statSync(cwd).isDirectory()) seen.set(key, cwd); } catch { /* the folder is gone */ }
  }
  return [...seen.values()];
}

/**
 * One project's memory folder and index, made if they are not there. Notes
 * still at a place they were kept in before (`settings.left`) come along, and
 * an in-project folder is kept out of git. Returns { dir, index }.
 */
function prepareProject(cwd, settings, appDir) {
  const dir = dirOf(cwd, settings, appDir);
  for (const place of settings.left || []) {
    const old = dirOf(cwd, { location: place.location, customDir: place.customDir || '' }, appDir);
    if (old !== dir && memory.entryFiles(old).length) memory.moveMemory(old, dir);
  }
  const index = memory.ensure(dir);
  if (settings.location === 'project') memory.excludeFromGit(cwd);
  return { dir, index };
}

// Each of these takes plain data and returns plain data: a job crosses to the
// thread and its result comes back as messages.
function moveAll({ cwds, before, next, appDir }) {
  let moved = 0;
  const errors = [];
  for (const cwd of existing(cwds)) {
    try {
      moved += memory.moveMemory(dirOf(cwd, before, appDir), dirOf(cwd, next, appDir));
    } catch (err) {
      errors.push({ cwd, message: `could not move the memory: ${err.message}` });
    }
  }
  return { moved, failed: errors.length, errors };
}

function prepareAll({ cwds, settings, appDir }) {
  const errors = [];
  if (!settings.enabled) return { errors };
  for (const cwd of existing(cwds)) {
    try {
      prepareProject(cwd, settings, appDir);
    } catch (err) {
      errors.push({ cwd, message: `could not prepare the memory: ${err.message}` });
    }
  }
  return { errors };
}

// What Preferences shows: how many entries each project has, and the entries
// of the project the window is in (`current`, a folder or nothing).
function viewAll({ cwds, settings, appDir, current }) {
  if (!settings.enabled) return { current: null, projects: [] };
  const describe = (cwd) => {
    const dir = dirOf(cwd, settings, appDir);
    return { cwd, dir, entries: memory.listEntries(dir) };
  };
  return {
    current: typeof current === 'string' && current ? describe(current) : null,
    projects: existing(cwds).map(describe).map((project) => ({ ...project, entries: project.entries.length })),
  };
}

// The settings changed: the notes move when the place did, every project has
// its folder at the new place, and the answer is what Preferences shows next.
function applySettings({ cwds, before, next, appDir, move, current }) {
  const moved = move ? moveAll({ cwds, before, next, appDir }) : { moved: 0, failed: 0, errors: [] };
  const prepared = prepareAll({ cwds, settings: next, appDir });
  return {
    moved: moved.moved,
    failed: moved.failed,
    errors: [...moved.errors, ...prepared.errors],
    ...viewAll({ cwds, settings: next, appDir, current }),
  };
}

const JOBS = { move: moveAll, prepare: prepareAll, view: viewAll, set: applySettings };

function runJob(job) {
  const run = job && JOBS[job.type];
  if (!run) throw new Error(`Unknown project memory job: ${job && job.type}`);
  return run(job);
}

/**
 * Runs jobs on the thread, one after the other in the order they were given.
 * `run(job)` answers with the job's result. When the thread cannot start or
 * stops, the jobs that wait run here instead: slower for the caller's thread,
 * but nothing is lost.
 */
class MemoryJobs {
  constructor({ warn = () => {}, workerFile = WORKER_FILE, threaded = true } = {}) {
    this.warn = warn;
    this.workerFile = workerFile;
    this.threaded = threaded;
    this.worker = null;
    this.pending = new Map(); // id -> { job, resolve, reject }
    this.seq = 0;
    this.idle = null;
  }

  run(job) {
    return new Promise((resolve, reject) => {
      const entry = { job, resolve, reject };
      const worker = this.threaded ? this.start() : null;
      if (!worker) {
        this.here(entry);
        return;
      }
      clearTimeout(this.idle);
      this.seq += 1;
      this.pending.set(this.seq, entry);
      worker.postMessage({ id: this.seq, job });
    });
  }

  // Without the thread: after the caller's own turn, so the order is kept.
  here({ job, resolve, reject }) {
    setImmediate(() => {
      try { resolve(runJob(job)); } catch (err) { reject(err); }
    });
  }

  start() {
    if (this.worker) return this.worker;
    let worker;
    try {
      worker = new Worker(this.workerFile);
    } catch (err) {
      this.giveUp(`the thread did not start (${err.message})`);
      return null;
    }
    worker.unref(); // it never keeps the app open by itself
    worker.on('message', ({ id, result, error }) => {
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
      if (!this.pending.size) {
        clearTimeout(this.idle);
        this.idle = setTimeout(() => this.close(), IDLE_MS);
        if (this.idle.unref) this.idle.unref();
      }
    });
    worker.on('error', (err) => {
      if (this.worker === worker) this.giveUp(`the thread failed (${err.message})`);
    });
    worker.on('exit', () => {
      if (this.worker !== worker) return;
      this.worker = null;
      if (this.pending.size) this.giveUp('the thread stopped');
    });
    this.worker = worker;
    return worker;
  }

  // The thread is not usable: from now on the jobs run on the caller's thread.
  giveUp(reason) {
    this.threaded = false;
    this.warn(`${reason}: the work runs in the app itself`);
    const worker = this.worker;
    this.worker = null;
    if (worker) worker.terminate().catch(() => {});
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) this.here(entry);
  }

  close() {
    clearTimeout(this.idle);
    if (this.pending.size) return;
    const worker = this.worker;
    this.worker = null;
    if (worker) worker.terminate().catch(() => {});
  }
}

module.exports = { MemoryJobs, runJob, prepareProject, existing };
