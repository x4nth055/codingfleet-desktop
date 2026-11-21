'use strict';
// One row per device (core/devices.js): the server lists one key per sign-in.
const assert = require('node:assert/strict');
const test = require('node:test');

const { uniqueDevices } = require('../src/core/devices');

const device = (id, extra = {}) => ({
  id, name: 'Abdou\'s A52s', kind: 'phone', platform: 'android', current: false, online: false,
  created_at: null, last_used_at: null, ...extra,
});

test('keys of the same kind, platform and name are one device, shown as the newest', () => {
  const list = uniqueDevices([
    device('a', { last_used_at: '2026-11-21T09:00:00Z' }),
    device('b', { last_used_at: '2026-11-21T12:00:00Z' }),
    device('c', { name: '  abdou\'s   A52S ', created_at: '2026-11-21T11:00:00Z' }),
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'b');
  assert.deepEqual(list[0].ids, ['b', 'a', 'c']);
});

test('a key never used counts from its sign-in', () => {
  const list = uniqueDevices([
    device('used', { last_used_at: '2026-11-01T09:00:00Z' }),
    device('fresh', { created_at: '2026-11-21T09:00:00Z' }),
  ]);
  assert.equal(list[0].id, 'fresh');
  assert.equal(list[0].last_used_at, '2026-11-01T09:00:00Z');
});

test('the key in use here, then the online one, stand for the device', () => {
  const pc = (id, extra) => device(id, { kind: 'computer', platform: 'windows', name: 'LAPTOP-NL967996 (desktop app)', ...extra });
  let list = uniqueDevices([
    pc('old', { last_used_at: '2026-11-21T12:00:00Z' }),
    pc('mine', { current: true, last_used_at: '2026-10-01T12:00:00Z' }),
    pc('live', { online: true }),
  ]);
  assert.equal(list[0].id, 'mine');
  assert.equal(list[0].current, true);
  assert.equal(list[0].online, true);
  assert.equal(list[0].last_used_at, '2026-11-21T12:00:00Z');
  list = uniqueDevices([pc('old', { last_used_at: '2026-11-21T12:00:00Z' }), pc('live', { online: true })]);
  assert.equal(list[0].id, 'live');
});

test('another name, platform or kind is another device, and the order is kept', () => {
  const list = uniqueDevices([
    device('pc', { kind: 'computer', platform: 'windows', name: 'LAPTOP' }),
    device('android'),
    device('ios', { platform: 'ios' }),
    device('other', { name: 'Work phone' }),
    device('web', { kind: 'web', platform: null, name: 'Web chat' }),
    null,
  ]);
  assert.deepEqual(list.map((entry) => entry.id), ['pc', 'android', 'ios', 'other', 'web']);
  assert.deepEqual(list.map((entry) => entry.ids.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(uniqueDevices(null), []);
});

test('two keys that each say which device they are on are two devices, even with the same name', () => {
  const pc = (id, extra) => device(id, { kind: 'computer', platform: 'windows', name: 'Work laptop', ...extra });
  const list = uniqueDevices([
    pc('a', { hardware: true, last_used_at: '2026-11-21T09:00:00Z' }),
    pc('b', { hardware: true }),
    // A key from before device ids joins the first of them: it cannot say which it was.
    pc('old', { last_used_at: '2026-10-12T09:00:00Z' }),
  ]);
  assert.deepEqual(list.map((entry) => entry.ids), [['a', 'old'], ['b']]);
});

test('a laptop key from before platforms is the same laptop as its newer keys', () => {
  const list = uniqueDevices([
    device('old', { kind: 'computer', platform: null, name: 'LAPTOP-NL967996 (desktop app)', last_used_at: '2026-10-14T09:00:00Z' }),
    device('new', { kind: 'computer', platform: 'windows', name: 'LAPTOP-NL967996 (desktop app)', hardware: true, current: true }),
    device('mac', { kind: 'computer', platform: 'macos', name: 'LAPTOP-NL967996 (desktop app)' }),
  ]);
  assert.deepEqual(list.map((entry) => entry.ids), [['new', 'old'], ['mac']]);
  assert.equal(list[0].platform, 'windows');
  // The other way round: the platform the newer key says is shown for the old one chosen.
  const only = uniqueDevices([
    device('old', { kind: 'computer', platform: null, name: 'PC', current: true }),
    device('new', { kind: 'computer', platform: 'linux', name: 'PC' }),
  ]);
  assert.equal(only[0].id, 'old');
  assert.equal(only[0].platform, 'linux');
});
