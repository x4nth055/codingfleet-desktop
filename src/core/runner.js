'use strict';
// One run of a session: reads its event stream, runs the tool calls sent to
// this computer, returns their results, and tracks the files they changed.
// Shared by the desktop app and the CLI.
const fs = require('fs');
const path = require('path');

const api = require('./api');
const { diffLines } = require('./diff');
const { CLIENT_TOOLS, executeTool, isInside, writeTarget } = require('./tools');

// Bigger files are listed as changed, without a line diff.
const MAX_TRACKED_BYTES = 2 * 1024 * 1024;

async function readForDiff(file) {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return { exists: false, text: '' };
    if (stat.size > MAX_TRACKED_BYTES) return { exists: true, text: null };
    const text = await fs.promises.readFile(file, 'utf8');
    return { exists: true, text: text.includes('\0') ? null : text };
  } catch {
    return { exists: false, text: '' };
  }
}

class Run {
  /**
   * @param {object} o
   * @param {string} o.sessionId
   * @param {string} [o.cwd] Folder the client tools work in.
   * @param {(call) => 'allow'|'deny'|Promise<'allow'|'deny'>} o.approve
   * @param {(event: string, data: object) => void} o.onEvent
   * @param {Map} [o.localTools] Declared tool name -> { server, tool }: local MCP tools.
   * @param {Map} [o.clientHandlers] Tool name -> async (args, { cwd, signal }) => { output, is_error }:
   *   tools the host app runs itself (view_image needs an image decoder).
   */
  constructor({ sessionId, cwd, approve, onEvent, localTools, clientHandlers }) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.localTools = localTools || new Map();
    this.clientHandlers = clientHandlers || new Map();
    this.approve = approve;
    this.onEvent = onEvent;
    this.runId = null;
    this.ended = null;
    this.handled = new Set();
    this.pending = new Set();
    this.changes = new Map(); // absolute path -> { before, after }
    this.controller = new AbortController();
    this.streamDone = new Promise((resolve) => { this.markStreamDone = resolve; });
  }

  emit(event, data) {
    try { this.onEvent(event, data || {}); } catch { /* a listener error must not stop the run */ }
  }

  async start(body) {
    try {
      await this.consume(await api.startRun(this.sessionId, body, this.controller.signal));
      if (!this.ended && this.runId && !this.controller.signal.aborted) {
        // The connection dropped. The run goes on on the server: attach again.
        // The buffer replays the whole run, so the listener redraws the turn.
        this.emit('client.reconnecting', {});
        await this.consume(await api.runEvents(this.runId, this.controller.signal));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.emit('client.error', { message: err.message, status: err.status || null, code: err.code || null });
      }
    }
    // The stream is over: a call still waiting for approval can no longer be
    // answered, and a command still running is of no use to anyone.
    this.markStreamDone();
    this.controller.abort();
    await Promise.allSettled([...this.pending]);
    const files = this.fileChanges();
    if (files.length) this.emit('client.files_changed', { run_id: this.runId, files });
    this.emit('client.finished', { run_id: this.runId, reason: this.ended ? this.ended.reason : null });
  }

  async consume(events) {
    for await (const { event, data } of events) {
      if (event === 'run.started') this.runId = data.run_id;
      if (event === 'run.ended') this.ended = data;
      this.emit(event, data);
      if (event === 'tool.call' && data.executor === 'client'
          && (CLIENT_TOOLS.has(data.name) || this.localTools.has(data.name) || this.clientHandlers.has(data.name))
          && !this.handled.has(data.id)) {
        this.handled.add(data.id);
        const job = this.handle(data).finally(() => this.pending.delete(job));
        this.pending.add(job);
      }
    }
  }

  async handle(call) {
    let result;
    try {
      const decision = await Promise.race([this.approve(call), this.streamDone.then(() => 'deny')]);
      if (decision === 'allow') {
        this.emit('client.tool_running', { id: call.id });
        const local = this.localTools.get(call.name);
        const own = this.clientHandlers.get(call.name);
        if (own) {
          result = await own(call.arguments || {}, { cwd: this.cwd, signal: this.controller.signal });
        } else if (local) {
          result = await local.server.call(local.tool, call.arguments, this.controller.signal);
        } else {
          const target = writeTarget(call.name, call.arguments, this.cwd);
          // The first version of a file in this run is the one the card compares against.
          if (target && !this.changes.has(target)) this.changes.set(target, { before: await readForDiff(target) });
          result = await executeTool(call.name, call.arguments, { cwd: this.cwd, signal: this.controller.signal });
          if (target) this.changes.get(target).after = await readForDiff(target);
        }
      } else {
        this.emit('client.tool_denied', { id: call.id });
        result = { output: 'The user declined this tool call.', is_error: true };
      }
    } catch (err) {
      result = { output: `The client could not run this tool: ${err.message}`, is_error: true };
    }
    try {
      await api.toolResult(this.runId, call.id, result.output, result.is_error);
    } catch (err) {
      // After a cancel or a timeout the server no longer waits for the result.
      if (err.code !== 'call_not_pending' && err.code !== 'not_running') {
        this.emit('client.error', { message: `Could not send the ${call.name} result: ${err.message}` });
      }
    }
  }

  /** The files this run changed, with line diffs against their first version. */
  fileChanges() {
    const files = [];
    for (const [abs, { before, after }] of this.changes) {
      if (!after || !before) continue;
      const shown = (this.cwd && isInside(this.cwd, abs) ? path.relative(this.cwd, abs) : abs).replace(/\\/g, '/');
      const created = !before.exists && after.exists;
      if (before.text === null || after.text === null) {
        files.push({ path: shown, created, binary: true, added: 0, removed: 0, hunks: [] });
        continue;
      }
      if (before.exists === after.exists && before.text === after.text) continue;
      const diff = diffLines(before.text, after.text);
      files.push({ path: shown, created, binary: false, added: diff.added, removed: diff.removed, hunks: diff.hunks, truncated: diff.truncated });
    }
    return files;
  }

  /**
   * The copies needed to undo this run: one entry per file it actually
   * changed, each holding the version from before and the version it left.
   * A binary or very large file has text: null, and undo reports it skipped.
   */
  restorePoints() {
    const out = [];
    for (const [abs, { before, after }] of this.changes) {
      if (!after || !before) continue;
      if (before.exists === after.exists && before.text === after.text) continue;
      out.push({ path: abs, before, after });
    }
    return out;
  }

  async cancel() {
    if (!this.runId) throw new Error('The run has not started yet. Try again in a moment.');
    return api.cancelRun(this.runId);
  }

  async steer(message, files) {
    if (!this.runId) throw new Error('The run has not started yet. Try again in a moment.');
    return api.steerRun(this.runId, message, files);
  }
}

module.exports = { Run };
