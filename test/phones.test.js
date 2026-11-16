'use strict';
// Phones in the main process (main/phones.js), with the API, the window and
// Electron's app made by hand: when this computer listens, what it publishes,
// and what a phone's command can and cannot make it do.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ApiError } = require('../src/core/api');
const { createPhones } = require('../src/main/phones');

async function until(check, what) {
  for (let turn = 0; turn < 400; turn++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`never happened: ${what}`);
}

const PHONE = { id: 'dev_phone', name: 'Pixel', kind: 'phone', platform: 'android', current: false, online: false };
const COMPUTER = { id: 'dev_pc', name: 'Work laptop', kind: 'computer', platform: 'windows', current: true, online: false };

// The app around phones.js. `commands` are handed to the long poll one list at
// a time; a poll with nothing to hand over hangs until it is aborted.
function setup({ devices = [COMPUTER, PHONE], state = {}, devicesError = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-phones-'));
  const shop = path.join(root, 'storefront');
  const other = path.join(root, 'api');
  fs.mkdirSync(shop);
  fs.mkdirSync(other);
  const world = {
    root, shop, other,
    state: { sessions: { S1: { cwd: shop, createdAt: 2 }, CLOUD: { cwd: null, createdAt: 3 } }, lastCwd: other, permissionMode: 'ask', ...state },
    saved: 0, sent: [], decided: [], published: [], results: [], polls: 0, forgotten: 0, removed: [],
    commands: [], waiting: null, key: 'cf_sk_test', devices, devicesError,
    runs: new Map(), approvals: new Map(), ipc: {}, window: { isDestroyed: () => false },
    // What the window answers to a phone's message; null leaves it unanswered.
    windowAnswer: (request) => ({ ok: true, sessionId: request.sessionId || 'NEW1' }),
  };
  const api = {
    snapshot: () => ({ apiKey: world.key }),
    devices: async () => {
      if (world.devicesError) throw world.devicesError;
      return { devices: world.devices };
    },
    removeDevice: async (id) => {
      world.removed.push(id);
      world.devices = world.devices.filter((device) => device.id !== id);
    },
    startDeviceLink: async () => ({ id: 'link_1', link_code: 'x'.repeat(32), url: world.linkUrl || `codingfleet://link/${'x'.repeat(32)}`, expires_in: 180, interval: 2 }),
    deviceLink: async () => ({ status: 'claimed', device: { name: 'Pixel', platform: 'android', address: '203.0.113.9' }, confirm_code: '4827' }),
    decideDeviceLink: async (id, decision) => ({ status: decision === 'approve' ? 'confirmed' : 'denied' }),
    publishRemoteHost: async (published) => { world.published.push(published); },
    forgetRemoteHost: async () => { world.forgotten++; },
    remoteCommands: (wait, signal) => new Promise((resolve, reject) => {
      world.polls++;
      if (world.commands.length) {
        resolve({ commands: world.commands.shift() });
        return;
      }
      world.waiting = resolve;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    remoteCommandResult: async (id, result) => { world.results.push({ id, ...result }); },
  };
  const phones = createPhones({
    api,
    app: { getVersion: () => '1.5.0', on: () => {}, quit: () => {} },
    log: { info: () => {}, warn: () => {} },
    send: (channel, payload) => {
      world.sent.push({ channel, payload });
      if (channel !== 'phones:run') return;
      const answer = world.windowAnswer(payload);
      if (answer) setTimeout(() => world.ipc['phones:runResult']({ requestId: payload.requestId, ...answer }), 0);
    },
    getWindow: () => world.window,
    getState: () => world.state,
    saveState: () => { world.saved++; },
    runs: world.runs,
    approvals: world.approvals,
    recoveryActive: () => false,
    decide: (callId, decision) => {
      world.decided.push({ callId, decision });
      return world.approvals.delete(callId);
    },
    permissionMode: () => world.state.permissionMode,
  });
  phones.register((channel, fn) => { world.ipc[channel] = fn; });
  // Hands commands to the poll in flight, and gives back their results.
  world.command = async (...commands) => {
    const before = world.results.length;
    await until(() => world.waiting, 'a poll to hand the command to');
    const deliver = world.waiting;
    world.waiting = null;
    deliver({ commands: commands.map((command, index) => ({ id: `c${before + index}`, from: { id: PHONE.id, name: 'Pixel' }, ...command })) });
    await until(() => world.results.length === before + commands.length, 'the results');
    return world.results.slice(before).sort((a, b) => a.id.localeCompare(b.id));
  };
  world.phones = phones;
  world.close = async () => {
    world.key = '';
    await phones.signOut();
    fs.rmSync(root, { recursive: true, force: true });
  };
  return world;
}

test('this computer listens only while the account has a phone and remote control is on', async () => {
  // No phone linked: the device list is read, and nothing else is asked.
  const alone = setup({ devices: [COMPUTER] });
  let view = await alone.ipc['phones:list']();
  assert.equal(view.hosting, false);
  assert.deepEqual(view.devices.map((device) => device.kind), ['computer']);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(alone.polls, 0);
  assert.equal(alone.published.length, 0);
  await alone.close();

  // A phone, but the user turned remote control off.
  const off = setup({ state: { remoteControl: false } });
  view = await off.ipc['phones:list']();
  assert.equal(view.hosting, false);
  assert.equal(view.remoteControl, false);
  assert.equal(off.polls, 0);
  // Turned on: it listens. Turned off again: it stops and says so to the server.
  view = await off.ipc['phones:setRemote'](true);
  assert.equal(view.hosting, true);
  assert.equal(off.state.remoteControl, true);
  assert.equal(off.saved, 1);
  await until(() => off.polls === 1, 'the long poll');
  view = await off.ipc['phones:setRemote'](false);
  assert.equal(view.hosting, false);
  assert.equal(off.forgotten, 1);
  await off.close();

  // Removing the last phone stops it too. Only a phone can be removed here.
  const linked = setup();
  view = await linked.ipc['phones:list']();
  assert.equal(view.hosting, true);
  await assert.rejects(() => linked.ipc['phones:remove'](COMPUTER.id), /no longer linked/);
  view = await linked.ipc['phones:remove'](PHONE.id);
  assert.deepEqual(linked.removed, [PHONE.id]);
  assert.equal(view.hosting, false);
  assert.equal(linked.forgotten, 1);
  await linked.close();

  // A server that does not have phones yet: said once, and nothing listens.
  const old = setup({ devicesError: new ApiError(404, null, 'Not found') });
  await assert.rejects(() => old.ipc['phones:list'](), (err) => err.status === 404);
  assert.equal(old.polls, 0);
  assert.equal(old.published.length, 0);
  await old.close();
});

test('what is published never says where a folder is, and an approval says what it is about', async () => {
  const world = setup();
  await world.ipc['phones:list']();
  await until(() => world.published.length === 1, 'the first publish');
  let published = world.published[0];
  assert.deepEqual(published.sessions, [{ id: 'S1', folder: 'storefront' }]);
  assert.deepEqual(published.folders.map((folder) => folder.name), ['api', 'storefront']);
  assert.equal(published.permission_mode, 'ask');
  assert.equal(published.platform.length > 0, true);

  // An approval is asked: phones hear of it at once.
  world.runs.set('S1', { runId: 'R1' });
  world.approvals.set('call_1', {
    sessionId: 'S1', reason: 'may delete or overwrite data',
    call: { id: 'call_1', name: 'run_command', arguments: { command: 'rm -rf build' } },
  });
  world.approvals.set('call_2', {
    sessionId: 'S1', reason: 'changes files',
    call: { id: 'call_2', name: 'fs_write', arguments: { path: path.join(world.shop, 'src', 'app.js'), content: 'SECRET CONTENT' } },
  });
  world.phones.refresh();
  await until(() => world.published.length === 2, 'the publish with the approvals');
  published = world.published[1];
  assert.deepEqual(published.approvals, [{
    call_id: 'call_1', session_id: 'S1', run_id: 'R1', tool: 'run_command',
    title: 'CodingFleet wants to run a command that can delete or overwrite data.', detail: 'rm -rf build', always: true,
  }, {
    // A file in the session's folder, from the folder; never what is written to it.
    call_id: 'call_2', session_id: 'S1', run_id: 'R1', tool: 'fs_write',
    title: 'CodingFleet wants to change a file.', detail: 'src/app.js',
  }]);
  for (const sent of world.published) {
    const text = JSON.stringify(sent);
    assert.equal(text.includes(world.root), false);
    assert.equal(text.includes(JSON.stringify(world.root).slice(1, -1)), false);
    assert.equal(text.includes('SECRET CONTENT'), false);
  }
  await world.close();
});

test('a phone answers an approval with yes or no, and nothing more', async () => {
  const world = setup();
  await world.ipc['phones:list']();
  const ask = (id) => world.approvals.set(id, { sessionId: 'S1', reason: 'runs a command', call: { id, name: 'run_command', arguments: { command: 'npm test' } } });
  ask('call_1');
  ask('call_2');
  world.runs.set('S1', { runId: 'R1' });

  const [session, site, unknown, extra] = await world.command(
    { type: 'approval.answer', call_id: 'call_1', decision: 'allow-session' },
    { type: 'approval.answer', call_id: 'call_1', decision: 'allow-site' },
    { type: 'approval.answer', call_id: 'call_9', decision: 'allow' },
    { type: 'approval.answer', call_id: 'call_1', decision: 'allow', permission_mode: 'auto' },
  );
  for (const refused of [session, site, unknown, extra]) assert.equal(refused.ok, false);
  assert.match(session.error, /allow or deny/);
  assert.match(unknown.error, /already answered/);
  assert.match(extra.error, /permission_mode/);
  assert.deepEqual(world.decided, []);
  assert.equal(world.approvals.size, 2);

  const [allowed, denied] = await world.command(
    { type: 'approval.answer', call_id: 'call_1', decision: 'allow' },
    { type: 'approval.answer', call_id: 'call_2', decision: 'deny' },
  );
  assert.deepEqual(allowed, { id: allowed.id, ok: true, session_id: 'S1', run_id: 'R1' });
  assert.equal(denied.ok, true);
  assert.deepEqual(world.decided, [{ callId: 'call_1', decision: 'allow' }, { callId: 'call_2', decision: 'deny' }]);
  // The window's approval bar is told, as for an answer given there.
  assert.deepEqual(world.sent.filter((s) => s.channel === 'run:event').map((s) => s.payload), [
    { sessionId: 'S1', event: 'client.approval_answered', data: { id: 'call_1', decision: 'allow' } },
    { sessionId: 'S1', event: 'client.approval_answered', data: { id: 'call_2', decision: 'deny' } },
  ]);
  // Answered twice: the second is told so.
  const [again] = await world.command({ type: 'approval.answer', call_id: 'call_1', decision: 'allow' });
  assert.equal(again.ok, false);
  await world.close();
});

test('a phone starts a run only in a session or a folder this computer published', async () => {
  const world = setup();
  await world.ipc['phones:list']();
  await until(() => world.published.length === 1, 'the first publish');
  const folders = Object.fromEntries(world.published[0].folders.map((folder) => [folder.name, folder.id]));

  const refused = await world.command(
    { type: 'run.start', session_id: 'S404', message: 'hi' },                          // not a session of this computer
    { type: 'run.start', session_id: 'CLOUD', message: 'hi' },                         // a cloud session: no folder here
    { type: 'run.start', session_id: 'S1', message: '   ' },
    { type: 'run.start', session_id: 'S1', message: 'hi', cwd: world.other },          // a path is never taken
    { type: 'run.start', session_id: 'S1', message: 'hi', permission_mode: 'auto' },
    { type: 'run.start', session_id: 'S1', message: 'hi', files: ['../../etc/passwd'] },
    { type: 'run.start', session_id: 'constructor', message: 'hi' },
    { type: 'session.create', folder: world.other, message: 'hi' },                    // a path where an id belongs
    { type: 'session.create', folder: 'ffffffffffffffff', message: 'hi' },             // an id this computer never made
    { type: 'session.create', folder: folders.api, session_id: 'S1', message: 'hi' },
  );
  assert.equal(refused.length, 10);
  for (const result of refused) assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(refused[0].error, /not on this computer/);
  assert.match(refused[3].error, /"cwd"/);
  // Nothing of them reached the window.
  assert.equal(world.sent.filter((s) => s.channel === 'phones:run').length, 0);

  // A session that is already working is not interrupted.
  world.runs.set('S1', { runId: 'R0' });
  const [busy] = await world.command({ type: 'run.start', session_id: 'S1', message: 'hi' });
  assert.match(busy.error, /already working/);
  world.runs.delete('S1');

  // The real thing: the window sends the message, and the run's id goes back.
  world.windowAnswer = (request) => {
    world.runs.set(request.sessionId, { runId: null });
    setTimeout(() => world.phones.onRunEvent(request.sessionId, 'run.started', { run_id: 'R7' }), 5);
    return { ok: true, sessionId: request.sessionId };
  };
  const [started] = await world.command({ type: 'run.start', session_id: 'S1', message: ' run the tests ', model: 'auto', files: ['file_1'] });
  assert.deepEqual(started, { id: started.id, ok: true, session_id: 'S1', run_id: 'R7' });
  const handed = world.sent.filter((s) => s.channel === 'phones:run').pop().payload;
  assert.equal(handed.sessionId, 'S1');
  assert.equal(handed.cwd, null);
  assert.equal(handed.message, 'run the tests');
  assert.equal(handed.model, 'auto');
  assert.deepEqual(handed.files, ['file_1']);
  assert.equal(handed.from, 'Pixel');
  world.runs.delete('S1');

  // A new session: the id is turned back into its folder here, for the window only.
  world.windowAnswer = () => {
    world.runs.set('NEW1', { runId: 'R8' });
    return { ok: true, sessionId: 'NEW1' };
  };
  const [made] = await world.command({ type: 'session.create', folder: folders.api, message: 'start here' });
  assert.deepEqual(made, { id: made.id, ok: true, session_id: 'NEW1', run_id: 'R8' });
  assert.equal(world.sent.filter((s) => s.channel === 'phones:run').pop().payload.cwd, world.other);

  // The run could not start (out of credits, say): the phone is told why.
  world.windowAnswer = (request) => {
    world.runs.set(request.sessionId, { runId: null });
    setTimeout(() => {
      world.phones.onRunEvent(request.sessionId, 'client.error', { message: 'You are out of credits.' });
      world.runs.delete(request.sessionId);
      world.phones.onRunEvent(request.sessionId, 'client.finished', {});
    }, 5);
    return { ok: true, sessionId: request.sessionId };
  };
  const [failed] = await world.command({ type: 'run.start', session_id: 'S1', message: 'hi' });
  assert.deepEqual(failed, { id: failed.id, ok: false, error: 'You are out of credits.' });

  // The window refused (the session is busy in another window, say).
  world.windowAnswer = (request) => ({ ok: false, sessionId: request.sessionId, error: 'This session is already working.' });
  const [declined] = await world.command({ type: 'run.start', session_id: 'S1', message: 'hi' });
  assert.deepEqual(declined, { id: declined.id, ok: false, error: 'This session is already working.' });

  // No window, or signed out: refused, nothing guessed.
  world.window = null;
  const [windowless] = await world.command({ type: 'run.start', session_id: 'S1', message: 'hi' });
  assert.match(windowless.error, /not open/);
  await world.close();
});

test('the link is shown as a picture, and the window never gets the code or the key', async () => {
  const world = setup({ devices: [COMPUTER] });
  const started = await world.ipc['phones:link']();
  assert.deepEqual(Object.keys(started).sort(), ['expires_in', 'id', 'interval', 'qr']);
  assert.match(started.qr, /^<svg /);
  assert.equal(JSON.stringify(started).includes('x'.repeat(32)), false);
  const link = await world.ipc['phones:linkStatus']('link_1');
  // The phone's name and the four digits; not its address.
  assert.deepEqual(link, { status: 'claimed', device: { name: 'Pixel', platform: 'android' }, confirm_code: '4827' });
  assert.equal((await world.ipc['phones:linkDecide']({ id: 'link_1', decision: 'approve' })).status, 'confirmed');
  await assert.rejects(() => world.ipc['phones:linkDecide']({ id: 'link_1', decision: 'allow' }), /Unknown answer/);
  // Only a link started here can be read or answered.
  await assert.rejects(() => world.ipc['phones:linkStatus']('link_2'), /expired/);
  // Only the mobile app's own address goes into a code.
  world.linkUrl = 'https://example.com/link/abc';
  await assert.rejects(() => world.ipc['phones:link'](), /does not understand/);
  await world.close();
});
