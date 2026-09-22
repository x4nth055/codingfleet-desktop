'use strict';
// What a run will cost: the estimate the composer shows, and the cheaper
// models it offers when the estimate is high.
const test = require('node:test');
const assert = require('node:assert');

const cost = require('../src/renderer/cost');
const {
  fromModelPrice, fromHistory, rankAlternatives, round, WARN_CREDITS, cacheApart, promptParts,
} = cost;

const rateOf = (m) => m.credits_per_20k_tokens || 0;

// A lineup shaped like the real one: a flagship with effort variants that are
// barely cheaper, and a row of cheap "flash" models that are still capable.
const models = [
  { id: 'fable-max', name: 'Fable 5.1 Max', credits_per_20k_tokens: 100, intelligence_index: 75 },
  { id: 'fable-xhigh', name: 'Fable 5.1 xHigh', credits_per_20k_tokens: 95, intelligence_index: 74 },
  { id: 'fable-high', name: 'Fable 5.1 High', credits_per_20k_tokens: 80, intelligence_index: 72 },
  { id: 'luna-max', name: 'GPT 5.6 Luna Max', credits_per_20k_tokens: 30, intelligence_index: 70 },
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', credits_per_20k_tokens: 8, intelligence_index: 66 },
  { id: 'glm-flash', name: 'GLM 5.3 Flash', credits_per_20k_tokens: 4, intelligence_index: 64 },
  { id: 'tiny', name: 'Tiny', credits_per_20k_tokens: 1, intelligence_index: 30 },
  { id: 'unrated', name: 'Unrated', credits_per_20k_tokens: 1, intelligence_index: 0 },
];
const byId = (id) => models.find((m) => m.id === id);

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

test('a barely cheaper sibling is never suggested', () => {
  // Fable Max -> Fable xHigh is 5% off: smart, and no help at all.
  const out = rankAlternatives(models, byId('fable-max'), rateOf);
  assert.ok(!out.some((m) => m.id === 'fable-xhigh'), 'xHigh is only 5% cheaper');
  assert.ok(!out.some((m) => m.id === 'fable-high'), 'High is only 20% cheaper');
});

test('every suggestion at least halves the bill', () => {
  for (const current of [byId('fable-max'), byId('luna-max'), byId('deepseek-flash')]) {
    for (const alt of rankAlternatives(models, current, rateOf)) {
      assert.ok(rateOf(alt) <= rateOf(current) * 0.5,
        `${alt.name} (${rateOf(alt)}) is not half of ${current.name} (${rateOf(current)})`);
    }
  }
});

test('the cheap but capable models are what get offered', () => {
  const out = rankAlternatives(models, byId('fable-max'), rateOf).map((m) => m.id);
  // Cheapest that stays within 12 points of 75, and the best of the much cheaper.
  assert.deepEqual(out, ['glm-flash', 'luna-max']);
});

test('the two picks differ: one bargain, one safe step down', () => {
  const out = rankAlternatives(models, byId('fable-max'), rateOf);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, out[1].id);
  assert.ok(rateOf(out[0]) < rateOf(out[1]), 'the first pick is the cheaper one');
  assert.ok(out[1].intelligence_index > out[0].intelligence_index, 'the second is the cleverer one');
});

test('a cheap but dim model is not offered when capable ones exist', () => {
  const out = rankAlternatives(models, byId('fable-max'), rateOf);
  assert.ok(!out.some((m) => m.id === 'tiny'), 'Tiny is cheap but 45 points down');
});

test('when the chosen model is in a class of its own, the best cheap one is offered', () => {
  const lonely = [
    { id: 'genius', name: 'Genius', credits_per_20k_tokens: 200, intelligence_index: 95 },
    { id: 'ok', name: 'Ok', credits_per_20k_tokens: 10, intelligence_index: 60 },
    { id: 'meh', name: 'Meh', credits_per_20k_tokens: 5, intelligence_index: 40 },
  ];
  const out = rankAlternatives(lonely, lonely[0], rateOf);
  // Nothing is within 12 points of 95, so it falls back to what is much cheaper.
  assert.equal(out.length, 2);
  assert.ok(out.some((m) => m.id === 'ok'));
});

test('a model with no intelligence score is never offered', () => {
  const out = rankAlternatives(models, byId('fable-max'), rateOf, 5);
  assert.ok(!out.some((m) => m.id === 'unrated'));
});

test('the cheapest model has nothing to suggest', () => {
  assert.deepEqual(rankAlternatives(models, byId('tiny'), rateOf), []);
});

test('a free or plan-covered model wins on price outright', () => {
  const covered = { id: 'plan', name: 'Plan', credits_per_20k_tokens: 90, intelligence_index: 70 };
  const withPlan = [...models, covered];
  const out = rankAlternatives(withPlan, byId('fable-max'), (m) => (m.id === 'plan' ? 0 : rateOf(m)), 2);
  assert.equal(out[0].id, 'plan', 'free beats every price');
});

test('credits are rounded for reading, not for billing', () => {
  assert.equal(round(512.03), 512);
  assert.equal(round(3.14159), 3.1);
  assert.equal(round(0.04), 0);
});

// ── Tokens a run moved ─────────────────────────────────────────────────────
// Anthropic reports the cache beside the prompt: input_tokens is neither what
// was read from nor what was written to the cache, so the parts are disjoint.
test('Claude reports the cache beside the prompt, so the parts add up', () => {
  const usage = { prompt_tokens: 120, cache_read_input_tokens: 48000, cache_creation_input_tokens: 9000 };
  assert.deepEqual(promptParts(usage, { modelId: 'claude-opus-5', provider: 'Anthropic' }),
    { fresh: 120, cacheRead: 48000, cacheWrite: 9000, prompt: 57120 });
});

test('an Anthropic model is recognised by its provider or by its id', () => {
  assert.ok(cacheApart('claude-opus-5', 'Anthropic'));
  assert.ok(cacheApart('claude-sonnet-5', ''), 'the id alone can say so');
  assert.ok(cacheApart('', 'Anthropic'));
  assert.ok(!cacheApart('gpt-5.6-luna', 'OpenAI'));
  assert.ok(!cacheApart('', ''));
});

// Everywhere else the cache hits and misses together are prompt_tokens, so the
// cached part has to come out of it or the same tokens are counted twice.
test('cache hits are inside the prompt elsewhere, so they are not counted again', () => {
  const usage = { prompt_tokens: 50000, cache_read_input_tokens: 48000, cache_creation_input_tokens: 0 };
  assert.deepEqual(promptParts(usage, { modelId: 'gpt-5.6-luna', provider: 'OpenAI' }),
    { fresh: 2000, cacheRead: 48000, cacheWrite: 0, prompt: 50000 });
});

test('a prompt that is all cache still leaves a whole prompt', () => {
  const parts = promptParts({ prompt_tokens: 48000, cache_read_input_tokens: 48000 },
    { modelId: 'gemini-3.6-flash', provider: 'Google' });
  assert.equal(parts.fresh, 0);
  assert.equal(parts.prompt, 48000, 'the prompt stays what the provider charged for');
});

test('a provider that over-reports the cache never yields a negative input', () => {
  const usage = { prompt_tokens: 1000, cache_read_input_tokens: 900, cache_creation_input_tokens: 400 };
  assert.equal(promptParts(usage, { modelId: 'deepseek-v4.1-flash' }).fresh, 0);
});

test('a run with nothing cached is just its prompt', () => {
  assert.deepEqual(promptParts({ prompt_tokens: 700 }, { modelId: 'claude-opus-5' }),
    { fresh: 700, cacheRead: 0, cacheWrite: 0, prompt: 700 });
});

test('a run that says nothing about tokens moved none', () => {
  assert.deepEqual(promptParts(null), { fresh: 0, cacheRead: 0, cacheWrite: 0, prompt: 0 });
});
