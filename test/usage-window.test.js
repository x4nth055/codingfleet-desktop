'use strict';
// The Usage tab's 5-hour limit and the in-chat link to it.
const assert = require('node:assert/strict');
const test = require('node:test');

const usage = require('../src/renderer/lib/usage-window');

const NOW = Date.parse('2026-11-25T12:00:00Z');

function win(extra = {}) {
  return { window_hours: 5, percent_used: 42, limit_reached: false, back_under_limit_at: null,
           clears_at: '2026-11-25T15:40:00+00:00', ...extra };
}

test('plans without the limit get no view', () => {
  assert.equal(usage.windowView(null, NOW), null);
  assert.equal(usage.windowView(undefined, NOW), null);
});

test('below 80% it is fine and says when it clears', () => {
  const view = usage.windowView(win(), NOW);
  assert.equal(view.percent, 42);
  assert.equal(view.state, '');
  assert.match(view.line, /^42% used · clears by /);
});

test('from 80% it warns, at the limit it says when models are back', () => {
  assert.equal(usage.windowView(win({ percent_used: 80 }), NOW).state, 'warn');
  const reached = usage.windowView(win({ percent_used: 100, limit_reached: true,
    back_under_limit_at: '2026-11-25T13:10:00+00:00' }), NOW);
  assert.equal(reached.state, 'reached');
  assert.match(reached.line, /^100% used · back at /);
});

test('nothing in the window', () => {
  const view = usage.windowView(win({ percent_used: 0, clears_at: null }), NOW);
  assert.equal(view.line, '0% used');
});

test('a time that has passed is not shown', () => {
  const view = usage.windowView(win({ clears_at: '2026-11-25T11:00:00+00:00' }), NOW);
  assert.equal(view.line, '42% used');
});

test('the percentage stays between 0 and 100', () => {
  assert.equal(usage.windowView(win({ percent_used: 140 }), NOW).percent, 100);
  assert.equal(usage.windowView(win({ percent_used: 'x' }), NOW).percent, 0);
});

test('only the limit notices link to the Usage tab', () => {
  assert.deepEqual(usage.usageLink({ code: 'pool_warn', message: 'm' }), { tab: 'usage', label: 'See usage' });
  assert.deepEqual(usage.usageLink({ code: 'pool_cap', message: 'm' }), { tab: 'usage', label: 'See usage' });
  assert.equal(usage.usageLink({ code: 'model_switched', message: 'm' }), null);
  assert.equal(usage.usageLink({ message: 'Fresh sandbox.' }), null);
  assert.equal(usage.usageLink(null), null);
});
