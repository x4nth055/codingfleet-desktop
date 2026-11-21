'use strict';
// Phones, in the main process (Settings > Phones).
//
// Linking: the app asks the API for a link code and shows it as a QR code; the
// CodingFleet mobile app scans it, and the user confirms the phone here. The
// phone then gets a key of its own. This app's key never leaves this process.
//
// Remote control (core/remote-host.js): a linked phone can start a run in a
// session of this computer, make a session in one of its folders, and answer
// an approval. This computer listens only while it is signed in, "Phones can
// use this computer" is on, and the account has a phone: with no phone linked
// the app asks the server nothing but the device list, every ten minutes.
//
// What a phone is told: each session's id and its folder's name, the names of
// the folders with an id made here, and the approvals that wait. Never a path.
//
// What a phone can make this computer do: start a run with a message, in a
// session or a folder this computer published, say yes or no to one approval,
// and see a picture the agent made in a session's folder (the chart an answer
// shows as ![chart](out/plot.png)). A command changes no setting, and the one
// path a phone names, a picture's, is read only inside that session's folder
// and only if it is an image (local-images.js, as for the window); anything
// else in a command is refused. A run it starts goes through the window like a
// typed message, and through the same approvals.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { uniqueDevices } = require('../core/devices');
const { RemoteHost, buildHostState } = require('../core/remote-host');
const { qrSvg } = require('../core/qr-svg');
const tools = require('../core/tools');
// The words the window's approval bar uses, so a phone reads the same sentence.
const words = require('../renderer/lib/tool-words');

// The device list is read again this often while the app is open.
const LOOK_EVERY_MS = 10 * 60 * 1000;
// After the window is up: nothing here is needed to start the app.
const FIRST_LOOK_MS = 5000;
// How long signing out or in waits to revoke this computer's old key.
const RETIRE_MS = 8000;
// How long the window has to take a phone's message: it may read the session's
// history or make the session first.
const ANSWER_MS = 45000;
// Then how long the server has to say the run exists.
const STARTED_MS = 30000;
// The server's own limit for a message (assistant/api/remote.py).
const MAX_MESSAGE_CHARS = 100000;

const SESSION_ID = /^[A-Za-z0-9_-]{1,40}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FILE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// What the QR code may hold: the mobile app's own address, never a web page.
const LINK_URL = /^codingfleet:\/\/link\/[A-Za-z0-9_-]{8,200}$/;
const LINK_STATES = new Set(['pending', 'claimed', 'confirmed', 'linked', 'denied', 'expired']);
// The fields a command of each type carries, besides id, type and from.
const COMMAND_FIELDS = {
  'run.start': ['session_id', 'message', 'model', 'files'],
  'session.create': ['folder', 'message', 'model', 'files'],
  'approval.answer': ['call_id', 'decision'],
  'image.read': ['session_id', 'path'],
};
// Tools whose subject is a file: shown from the session's folder, as in the conversation.
const FILE_TOOLS = new Set(['fs_read', 'fs_write', 'fs_edit', 'view_image']);

const cut = (value, max) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

function isDirectory(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

/**
 * @param {object} o
 * @param {object} o.api core/api.js.
 * @param {object} o.app Electron's app.
 * @param {object} o.log
 * @param {(channel: string, payload: object) => void} o.send To the window.
 * @param {() => object} o.getWindow
 * @param {() => object} o.getState The app's local state (state.json).
 * @param {() => void} o.saveState
 * @param {Map} o.runs Session id -> Run.
 * @param {Map} o.approvals Tool call id -> { sessionId, reason, call }: the approvals that wait.
 * @param {(sessionId: string) => boolean} o.recoveryActive Whether an interrupted run waits to be recovered.
 * @param {(callId: string, decision: string) => boolean} o.decide Answers an approval, as the window does.
 * @param {() => string} o.permissionMode 'auto' or 'ask'.
 * @param {(args: { sessionId: string, path: string }) => Promise<object>} [o.readImage] A picture of a
 *   session's folder, for a phone (local-images.js forPhone).
 * @param {boolean} [o.enabled] False for a staged development start: nothing is asked, nothing listens.
 */
function createPhones({
  api, app, log, send, getWindow, getState, saveState, runs, approvals, recoveryActive, decide, permissionMode,
  readImage, enabled = true,
}) {
  let devices = null;       // the account's apps at the last look, one per device (core/devices.js), or null when not known
  let unavailable = false;  // the server has no devices and no remote control yet (404)
  let lookTimer = null;
  let lookFailures = 0;
  let epoch = 0;            // goes up when the account changes: an answer for the old one is dropped
  const links = new Set();     // the links started here
  const requests = new Map();  // request id -> takes the window's answer to a phone's message
  const waiters = new Map();   // session id -> takes the start of a run a phone asked for
  const lastErrors = new Map(); // session id -> why its last run could not start

  const signedIn = () => Boolean(api.snapshot().apiKey);
  const mode = () => (permissionMode() === 'auto' ? 'auto' : 'ask');
  const phoneCount = () => (devices || []).filter((device) => device.kind === 'phone').length;

  // ── What this computer publishes ─────────────────────────────────────────
  // What an approval is about, as its row in the conversation says it: the
  // command, the file, the address. Never what is in a file.
  function approvalDetail(call, cwd) {
    if (!call || !call.name) return '';
    let target = String(words.toolSummary({ name: call.name, arguments: call.arguments || {} })[1] || '');
    if (cwd && FILE_TOOLS.has(call.name) && path.isAbsolute(target) && tools.isInside(cwd, target)) {
      target = path.relative(cwd, target).replace(/\\/g, '/');
    }
    return target;
  }

  function waitingApprovals() {
    const sessions = getState().sessions || {};
    return [...approvals].map(([callId, waiting]) => ({
      callId,
      sessionId: waiting.sessionId,
      runId: (runs.get(waiting.sessionId) || {}).runId || '',
      tool: (waiting.call && waiting.call.name) || '',
      title: `CodingFleet ${words.reasonText(waiting.reason)}.`,
      detail: approvalDetail(waiting.call, (sessions[waiting.sessionId] || {}).cwd),
      always: words.alwaysAsked(waiting.reason),
    }));
  }

  function build() {
    const state = getState();
    return buildHostState({
      name: os.hostname(), platform: process.platform, version: app.getVersion(), permissionMode: mode(),
      sessions: state.sessions, lastCwd: state.lastCwd, approvals: waitingApprovals(),
    });
  }

  // ── Commands from a phone ────────────────────────────────────────────────
  const fromName = (command) => cut(command.from && command.from.name, 60) || 'Phone';

  // A field this app does not know could mean something it would not do
  // (a path, a permission mode): the whole command is refused, not half done.
  function checkFields(command) {
    const known = new Set(['id', 'type', 'from', ...COMMAND_FIELDS[command.type]]);
    const extra = Object.keys(command).find((key) => !known.has(key));
    if (extra) throw new Error(`This computer does not take "${cut(extra, 40)}" from a phone.`);
  }

  function messageFields(command) {
    checkFields(command);
    const { message, model, files } = command;
    if (typeof message !== 'string' || !message.trim()) throw new Error('The message is empty.');
    if (message.length > MAX_MESSAGE_CHARS) throw new Error('The message is too long.');
    if (model != null && (typeof model !== 'string' || model.length > 120 || /[\u0000-\u001f]/.test(model))) {
      throw new Error('That model is not one this computer knows.');
    }
    if (files != null && (!Array.isArray(files) || files.length > 10
      || !files.every((file) => typeof file === 'string' && FILE_ID.test(file)))) {
      throw new Error('The attached files could not be read.');
    }
    return { message: message.trim(), model: model || '', files: files || [], from: fromName(command) };
  }

  // The start of a run a phone asked for: its id, or why there is none.
  // Nothing in the answer after STARTED_MS means it is still starting.
  function runStarted(sessionId) {
    const run = runs.get(sessionId);
    if (run && run.runId) return Promise.resolve({ runId: run.runId });
    if (!run) return Promise.resolve({ error: lastErrors.get(sessionId) || 'The run did not start.' });
    return new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        waiters.delete(sessionId);
        resolve(value);
      };
      const timer = setTimeout(() => done({}), STARTED_MS);
      waiters.set(sessionId, done);
    });
  }

  // Every run's events pass here (main.js makeRun).
  function onRunEvent(sessionId, event, data) {
    if (event === 'client.error') {
      if (lastErrors.size > 50) lastErrors.clear();
      lastErrors.set(sessionId, cut(data && data.message, 300));
      return;
    }
    const waiter = waiters.get(sessionId);
    if (event === 'run.started') {
      lastErrors.delete(sessionId);
      if (waiter) waiter({ runId: data && data.run_id });
    } else if (event === 'client.finished' && waiter) {
      waiter({ error: lastErrors.get(sessionId) || 'The run ended before it started.' });
    }
  }

  // The message goes to the window, which sends it the way it sends one typed
  // in the composer: the conversation shows it, and the run, like any other.
  async function handOver(request) {
    if (!signedIn()) throw new Error('This computer is signed out.');
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error('CodingFleet is not open on this computer.');
    if (request.sessionId) lastErrors.delete(request.sessionId);
    const requestId = crypto.randomBytes(8).toString('hex');
    const answer = await new Promise((resolve) => {
      const done = (value) => {
        clearTimeout(timer);
        requests.delete(requestId);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), ANSWER_MS);
      requests.set(requestId, done);
      // expires: the window does not start a run this process has given up on.
      send('phones:run', { requestId, ...request, expires: Date.now() + ANSWER_MS - 5000 });
    });
    if (!answer) throw new Error('This computer did not answer in time.');
    const sessionId = typeof answer.sessionId === 'string' && SESSION_ID.test(answer.sessionId) ? answer.sessionId : null;
    // A session made for a message that then failed still exists: the phone is told which.
    const made = !request.sessionId && sessionId ? { session_id: sessionId } : {};
    if (!answer.ok) return { ok: false, error: cut(answer.error, 300) || 'The message could not be sent.', ...made };
    if (!sessionId || (request.sessionId && sessionId !== request.sessionId)) {
      throw new Error('This computer could not start the run.');
    }
    const started = await runStarted(sessionId);
    if (started.error) return { ok: false, error: started.error, ...made };
    return { ok: true, session_id: sessionId, ...(started.runId ? { run_id: String(started.runId) } : {}) };
  }

  function startRun(command) {
    const fields = messageFields(command);
    const sessionId = command.session_id;
    const sessions = getState().sessions || {};
    const local = typeof sessionId === 'string' && SESSION_ID.test(sessionId) && Object.hasOwn(sessions, sessionId)
      ? sessions[sessionId] : null;
    if (!local || typeof local.cwd !== 'string' || !local.cwd) throw new Error('This session is not on this computer.');
    if (!isDirectory(local.cwd)) throw new Error("This session's folder is no longer on this computer.");
    if (runs.has(sessionId)) throw new Error('This session is already working. Wait for it to finish.');
    if (recoveryActive(sessionId)) throw new Error('This session has an interrupted run. Open it on the computer first.');
    log.info(`a phone starts a run in session ${sessionId}`);
    return handOver({ sessionId, cwd: null, ...fields });
  }

  function createSession(command) {
    const fields = messageFields(command);
    // The id is one this computer published: the path it stands for is looked up here, never sent.
    const cwd = typeof command.folder === 'string' ? build().folderPaths.get(command.folder) : null;
    if (!cwd) throw new Error('This computer does not offer that folder.');
    if (!isDirectory(cwd)) throw new Error('That folder is no longer on this computer.');
    log.info('a phone starts a session in a folder of this computer');
    return handOver({ sessionId: null, cwd, ...fields });
  }

  function answerApproval(command) {
    checkFields(command);
    const { call_id: callId, decision } = command;
    // A phone says yes or no to the one call. "For the whole session" and
    // "always for this site" are choices made at the computer.
    if (decision !== 'allow' && decision !== 'deny') throw new Error('The answer must be allow or deny.');
    const waiting = typeof callId === 'string' && callId.length <= 64 ? approvals.get(callId) : null;
    if (!waiting) throw new Error('This approval was already answered.');
    const { sessionId } = waiting;
    const runId = (runs.get(sessionId) || {}).runId;
    if (!decide(callId, decision)) throw new Error('This approval was already answered.');
    // The window's approval bar goes, as it does for an answer given there.
    send('run:event', { sessionId, event: 'client.approval_answered', data: { id: callId, decision } });
    log.info(`approval ${callId} answered from a phone: ${decision}`);
    return { ok: true, session_id: sessionId, ...(runId ? { run_id: String(runId) } : {}) };
  }

  // A picture the agent made in a session's folder. The path is the answer's;
  // readImage keeps it inside the folder and refuses what is not an image.
  async function sendImage(command) {
    checkFields(command);
    const { session_id: sessionId, path: shown } = command;
    const sessions = getState().sessions || {};
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId) || !Object.hasOwn(sessions, sessionId)) {
      throw new Error('This session is not on this computer.');
    }
    if (typeof shown !== 'string' || !shown || shown.length > 1024 || /[\u0000-\u001f]/.test(shown)) {
      throw new Error('That is not a picture of this session.');
    }
    if (!readImage) throw new Error('This computer cannot send pictures.');
    const image = await readImage({ sessionId, path: shown });
    return { ok: true, session_id: sessionId, image };
  }

  const host = new RemoteHost({
    api,
    state: () => build().state,
    handlers: {
      'run.start': startRun, 'session.create': createSession, 'approval.answer': answerApproval, 'image.read': sendImage,
    },
    warn: (message) => log.warn(message),
    onHalt: (status, err) => {
      // 404: a server without remote control. Nothing is asked again until the
      // user opens Settings > Phones, or the app starts again.
      if (status === 404) {
        unavailable = true;
        clearTimeout(lookTimer);
      }
      log.warn(`remote control stopped (HTTP ${status}): ${err.message}`);
    },
  });

  // ── Whether this computer listens ────────────────────────────────────────
  const wanted = () => enabled && signedIn() && getState().remoteControl !== false && phoneCount() > 0;

  function sync() {
    if (wanted()) {
      if (host.start()) log.info('remote control on: listening for the phones of this account');
      return Promise.resolve();
    }
    if (!host.running) return Promise.resolve();
    log.info('remote control off');
    // The switch in Settings waits for this: not for long when the server is out of reach.
    return host.stop({ timeoutMs: 5000 }).catch(() => {});
  }

  function schedule(ms) {
    clearTimeout(lookTimer);
    if (!enabled) return;
    lookTimer = setTimeout(() => look().catch(() => {}), ms);
    lookTimer.unref?.();
  }

  // One entry per device: the same laptop signed in again, or the same phone
  // linked again, is one row, with the ids of all its keys.
  function cleanDevices(list) {
    return uniqueDevices((Array.isArray(list) ? list : []).filter((device) => device && DEVICE_ID.test(String(device.id || '')))
      .slice(0, 100).map((device) => ({
        id: String(device.id),
        name: cut(device.name, 60) || (device.kind === 'phone' ? 'Phone' : 'Computer'),
        kind: device.kind === 'phone' ? 'phone' : 'computer',
        platform: cut(device.platform, 20) || null,
        current: device.current === true,
        online: device.online === true,
        created_at: typeof device.created_at === 'string' ? device.created_at : null,
        last_used_at: typeof device.last_used_at === 'string' ? device.last_used_at : null,
      })));
  }

  // Reads the account's devices, then starts or stops listening to match.
  async function look() {
    clearTimeout(lookTimer);
    const mine = epoch;
    if (!signedIn()) {
      devices = null;
      await sync();
      return;
    }
    let failed = null;
    let answer = null;
    try {
      answer = await api.devices();
    } catch (err) {
      failed = err;
    }
    if (mine !== epoch) return; // the account changed while the answer travelled
    if (!failed) {
      devices = cleanDevices(answer && answer.devices);
      unavailable = false;
      lookFailures = 0;
      schedule(LOOK_EVERY_MS);
    } else if (failed.status === 404) {
      // A server without phones yet: not asked again by itself.
      unavailable = true;
      devices = null;
    } else if (failed.transient) {
      // Offline or a busy server: what was known stands, and it is asked again soon.
      schedule(Math.min(LOOK_EVERY_MS, 30000 * 2 ** Math.min(lookFailures++, 5)));
    } else {
      // The key is refused, or is a key for code: a new sign-in looks again.
      devices = null;
    }
    await sync();
    if (failed) throw failed;
  }

  // A confirmed phone collects its key within two minutes, and only then is
  // on the list: looked for until it is, so this computer starts listening.
  function lookForNewPhone() {
    const before = phoneCount();
    const mine = epoch;
    const waits = [3000, 4000, 6000, 10000, 20000, 30000, 50000];
    const next = () => {
      if (!waits.length || mine !== epoch) return;
      const timer = setTimeout(async () => {
        try { await look(); } catch { /* looked for again below */ }
        if (phoneCount() <= before) next();
      }, waits.shift());
      timer.unref?.();
    };
    next();
  }

  const view = () => ({
    devices: devices || [],
    remoteControl: getState().remoteControl !== false,
    // Whether this computer listens for phones right now.
    hosting: host.running,
  });

  function knownLink(value) {
    if (typeof value !== 'string' || !links.has(value)) throw new Error('This link has expired. Show a new code.');
    return value;
  }

  // What the window shows of a link: its state, and the phone that scanned it.
  function linkView(answer) {
    const out = { status: LINK_STATES.has(answer && answer.status) ? answer.status : 'expired' };
    const device = answer && answer.device;
    if (device && typeof device === 'object') {
      out.device = { name: cut(device.name, 60) || 'Phone', platform: cut(device.platform, 20) };
      out.confirm_code = /^\d{4}$/.test(String(answer.confirm_code || '')) ? String(answer.confirm_code) : '';
    }
    // Why a confirmed phone got no key after all (the account holds too many keys).
    if (answer && answer.message) out.message = cut(answer.message, 300);
    return out;
  }

  // The address in the QR code. A development app (CODINGFLEET_API_BASE) adds
  // its server, so the phone asks the same one; the mobile app takes that only
  // for a plain-HTTP server on the local network, never for another site.
  function linkAddress(url) {
    const { apiBase } = api.snapshot();
    if (!apiBase || apiBase === api.DEFAULT_API_BASE || !/^http:\/\//.test(apiBase)) return url;
    return `${url}?api=${encodeURIComponent(apiBase)}`;
  }

  function register(handle) {
    handle('phones:list', async () => {
      await look();
      return view();
    });

    // A link code, as the QR code that holds it. The picture is made here: the
    // window draws it and never handles the code as text.
    handle('phones:link', async () => {
      const started = await api.startDeviceLink();
      const id = String((started && started.id) || '');
      const url = String((started && started.url) || '');
      if (!DEVICE_ID.test(id) || !LINK_URL.test(url)) throw new Error('The server sent a link code this app does not understand.');
      if (links.size > 50) links.clear();
      links.add(id);
      return {
        id,
        qr: qrSvg(linkAddress(url)),
        expires_in: Math.min(900, Math.max(10, Number(started.expires_in) || 180)),
        interval: Math.min(30, Math.max(1, Number(started.interval) || 2)),
      };
    });

    handle('phones:linkStatus', async (linkId) => {
      const link = linkView(await api.deviceLink(knownLink(linkId)));
      // The phone has its key: it is on the list now, and this computer listens for it.
      if (link.status === 'linked') look().catch(() => {});
      return link;
    });

    // The user closed the code: it stops working on the server too. A server
    // that cannot be told lets the code run out by itself, in three minutes.
    handle('phones:linkCancel', async (linkId) => {
      if (typeof linkId !== 'string' || !links.delete(linkId)) return false;
      try { await api.cancelDeviceLink(linkId); } catch { return false; }
      return true;
    });

    handle('phones:linkDecide', async ({ id, decision } = {}) => {
      if (decision !== 'approve' && decision !== 'deny') throw new Error('Unknown answer.');
      const link = linkView(await api.decideDeviceLink(knownLink(id), decision));
      if (link.status === 'confirmed') lookForNewPhone();
      return link;
    });

    handle('phones:remove', async (deviceId) => {
      const device = (devices || []).find((entry) => entry.id === deviceId);
      // Only a phone: this computer signs itself out in Account, never from this list.
      if (!device || device.kind !== 'phone') throw new Error('That phone is no longer linked.');
      // Every key of this phone: the ones from an earlier link too.
      for (const id of device.ids || [device.id]) {
        try {
          await api.removeDevice(id);
        } catch (err) {
          if (err.code !== 'device_not_found') throw err; // already removed elsewhere
        }
      }
      devices = (devices || []).filter((entry) => entry.id !== device.id);
      // The last phone gone: this computer stops listening.
      await look().catch(() => sync());
      return view();
    });

    handle('phones:setRemote', async (on) => {
      getState().remoteControl = on === true;
      saveState();
      if (on === true && !devices && !unavailable) await look().catch(() => {});
      else await sync();
      return view();
    });

    // The window's answer to 'phones:run': whether the message was sent, and in which session.
    handle('phones:runResult', ({ requestId, ok, sessionId, error } = {}) => {
      const done = requests.get(requestId);
      if (!done) return false;
      done({ ok: ok === true, sessionId, error });
      return true;
    });
  }

  function start() {
    if (!enabled) return;
    schedule(FIRST_LOOK_MS);
    // Quitting says goodbye first, so phones see this computer go offline now
    // and not when the server gives up on it. The quit waits for it, briefly.
    let leaving = false;
    app.on('before-quit', (event) => {
      if (!host.running && !leaving) return;
      event.preventDefault();
      if (leaving) return;
      leaving = true;
      host.stop({ timeoutMs: 1500 }).catch(() => {}).finally(() => {
        leaving = false;
        app.quit();
      });
    });
  }

  // Before the key goes or changes: the goodbye needs the key it said hello with.
  async function signOut() {
    epoch++;
    clearTimeout(lookTimer);
    devices = null;
    links.clear();
    await host.stop({ timeoutMs: 3000 }).catch(() => {});
  }

  // This computer is signing out, or in again with a new key: the key it has
  // now is revoked on the server, so the laptop is not listed once per sign-in.
  // Called while that key is still the one in use; a key that cannot list
  // devices (a pasted key for code) or no connection leaves it as it is.
  async function retireThisComputer() {
    if (!signedIn()) return false;
    let timer = null;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('the server took too long')), RETIRE_MS);
    });
    try {
      await Promise.race([late, retire()]);
      return true;
    } catch (err) {
      if (err.message !== 'nothing to retire') log.warn(`could not sign the old key of this computer out: ${err.message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function retire() {
    const answer = await api.devices();
    const me = (Array.isArray(answer && answer.devices) ? answer.devices : [])
      .find((device) => device && device.current === true && device.kind !== 'phone');
    if (!me || !DEVICE_ID.test(String(me.id || ''))) throw new Error('nothing to retire');
    await api.removeDevice(String(me.id));
  }

  // Another account, or the same one signed in again: what was known is the old one's.
  function accountChanged() {
    epoch++;
    devices = null;
    unavailable = false;
    links.clear();
    sync();
    schedule(1000);
  }

  return {
    register, start, signOut, retireThisComputer, accountChanged, onRunEvent,
    // What this computer offers has changed (a session, a folder, an approval, the permission mode).
    refresh: () => host.refresh(),
  };
}

module.exports = { createPhones };
