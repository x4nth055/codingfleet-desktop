'use strict';
// Which computer this is (main/device-id.js), and the API calls that tell the
// server (core/api.js): one key per computer, against a server old or new.
const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const api = require('../src/core/api');
const { createDeviceId, hash, machineId } = require('../src/main/device-id');

test('the device id is a hash of the machine id, never the id itself, and the same every time', async () => {
  let reads = 0;
  const state = {};
  const deviceId = createDeviceId({
    getState: () => state, saveState: () => assert.fail('nothing to save'),
    read: async () => { reads++; return '4c4c4544-0042-3510-8048-b4c04f4d3732'; },
  });
  const first = await deviceId();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!first.includes('4c4c4544'));
  assert.equal(await deviceId(), first);
  assert.equal(reads, 1);
  // Another computer, another id; and the hash is CodingFleet's own, not a plain SHA-256.
  const other = createDeviceId({ getState: () => ({}), saveState: () => {}, read: async () => 'another-machine-guid' });
  assert.notEqual(await other(), first);
  assert.equal(first, hash('machine:4c4c4544-0042-3510-8048-b4c04f4d3732'));
});

test('with no machine id, a random id is kept in the state and used again', async () => {
  const state = {};
  let saved = 0;
  const make = () => createDeviceId({ getState: () => state, saveState: () => { saved++; }, read: async () => '' });
  const first = await make()();
  assert.match(state.deviceSeed, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(saved, 1);
  // The next start of the app: the same id, nothing written again.
  assert.equal(await make()(), first);
  assert.equal(saved, 1);
  // A reader that throws is the same as no machine id.
  const failing = createDeviceId({ getState: () => state, saveState: () => {}, read: async () => { throw new Error('no'); } });
  assert.equal(await failing(), first);
});

test('this computer has a machine id to read', async () => {
  const id = await machineId();
  assert.match(id, /^[0-9a-f-]{16,}$/, 'Windows MachineGuid, macOS IOPlatformUUID or /etc/machine-id');
});

// A tiny API server: records each request, answers with `reply`.
async function server(reply) {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = { method: req.method, url: req.url, auth: req.headers.authorization || '', body: raw ? JSON.parse(raw) : null };
    seen.push(request);
    const [status, payload] = reply(request);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const saved = api.snapshot();
  api.configure({ apiBase: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'cf_sk_now' });
  return {
    seen,
    close: () => { api.configure({ apiBase: saved.apiBase, apiKey: saved.apiKey }); srv.close(); },
  };
}

test('the browser sign-in says which computer it is, and asks an old server again without it', async () => {
  let old = false;
  const srv = await server(({ body }) => {
    if (old && Object.keys(body).length > 1) return [400, { error: { code: 'unknown_field', message: 'Unknown field "platform".' } }];
    return [200, { device_code: 'D', user_code: 'U', verify_url: 'https://x', interval: 3, expires_in: 600 }];
  });
  try {
    await api.startDeviceAuth('LAPTOP (desktop app)', { platform: 'windows', deviceId: 'L'.repeat(43) });
    assert.deepEqual(srv.seen[0].body, { name: 'LAPTOP (desktop app)', platform: 'windows', device_id: 'L'.repeat(43) });
    assert.equal(srv.seen[0].auth, '', 'no key goes with a sign-in');

    old = true;
    const started = await api.startDeviceAuth('LAPTOP (desktop app)', { platform: 'windows', deviceId: 'L'.repeat(43) });
    assert.equal(started.device_code, 'D');
    assert.deepEqual(srv.seen.slice(1).map((r) => r.body), [
      { name: 'LAPTOP (desktop app)', platform: 'windows', device_id: 'L'.repeat(43) },
      { name: 'LAPTOP (desktop app)' },
    ]);
  } finally {
    srv.close();
  }
});

test('a replaced key is signed out with that key, not the one in use', async () => {
  const srv = await server(({ method, url, auth }) => {
    if (method === 'GET' && url === '/v1/devices') {
      return [200, { devices: [
        { id: 'dev_phone', kind: 'phone', current: false },
        { id: auth === 'Bearer cf_sk_old' ? 'dev_old' : 'dev_now', kind: 'computer', current: true },
      ] }];
    }
    if (method === 'DELETE') return [200, { removed: true }];
    if (method === 'PUT') return [200, { devices: [], replaced: 2 }];
    return [404, {}];
  });
  try {
    assert.equal(await api.retireKey('cf_sk_old'), true);
    assert.deepEqual(srv.seen.map((r) => [r.method, r.url, r.auth]), [
      ['GET', '/v1/devices', 'Bearer cf_sk_old'],
      ['DELETE', '/v1/devices/dev_old', 'Bearer cf_sk_old'],
    ]);
    // The key in use is untouched by it.
    assert.equal(api.snapshot().apiKey, 'cf_sk_now');

    const claimed = await api.claimDevice('L'.repeat(43));
    assert.equal(claimed.replaced, 2);
    assert.deepEqual(srv.seen[2], { method: 'PUT', url: '/v1/devices/current', auth: 'Bearer cf_sk_now', body: { device_id: 'L'.repeat(43) } });
  } finally {
    srv.close();
  }
});
