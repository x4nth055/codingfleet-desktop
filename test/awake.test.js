'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { createAwake } = require('../src/main/awake');

// Electron's powerSaveBlocker, as far as awake.js uses it.
function fakeBlocker() {
  const live = new Set();
  let next = 1;
  const calls = [];
  return {
    calls,
    live,
    start(type) { calls.push(['start', type]); const id = next++; live.add(id); return id; },
    stop(id) { calls.push(['stop', id]); live.delete(id); },
    isStarted(id) { return live.has(id); },
  };
}

test('the request is held while a run goes and released when none is left', () => {
  const blocker = fakeBlocker();
  const awake = createAwake(blocker);
  assert.equal(awake.sync(true), true);
  assert.deepEqual(blocker.calls, [['start', 'prevent-app-suspension']]);
  // A second run, or the same state again, takes no second request.
  awake.sync(true);
  awake.sync(true);
  assert.equal(blocker.live.size, 1);
  assert.equal(awake.sync(false), false);
  assert.equal(blocker.live.size, 0);
  assert.equal(awake.held, false);
});

test('the switch in Preferences turns it off, even in the middle of a run', () => {
  const blocker = fakeBlocker();
  const awake = createAwake(blocker);
  awake.sync(true, undefined);          // never set: on by default
  assert.equal(awake.held, true);
  awake.sync(true, false);              // switched off during the run
  assert.equal(awake.held, false);
  assert.equal(blocker.live.size, 0);
  awake.sync(true, true);               // and on again
  assert.equal(awake.held, true);
});

test('never asks to keep the screen on', () => {
  const blocker = fakeBlocker();
  createAwake(blocker).sync(true);
  assert.ok(blocker.calls.every(([what, type]) => what !== 'start' || type === 'prevent-app-suspension'));
});

test('a request Windows already dropped is not stopped twice', () => {
  const blocker = fakeBlocker();
  const awake = createAwake(blocker);
  awake.sync(true);
  blocker.live.clear();                 // ended outside the app
  awake.sync(false);
  assert.deepEqual(blocker.calls.filter(([what]) => what === 'stop'), []);
  assert.equal(awake.held, false);
});
