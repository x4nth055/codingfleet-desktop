'use strict';
// "Coding agents on this computer" in the main process: what was found
// (core/coding-clis.js), the user's choice for each one, what new sessions are
// told, the approval for a command that starts one, and the activity log.
//
// Choices, per CLI (state.codingAgents[id]):
//   access    'off'     a command that starts it is refused, with the reason
//             'ask'     the user approves every run; "allow all" does not cover it
//             'allowed' it runs without asking (destructive commands still ask)
//   tellAgent new folder sessions get instructions for it in their system message
//
// The log keeps what ran, where, for how long and how it ended: never the
// output, which can hold anything the CLI printed.

const fs = require('fs');
const path = require('path');
const clis = require('../core/coding-clis');

const MAX_LOG = 200;
const COMMAND_CHARS = 300;
// After the window opens, so detection never competes with the first paint.
const FIRST_DETECT_DELAY_MS = 2500;

function createCodingAgents({ getState, saveState, send, logFile, log, backgroundJobs, sessionLabel }) {
  let detected = null;
  let detecting = null;
  let entries = loadLog();
  let saveTimer = null;

  function loadLog() {
    try {
      const list = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      return Array.isArray(list) ? list.slice(-MAX_LOG) : [];
    } catch {
      return [];
    }
  }

  function saveLog() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        const temporary = `${logFile}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(entries.slice(-MAX_LOG), null, 1));
        fs.renameSync(temporary, logFile);
      } catch (err) {
        log.warn(`could not save the coding agents log: ${err.message}`);
      }
    }, 300);
  }

  const prefs = () => getState().codingAgents || {};
  const detection = () => detected || getState().codingAgentsDetected || null;

  function view() {
    const p = prefs();
    return {
      catalog: clis.CATALOG.map(({ id, name, vendor, bins, signIn, install, note, headless }) =>
        ({ id, name, vendor, bin: bins[0], signIn, install, note, headless })),
      detected: detection(),
      detecting: Boolean(detecting),
      prefs: Object.fromEntries(clis.CATALOG.map(({ id }) => [id, clis.prefOf(p, id)])),
      log: entries.slice().reverse(),
    };
  }

  const changed = () => send('codingAgents:changed', view());

  function detect() {
    if (!detecting) {
      detecting = (async () => {
        try {
          detected = await clis.detectAll({ env: process.env });
          getState().codingAgentsDetected = detected;
          saveState();
          const found = detected.clis.filter((d) => d.installed).map((d) => `${d.id} ${d.version || '?'}`);
          log.info(`coding agents found: ${found.join(', ') || 'none'}`);
        } catch (err) {
          log.warn(`coding agent detection failed: ${err.message}`);
        } finally {
          detecting = null;
          changed();
        }
        return detected;
      })();
      changed();
    }
    return detecting;
  }

  /**
   * At start: the login shell's PATH first (macOS, Linux), so detection and the
   * agent's commands find what a terminal would; then one detection.
   */
  async function start() {
    try {
      const extra = await clis.loginShellPath();
      if (extra) process.env.PATH = clis.mergePath(process.env.PATH, extra);
    } catch { /* the PATH the app has */ }
    setTimeout(() => detect(), FIRST_DETECT_DELAY_MS).unref?.();
  }

  function setPref({ id, access, tellAgent } = {}) {
    if (!clis.byId.has(id)) throw new Error('No such coding agent.');
    const state = getState();
    const all = { ...(state.codingAgents || {}) };
    const now = clis.prefOf(all, id);
    if (access !== undefined) {
      if (!clis.ACCESS.includes(access)) throw new Error('Choose off, ask or allowed.');
      now.access = access;
    }
    if (tellAgent !== undefined) now.tellAgent = tellAgent === true;
    all[id] = now;
    state.codingAgents = all;
    saveState();
    changed();
    return view();
  }

  /** The system-message section for new folder sessions ('' when nothing is switched on). */
  const instructions = () => clis.agentInstructions(detection(), prefs());

  const nameOf = (id) => (clis.byId.get(id) || {}).name || id;
  const names = (ids) => ids.map(nameOf).join(' and ');

  /**
   * What a run_command call means for the coding agents it starts, or null
   * when it starts none: { ids, refuse } / { ids, allow } / { ids, reason }.
   */
  function approval(call) {
    if (!call || call.name !== 'run_command') return null;
    const ids = clis.clisInCommand((call.arguments || {}).command);
    if (!ids.length) return null;
    const access = ids.map((id) => clis.prefOf(prefs(), id).access);
    const off = ids.filter((id, i) => access[i] === 'off');
    if (off.length) return { ids, refuse: off };
    if (access.includes('ask')) return { ids, reason: `starts ${names(ids)} on this computer` };
    return { ids, allow: true };
  }

  function add(entry) {
    entries.push(entry);
    if (entries.length > MAX_LOG) entries = entries.slice(-MAX_LOG);
    saveLog();
    changed();
    return entry;
  }

  function begin(sessionId, ids, args, cwd, status) {
    return add({
      id: `ca_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      clis: ids,
      sessionId,
      session: sessionLabel(sessionId),
      cwd: cwd || null,
      command: String(args.command || '').slice(0, COMMAND_CHARS),
      background: Boolean(args.background),
      status,
      exitCode: null,
      ms: null,
    });
  }

  function end(entry, status, exitCode) {
    entry.status = status;
    entry.exitCode = Number.isInteger(exitCode) ? exitCode : null;
    entry.ms = Date.now() - entry.at;
    saveLog();
    changed();
  }

  /** The user said no to a run of a CLI set to "ask". */
  function declined(sessionId, call, cwd) {
    const ids = clis.clisInCommand((call.arguments || {}).command);
    if (ids.length) begin(sessionId, ids, call.arguments || {}, cwd, 'declined');
  }

  // run_command answers { stdout, stderr, exit_code }.
  const exitIn = (result) => {
    const code = result.output && typeof result.output === 'object' ? result.output.exit_code : null;
    return Number.isInteger(code) ? code : null;
  };
  // A background job: started so (background: true), or moved there by the
  // user while the agent waited ({ ..., background: { id } }).
  const jobOf = (args, result) => {
    if (result.is_error || !result.output || typeof result.output !== 'object') return null;
    const id = args.background ? result.output.id : result.output.background && result.output.background.id;
    return id ? backgroundJobs.jobs.get(id) || null : null;
  };

  /**
   * run_command for a command that starts a coding agent: refused when one is
   * off, logged otherwise, from start to end (a background run ends later).
   */
  async function runCommand(sessionId, args, context, run) {
    const ids = clis.clisInCommand(args.command);
    if (!ids.length) return run();
    const off = ids.filter((id) => clis.prefOf(prefs(), id).access === 'off');
    if (off.length) {
      begin(sessionId, ids, args, context.cwd, 'refused');
      return {
        output: `${names(off)} is turned off in the CodingFleet app (Settings > Coding agents), so it was not `
          + 'started. Do the task another way, or ask the user to allow it.',
        is_error: true,
      };
    }
    const entry = begin(sessionId, ids, args, context.cwd, 'running');
    let result;
    try {
      result = await run();
    } catch (err) {
      end(entry, 'failed', null);
      throw err;
    }
    const job = jobOf(args, result);
    if (job) {
      entry.background = true;
      // A killed job has no exit code: stopped (by the agent, the user or stop_after).
      job.exited.then(() => end(entry, job.exitCode === 0 ? 'done' : job.exitCode === null ? 'stopped' : 'failed',
        job.exitCode));
    } else {
      const code = exitIn(result);
      end(entry, result.is_error || (code !== null && code !== 0) ? 'failed' : 'done', code);
    }
    return result;
  }

  function clearLog() {
    entries = [];
    saveLog();
    changed();
    return view();
  }

  function register(handle) {
    handle('codingAgents:get', () => view());
    handle('codingAgents:detect', async () => { await detect(); return view(); });
    handle('codingAgents:set', (arg) => setPref(arg));
    handle('codingAgents:clearLog', () => clearLog());
  }

  return { start, detect, view, setPref, instructions, approval, declined, runCommand, clearLog, register };
}

module.exports = { createCodingAgents };
