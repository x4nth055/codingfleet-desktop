'use strict';
// The 5-hour limit strip: which notices start it, when it hides, what it says.
const assert = require('node:assert/strict');
const test = require('node:test');

const cap = require('../src/renderer/lib/pool-cap');

const NOW = Date.parse('2026-10-05T12:00:00Z');
const MESSAGE = "You reached your Unlimited plan's 5-hour limit on unlimited models, so this answer "
  + 'came from Claude Sonnet 5.5 and used your weekly quota. Unlimited models are back in about 2.5 hours.';

function notice(extra = {}) {
  return { message: MESSAGE, code: 'pool_cap', upgrade: true, resets_at: '2026-10-05T14:30:00+00:00', ...extra };
}

test('only a pool_cap notice starts the strip', () => {
  assert.equal(cap.capFromNotice({ message: 'Weekly quota reached.' }, NOW), null);
  assert.equal(cap.capFromNotice({ code: 'sandbox_fresh', message: 'Fresh sandbox.' }, NOW), null);
  assert.equal(cap.capFromNotice(null, NOW), null);
  const strip = cap.capFromNotice(notice(), NOW);
  assert.equal(strip.until, Date.parse('2026-10-05T14:30:00Z'));
  assert.equal(strip.upgrade, true);
});

test('the server reset time is cut, and said again live', () => {
  const strip = cap.capFromNotice(notice(), NOW);
  assert.ok(!strip.message.includes('back in'));
  assert.ok(strip.message.endsWith('used your weekly quota.'));
  assert.ok(cap.capText(strip, NOW).endsWith('Unlimited models are back in about 2.5 hours.'));
  // An hour later the strip says so, not what the run said.
  assert.ok(cap.capText(strip, NOW + 3600e3).endsWith('back in about 1.5 hours.'));
});

test('the strip hides at the reset and after a close, but a later window shows again', () => {
  const strip = cap.capFromNotice(notice(), NOW);
  assert.equal(cap.capVisible(strip, null, NOW), true);
  assert.equal(cap.capVisible(strip, null, strip.until + 1), false);
  assert.equal(cap.capVisible(strip, strip.until, NOW), false);
  const later = cap.capFromNotice(notice({ resets_at: '2026-10-05T20:00:00+00:00' }), NOW);
  assert.equal(cap.capVisible(later, strip.until, NOW), true);
});

test('a notice whose window is already over starts nothing', () => {
  assert.equal(cap.capFromNotice(notice({ resets_at: '2026-10-05T11:00:00+00:00' }), NOW), null);
});

test('no reset time keeps the strip for a whole window', () => {
  const strip = cap.capFromNotice(notice({ resets_at: null }), NOW);
  assert.equal(strip.until, NOW + 5 * 3600e3);
});

test('upgrade is offered only when the server says a higher plan helps', () => {
  assert.equal(cap.capFromNotice(notice({ upgrade: false }), NOW).upgrade, false);
  assert.equal(cap.capFromNotice(notice({ upgrade: undefined }), NOW).upgrade, false);
});

test('the reset phrase rounds like the server', () => {
  assert.equal(cap.backIn(NOW + 30e3, NOW), 'Unlimited models are back in under a minute.');
  assert.equal(cap.backIn(NOW + 25 * 60e3, NOW), 'Unlimited models are back in about 25 minutes.');
  assert.equal(cap.backIn(NOW + 3600e3, NOW), 'Unlimited models are back in about 1 hour.');
  assert.equal(cap.backIn(NOW + 4 * 3600e3, NOW), 'Unlimited models are back in about 4 hours.');
});
