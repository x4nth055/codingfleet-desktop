'use strict';
// An approval nobody answers gives up after 10, 5, 3 and then 1 minute, so a
// run full of risky commands is not held for 10 minutes each while the user is
// away; an answer or a new message makes the next one wait the full time again.
const assert = require('node:assert/strict');
const test = require('node:test');

const { createApprovalClock, waitMinutes, unansweredOutput } = require('../src/core/approval-clock');

// Timers run by hand: fire() runs every one still set.
function fakeTimers() {
  const timers = new Map();
  let next = 0;
  return {
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => [...timers.values()].map((t) => t.ms),
    fire() {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, t] of due) t.fn();
    },
  };
}

test('the waits step down 10, 5, 3, 1 and stay at 1', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(waitMinutes), [10, 5, 3, 1, 1, 1]);
  assert.equal(waitMinutes(undefined), 10);
});

test('five unanswered approvals in a row hold the run 20 minutes, not 50', () => {
  const timers = fakeTimers();
  const clock = createApprovalClock({ ...timers, minuteMs: 1 });
  const expired = [];
  for (let i = 0; i < 5; i++) {
    clock.start('S', (minutes) => expired.push(minutes));
    timers.fire();
  }
  assert.deepEqual(expired, [10, 5, 3, 1, 1]);
  assert.equal(expired.reduce((a, b) => a + b, 0), 20);
});

test('a timer runs for the minutes it was started with', () => {
  const timers = fakeTimers();
  const clock = createApprovalClock({ ...timers, minuteMs: 60000 });
  assert.equal(clock.start('S', () => {}).minutes, 10);
  assert.deepEqual(timers.pending(), [600000]);
});

test('an answer stops the timer and does not count as missed', () => {
  const timers = fakeTimers();
  const clock = createApprovalClock({ ...timers, minuteMs: 1 });
  let expired = 0;
  const wait = clock.start('S', () => expired++);
  wait.stop();
  timers.fire();
  assert.equal(expired, 0);
  assert.equal(clock.missed('S'), 0);
  assert.equal(clock.start('S', () => {}).minutes, 10);
});

test('the user coming back resets the steps, for that session only', () => {
  const timers = fakeTimers();
  const clock = createApprovalClock({ ...timers, minuteMs: 1 });
  clock.start('A', () => {});
  clock.start('B', () => {});
  timers.fire();
  clock.start('A', () => {});
  timers.fire();
  assert.equal(clock.start('A', () => {}).minutes, 3);
  clock.present('A');
  assert.equal(clock.start('A', () => {}).minutes, 10);
  assert.equal(clock.start('B', () => {}).minutes, 5);
});

test('approvals waiting together each take the step they started on', () => {
  const timers = fakeTimers();
  const clock = createApprovalClock({ ...timers, minuteMs: 1 });
  const first = clock.start('S', () => {});
  const second = clock.start('S', () => {});
  assert.deepEqual([first.minutes, second.minutes], [10, 10]);
  timers.fire();
  assert.equal(clock.missed('S'), 2);
  assert.equal(clock.start('S', () => {}).minutes, 3);
});

test('a stop after it expired changes nothing', () => {
  const timers = fakeTimers();
  const clock = createApprovalClock({ ...timers, minuteMs: 1 });
  let expired = 0;
  const wait = clock.start('S', () => expired++);
  timers.fire();
  wait.stop();
  assert.equal(expired, 1);
  assert.equal(clock.missed('S'), 1);
});

test('the agent is told what was skipped, for how long, and to carry on', () => {
  assert.equal(unansweredOutput('runs a command', 10),
    "Not run: this needed the user's approval (it runs a command) and nobody answered within 10 minutes; "
    + 'they may be away. Carry on with the work, and at the end say what you left undone and what it would do.');
  assert.match(unansweredOutput('deletes files', 1), /within 1 minute;/);
});

test('a real timer fires on its own', async () => {
  const clock = createApprovalClock({ minuteMs: 5 });
  const minutes = await new Promise((resolve) => clock.start('S', resolve));
  assert.equal(minutes, 10);
});
