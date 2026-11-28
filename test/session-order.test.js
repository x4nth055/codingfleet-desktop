'use strict';
// Group & sort: how the sidebar groups and orders the sessions.
const assert = require('node:assert/strict');
const test = require('node:test');

const order = require('../src/renderer/lib/session-order');

const NOW = new Date('2026-11-28T15:00:00').getTime();
const DAY = 86400000;
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

const SESSIONS = [
  { id: 'a', name: 'beta', folder: 'web', created: at(40), updated: at(0) },
  { id: 'b', name: 'Alpha', folder: 'api', created: at(2), updated: at(1) },
  { id: 'c', name: 'gamma 10', folder: 'web', created: at(1), updated: at(3) },
  { id: 'd', name: 'gamma 9', folder: 'api', created: at(10), updated: at(20) },
  { id: 'p', name: 'pinned one', folder: 'api', created: at(5), updated: at(50), pinned: true },
];
const PICK = {
  updated: (s) => s.updated,
  created: (s) => s.created,
  name: (s) => s.name,
  pinned: (s) => Boolean(s.pinned),
  folder: (s) => ({ key: s.folder, name: s.folder }),
};
const shape = (groups) => groups.map((g) => [g.name, g.items.map((s) => s.id).join('')]);

test('the default is by folder, last updated first, as the sidebar always was', () => {
  assert.deepEqual(order.normalize(null), { group: 'folder', sort: 'updated', dir: 'desc' });
  assert.deepEqual(order.normalize({ group: 'nope', sort: 'nope', dir: 'sideways' }), order.DEFAULT);
  assert.deepEqual(shape(order.arrange(SESSIONS, null, PICK, NOW)), [
    ['Pinned', 'p'],
    ['web', 'ac'],
    ['api', 'bd'],
  ]);
});

test('folders follow the sort, either way round', () => {
  assert.deepEqual(shape(order.arrange(SESSIONS, { sort: 'updated', dir: 'asc' }, PICK, NOW)), [
    ['Pinned', 'p'],
    ['api', 'db'],
    ['web', 'ca'],
  ]);
  assert.deepEqual(shape(order.arrange(SESSIONS, { sort: 'created', dir: 'desc' }, PICK, NOW)), [
    ['Pinned', 'p'],
    ['web', 'ca'],
    ['api', 'bd'],
  ]);
  // By name, the folders go by name too, and numbers in names count as numbers.
  assert.deepEqual(shape(order.arrange(SESSIONS, { sort: 'name', dir: 'asc' }, PICK, NOW)), [
    ['Pinned', 'p'],
    ['api', 'bd'],
    ['web', 'ac'],
  ]);
  assert.deepEqual(shape(order.arrange(SESSIONS, { sort: 'name', dir: 'desc' }, PICK, NOW)), [
    ['Pinned', 'p'],
    ['web', 'ca'],
    ['api', 'db'],
  ]);
});

test('by date, the days a person says, by the date the list is sorted on', () => {
  assert.deepEqual(shape(order.arrange(SESSIONS, { group: 'date' }, PICK, NOW)), [
    ['Pinned', 'p'],
    ['Today', 'a'],
    ['Yesterday', 'b'],
    ['Last 7 days', 'c'],
    ['Last 30 days', 'd'],
  ]);
  assert.deepEqual(shape(order.arrange(SESSIONS, { group: 'date', sort: 'created', dir: 'asc' }, PICK, NOW)), [
    ['Pinned', 'p'],
    ['Older', 'a'],
    ['Last 30 days', 'd'],
    ['Last 7 days', 'b'],
    ['Yesterday', 'c'],
  ]);
});

test('none is one list, pinned still first', () => {
  assert.deepEqual(shape(order.arrange(SESSIONS, { group: 'none', sort: 'name' }, PICK, NOW)), [
    ['Pinned', 'p'],
    ['Sessions', 'badc'],
  ]);
  assert.deepEqual(shape(order.arrange([SESSIONS[4]], { group: 'none' }, PICK, NOW)), [['Pinned', 'p']]);
  assert.deepEqual(order.arrange([], null, PICK, NOW), []);
});

test('a new sort starts its natural way round; the same sort keeps the chosen one', () => {
  const asc = order.choose(order.DEFAULT, 'dir', 'asc');
  assert.equal(asc.dir, 'asc');
  assert.deepEqual(order.choose(asc, 'sort', 'name'), { group: 'folder', sort: 'name', dir: 'asc' });
  assert.deepEqual(order.choose(asc, 'sort', 'created'), { group: 'folder', sort: 'created', dir: 'desc' });
  assert.deepEqual(order.choose(asc, 'sort', 'updated'), asc);
  assert.deepEqual(order.choose(asc, 'group', 'date'), { group: 'date', sort: 'updated', dir: 'asc' });
});

test('date buckets count from midnight', () => {
  const midnight = new Date('2026-11-28T00:00:00').getTime();
  assert.equal(order.dateBucket(midnight, NOW), 'Today');
  assert.equal(order.dateBucket(midnight - 1, NOW), 'Yesterday');
  assert.equal(order.dateBucket(midnight - DAY - 1, NOW), 'Last 7 days');
  assert.equal(order.dateBucket(midnight - 8 * DAY, NOW), 'Last 30 days');
  assert.equal(order.dateBucket(midnight - 31 * DAY, NOW), 'Older');
});
