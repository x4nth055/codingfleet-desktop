'use strict';
// This computer as a host for the account's phones (core/remote-host.js): what
// it publishes, the long poll for commands, and what it tells the sender.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ApiError } = require('../src/core/api');
const { RemoteHost, buildHostState, commandResult, folderName } = require('../src/core/remote-host');
const { qrSvg } = require('../src/core/qr-svg');

// The API, by hand. A long poll answers with the next entry of `script` (a list
// of commands, or an error to throw); with none left it hangs, as the real one
// does, until it is aborted.
function fakeApi(script = []) {
  const api = {
    script, published: [], results: [], polls: 0, aborted: 0, forgotten: 0, publishError: null,
    publishRemoteHost: async (state) => {
      if (api.publishError) throw api.publishError;
      api.published.push(state);
      return { online: true };
    },
    forgetRemoteHost: async () => { api.forgotten++; },
    remoteCommands: (wait, signal) => new Promise((resolve, reject) => {
      api.polls++;
      if (api.script.length) {
        const next = api.script.shift();
        if (next instanceof Error) reject(next);
        else resolve({ commands: next });
        return;
      }
      signal.addEventListener('abort', () => { api.aborted++; reject(signal.reason); }, { once: true });
    }),
    remoteCommandResult: async (id, result) => { api.results.push({ id, result }); },
  };
  return api;
}

async function until(check, what) {
  for (let turn = 0; turn < 400; turn++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`never happened: ${what}`);
}

const STATE = { name: 'Work laptop', platform: 'windows', sessions: [{ id: 'S1', folder: 'storefront' }], folders: [], approvals: [] };

function hostFor(api, options = {}) {
  const sleeps = [];
  const host = new RemoteHost({
    api, state: () => STATE, handlers: {}, idleMs: 0,
    sleep: async (ms) => { sleeps.push(ms); },
    ...options,
  });
  return { host, sleeps };
}

test('a command reaches its handler, and the sender is told what came of it', async () => {
  const api = fakeApi([[{ id: 'c1', type: 'run.start', session_id: 'S1', message: 'run the tests', from: { id: 'p1', name: 'Pixel' } }]]);
  const seen = [];
  const { host } = hostFor(api, {
    handlers: {
      'run.start': async (command) => {
        seen.push(command);
        return { ok: true, session_id: 'S1', run_id: 'R1', cwd: 'C:/not/for/the/phone' };
      },
    },
  });
  assert.equal(host.start(), true);
  await until(() => api.results.length === 1, 'the result is posted');
  // The computer said it was there before it asked for commands.
  assert.deepEqual(api.published[0], STATE);
  assert.equal(seen[0].message, 'run the tests');
  assert.equal(seen[0].from.name, 'Pixel');
  // Only the fields the server takes go back.
  assert.deepEqual(api.results, [{ id: 'c1', result: { ok: true, session_id: 'S1', run_id: 'R1' } }]);
  await host.stop();
});

test('a handler that throws, and a command this app does not know, are reported as failures', async () => {
  const api = fakeApi([[
    { id: 'c1', type: 'approval.answer', call_id: 'call_1', decision: 'allow' },
    { id: 'c2', type: 'settings.change', permission_mode: 'auto' },
    { id: 'c1', type: 'approval.answer', call_id: 'call_1', decision: 'allow' }, // delivered twice: done once
  ]]);
  let calls = 0;
  const { host } = hostFor(api, {
    handlers: { 'approval.answer': () => { calls++; throw new Error('This approval was already answered.'); } },
  });
  host.start();
  await until(() => api.results.length === 2, 'both results are posted');
  const byId = Object.fromEntries(api.results.map((entry) => [entry.id, entry.result]));
  assert.deepEqual(byId.c1, { ok: false, error: 'This approval was already answered.' });
  assert.equal(byId.c2.ok, false);
  assert.match(byId.c2.error, /cannot do that/);
  assert.equal(calls, 1);
  // A failed command does not stop the loop: it is listening again.
  await until(() => api.polls === 2, 'the next poll');
  assert.equal(host.running, true);
  await host.stop();
});

test('stop() ends the loop, drops the poll in flight and says goodbye; there is never a second loop', async () => {
  const api = fakeApi();
  const { host } = hostFor(api);
  assert.equal(host.start(), true);
  assert.equal(host.start(), false);
  await until(() => api.polls === 1, 'the long poll');
  assert.equal(host.start(), false);
  assert.equal(await host.stop(), true);
  assert.equal(host.running, false);
  assert.equal(api.aborted, 1);
  assert.equal(api.forgotten, 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(api.polls, 1);
  assert.equal(api.published.length, 1);
  // Stopping what is stopped does nothing, and refresh() then publishes nothing.
  assert.equal(await host.stop(), false);
  host.refresh();
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(api.published.length, 1);
  assert.equal(api.forgotten, 1);
});

test('a server without remote control (404) stops the polling for good', async () => {
  const api = fakeApi([new ApiError(404, null, 'Not found')]);
  const halted = [];
  const { host, sleeps } = hostFor(api, { onHalt: (status) => halted.push(status) });
  host.start();
  await until(() => halted.length === 1, 'the host halts');
  assert.deepEqual(halted, [404]);
  assert.equal(host.running, false);
  assert.equal(host.halted, 404);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(api.polls, 1);
  assert.deepEqual(sleeps, []);
  // Nothing was there to say goodbye to.
  assert.equal(api.forgotten, 0);

  // The same when the first thing the server refuses is the hello: it never polls.
  const refusing = fakeApi();
  refusing.publishError = new ApiError(404, null, 'Not found');
  const second = hostFor(refusing, { onHalt: (status) => halted.push(status) });
  second.host.start();
  await until(() => halted.length === 2, 'the second host halts');
  assert.equal(refusing.polls, 0);
  assert.equal(second.host.running, false);

  // A refused key stops it too.
  for (const status of [401, 403]) {
    const denied = fakeApi([new ApiError(status, { error: { message: 'No.', code: 'app_key_required' } })]);
    const third = hostFor(denied);
    third.host.start();
    await until(() => !third.host.running, `the host stops on ${status}`);
    assert.equal(denied.polls, 1);
  }
});

test('offline or a busy server: it waits longer each time, then goes on', async () => {
  const api = fakeApi([
    new ApiError(503, null, 'busy'),
    new ApiError(0, null, 'Cannot reach the server'),
    new SyntaxError('Unexpected token < in JSON'), // a proxy's page instead of an answer
    [{ id: 'c9', type: 'run.start' }],
  ]);
  const { host, sleeps } = hostFor(api, { handlers: { 'run.start': () => ({ ok: true }) } });
  host.start();
  await until(() => api.results.length === 1, 'the command after the outage');
  assert.equal(sleeps.length, 3);
  assert.ok(sleeps[0] >= 2000 && sleeps[1] >= 4000 && sleeps[2] >= 8000, `waits grow: ${sleeps}`);
  assert.equal(host.running, true);
  await host.stop();
});

test('refresh() publishes what changed, once, and nothing when nothing did', async () => {
  const api = fakeApi();
  let state = { ...STATE };
  const { host } = hostFor(api, { state: () => state });
  host.start();
  await until(() => api.polls === 1, 'the long poll');
  assert.equal(api.published.length, 1);
  host.refresh();
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(api.published.length, 1);
  state = { ...STATE, approvals: [{ call_id: 'call_1' }] };
  host.refresh();
  host.refresh();
  host.refresh();
  await until(() => api.published.length === 2, 'the new state');
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(api.published.length, 2);
  assert.deepEqual(api.published[1].approvals, [{ call_id: 'call_1' }]);
  // What cannot be read is not published, and nothing is thrown at the caller.
  const quiet = fakeApi();
  const broken = hostFor(quiet, { state: () => { throw new Error('no state'); } });
  assert.doesNotThrow(() => {
    broken.host.start();
    broken.host.refresh();
  });
  await until(() => quiet.polls === 1, 'it still listens');
  assert.equal(quiet.published.length, 0);
  await broken.host.stop();
  await host.stop();
});

test('what this computer publishes names its folders and never says where they are', () => {
  const root = path.join(os.tmpdir(), 'cf-remote-host');
  const shop = path.join(root, 'work', 'storefront');
  const service = path.join(root, 'work', 'api');
  const { state, folderPaths } = buildHostState({
    name: 'Work laptop', platform: 'win32', version: '1.5.0', permissionMode: 'auto',
    sessions: {
      S1: { cwd: shop, createdAt: 2 },
      S2: { cwd: service, createdAt: 3 },
      S3: { cwd: shop, createdAt: 1 },
      CLOUD: { cwd: null, createdAt: 9 },      // a cloud session: nothing of this computer
      RELATIVE: { cwd: 'work/api' },           // not a place this computer can vouch for
      'not an id': { cwd: shop },
    },
    lastCwd: shop,
    approvals: [{
      callId: 'call_1', sessionId: 'S1', runId: 'R1', tool: 'run_command',
      title: 'CodingFleet wants to run a command.', detail: 'x'.repeat(5000), always: true,
    }, { callId: 'call_2', sessionId: 'S2', tool: 'fs_write', title: 'CodingFleet wants to change a file.', detail: 'src/app.js' }],
  });
  assert.equal(state.name, 'Work laptop');
  assert.equal(state.platform, 'windows');
  assert.equal(state.permission_mode, 'auto');
  // Newest first; each with its folder's name only.
  assert.deepEqual(state.sessions, [{ id: 'S2', folder: 'api' }, { id: 'S1', folder: 'storefront' }, { id: 'S3', folder: 'storefront' }]);
  // The folder picked last first, each folder once.
  assert.deepEqual(state.folders.map((folder) => folder.name), ['storefront', 'api']);
  for (const folder of state.folders) assert.match(folder.id, /^[0-9a-f]{16}$/);
  // The way back from an id to its folder stays on this computer.
  assert.equal(folderPaths.get(state.folders[0].id), shop);
  assert.equal(folderPaths.get(state.folders[1].id), service);

  const offered = { ...state, approvals: [] };
  const text = JSON.stringify(offered);
  assert.equal(text.includes(root), false);
  assert.equal(text.includes(JSON.stringify(root).slice(1, -1)), false);
  assert.equal(/cwd|cf-remote-host/.test(text), false);
  for (const row of [...state.sessions, ...state.folders]) {
    for (const value of Object.values(row)) {
      assert.equal(path.isAbsolute(value), false, value);
      assert.equal(/[\\/]/.test(value), false, value);
    }
  }
  // A whole drive has no folder name: still not a path.
  const drive = folderName(path.parse(root).root);
  assert.equal(path.isAbsolute(drive), false);
  assert.equal(/[\\/]/.test(drive), false);
  assert.ok(drive.length > 0);

  // An approval says what it is about, cut to what the server keeps.
  assert.equal(state.approvals[0].detail.length, 2000);
  assert.equal(state.approvals[0].always, true);
  assert.deepEqual(state.approvals[1], {
    call_id: 'call_2', session_id: 'S2', run_id: '', tool: 'fs_write', title: 'CodingFleet wants to change a file.', detail: 'src/app.js',
  });
  assert.equal(buildHostState({ permissionMode: 'anything' }).state.permission_mode, 'ask');
});

test('past the limits the server sets, the newest sessions and folders are the ones offered', () => {
  const root = path.join(os.tmpdir(), 'cf-remote-host');
  const sessions = {};
  for (let i = 0; i < 400; i++) sessions[`S${i}`] = { cwd: path.join(root, `project-${i % 60}`), createdAt: i };
  const { state, folderPaths } = buildHostState({ sessions, approvals: Array.from({ length: 30 }, (_, i) => ({ callId: `c${i}` })) });
  assert.equal(state.sessions.length, 300);
  assert.equal(state.sessions[0].id, 'S399');
  assert.equal(state.folders.length, 40);
  assert.equal(folderPaths.size, 40);
  assert.equal(state.approvals.length, 20);
});

test('a result carries only what the server takes', () => {
  assert.deepEqual(commandResult({ ok: true, session_id: 'S', run_id: 'R', path: 'C:/x' }), { ok: true, session_id: 'S', run_id: 'R' });
  assert.deepEqual(commandResult({ ok: 'yes' }), { ok: false, error: 'This computer could not do that.' });
  assert.deepEqual(commandResult(undefined), { ok: false, error: 'This computer could not do that.' });
  assert.equal(commandResult({ ok: false, error: 'x'.repeat(900) }).error.length, 500);
});

test('a picture for a phone is a small raster image, or the command fails', () => {
  const image = { type: 'image/png', data: 'iVBORw0KGgo=', width: 640, height: 480, name: 'plot.png' };
  assert.deepEqual(commandResult({ ok: true, image, url: 'x' }), { ok: true, image });
  for (const bad of [
    { ...image, type: 'image/svg+xml' },
    { ...image, data: '' },
    { ...image, data: 'A'.repeat(1_866_669) },
  ]) {
    assert.deepEqual(commandResult({ ok: true, image: bad }), { ok: false, error: 'This picture cannot be sent to a phone.' });
  }
  // Sizes that are not sizes are left out, not sent.
  assert.deepEqual(commandResult({ ok: true, image: { ...image, width: -1, height: 1.5 } }).image,
    { type: 'image/png', data: 'iVBORw0KGgo=', name: 'plot.png' });
});

test('the QR code is black on white, with white all around it', () => {
  const svg = qrSvg(`codingfleet://link/${'a'.repeat(32)}`);
  const size = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)[1]);
  assert.ok(size >= 21 + 8, `at least the smallest code and its margin: ${size}`);
  assert.ok(svg.includes(`<rect width="${size}" height="${size}" fill="#fff"/>`));
  // The corner square starts after the margin, and nothing is drawn in the margin.
  assert.ok(svg.includes('<path fill="#000" d="M4 4h7v1h-7z'));
  let modules = 0;
  for (const [, x, y, width] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1/g)) {
    assert.ok(Number(x) >= 4 && Number(y) >= 4 && Number(x) + Number(width) <= size - 4 && Number(y) < size - 4);
    modules += Number(width);
  }
  assert.ok(modules > 100);
  assert.equal(/<script|style=|href=/.test(svg), false);
});
