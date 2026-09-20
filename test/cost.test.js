'use strict';
// What a run will cost: the estimate the composer shows, and the cheaper
// models it offers when the estimate is high.
const test = require('node:test');
const assert = require('node:assert');

const cost = require('../src/renderer/cost');
const { fromModelPrice, fromHistory, rankAlternatives, round, WARN_CREDITS } = cost;

const rateOf = (m) => m.credits_per_20k_tokens || 0;
const models = [
  { id: 'big', name: 'Big', credits_per_20k_tokens: 40, intelligence_index: 70 },
  { id: 'mid', name: 'Mid', credits_per_20k_tokens: 12, intelligence_index: 66 },
  { id: 'small', name: 'Small', credits_per_20k_tokens: 3, intelligence_index: 55 },
  { id: 'free', name: 'Free', credits_per_20k_tokens: 0, intelligence_index: 40 },
  { id: 'unrated', name: 'Unrated', credits_per_20k_tokens: 1, intelligence_index: 0 },
];

test('a free or plan-covered model costs nothing', () => {
  assert.deepEqual(fromModelPrice({ rate: 0, contextTokens: 90000 }), { credits: 0, basis: 'free' });
});

test('cost rises with the conversation, because every step re-sends it', () => {
  const small = fromModelPrice({ rate: 10, contextTokens: 1000 });
  const large = fromModelPrice({ rate: 10, contextTokens: 100000 });
  assert.ok(large.credits > small.credits * 10, 'a long conversation should cost much more');
  assert.equal(large.basis, 'model');
});

test('a dearer model costs proportionally more', () => {
  const cheap = fromModelPrice({ rate: 3, contextTokens: 50000 });
  const dear = fromModelPrice({ rate: 30, contextTokens: 50000 });
  assert.ok(Math.abs(dear.credits / cheap.credits - 10) < 0.001);
});

test('a big model on a long conversation trips the warning', () => {
  const estimate = fromModelPrice({ rate: 40, contextTokens: 50000, promptText: 'fix the bug' });
  assert.ok(estimate.credits > WARN_CREDITS, `${estimate.credits} should be over ${WARN_CREDITS}`);
});

test('a small model on a short conversation does not', () => {
  const estimate = fromModelPrice({ rate: 3, contextTokens: 2000, promptText: 'hello' });
  assert.ok(estimate.credits < WARN_CREDITS);
});

test('history beats the price list: past runs scale with the conversation', () => {
  const doubled = fromHistory([{ credits: 80, contextTokens: 25000 }], 50000);
  assert.equal(doubled.credits, 160);
  assert.equal(doubled.basis, 'history');
  assert.equal(doubled.runs, 1);
});

test('history averages several runs', () => {
  const out = fromHistory([
    { credits: 10, contextTokens: 1000 },
    { credits: 30, contextTokens: 1000 },
  ], 1000);
  assert.equal(out.credits, 20);
  assert.equal(out.runs, 2);
});

test('history never scales down: a compacted session is not suddenly cheap', () => {
  const out = fromHistory([{ credits: 100, contextTokens: 80000 }], 5000);
  assert.equal(out.credits, 100);
});

test('no priced history means no history estimate', () => {
  assert.equal(fromHistory([], 1000), null);
  assert.equal(fromHistory([{ credits: 0, contextTokens: 900 }], 1000), null);
});

test('alternatives are the smartest models that cost less', () => {
  const out = rankAlternatives(models, models[0], rateOf);
  assert.deepEqual(out.map((m) => m.id), ['mid', 'small']);
});

test('alternatives never include a dearer or equal model', () => {
  const out = rankAlternatives(models, models[2], rateOf, 4);
  assert.ok(out.every((m) => rateOf(m) < rateOf(models[2])));
  assert.ok(!out.some((m) => m.id === 'big'));
});

test('a model with no intelligence score is not recommended', () => {
  const out = rankAlternatives(models, models[0], rateOf, 5);
  assert.ok(!out.some((m) => m.id === 'unrated'));
});

test('the cheapest model has nothing to suggest', () => {
  assert.deepEqual(rankAlternatives(models, models[3], rateOf), []);
});

test('a plan-covered model sorts in as free and wins on price', () => {
  const covered = { id: 'plan', name: 'Plan', credits_per_20k_tokens: 99, intelligence_index: 66 };
  const withPlan = [...models, covered];
  // The plan makes it free, so at equal intelligence it beats the paid one.
  const out = rankAlternatives(withPlan, models[0], (m) => (m.id === 'plan' ? 0 : rateOf(m)), 1);
  assert.equal(out[0].id, 'plan');
});

test('credits are rounded for reading, not for billing', () => {
  assert.equal(round(512.03), 512);
  assert.equal(round(3.14159), 3.1);
  assert.equal(round(0.04), 0);
});
