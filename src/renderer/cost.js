'use strict';
// What a run will cost, as arithmetic with no state and no DOM, so it can be
// tested on its own. The window loads this before app.js; the tests require it.
//
// It is an estimate, not a quote. An agentic run makes several model calls,
// each re-sending the conversation, and how many depends on the work.
(function (root) {
  const WARN_CREDITS = 100;       // above this, the app asks before spending
  const ASSUMED_STEPS = 5;        // model calls in a run that uses a few tools
  const ASSUMED_OUTPUT = 1200;    // tokens the model writes per step
  const TOKENS_PER_CREDIT_UNIT = 20000;

  /**
   * The model's published price, applied to a guess at the run's size.
   * @param {number} rate credits per 20k tokens (0 for free or plan-covered)
   */
  function fromModelPrice({ rate, contextTokens = 0, promptText = '', steps = ASSUMED_STEPS }) {
    if (!rate) return { credits: 0, basis: 'free' };
    const promptTokens = Math.ceil(String(promptText || '').length / 4);
    const perStep = contextTokens + promptTokens + ASSUMED_OUTPUT;
    return { credits: ((perStep * steps) / TOKENS_PER_CREDIT_UNIT) * rate, basis: 'model' };
  }

  /**
   * What this session's earlier runs actually cost, scaled by how much the
   * conversation has grown since: every step re-sends it, so it costs more.
   * @param {Array<{credits: number, contextTokens: number}>} runs
   */
  function fromHistory(runs, contextNow) {
    const used = (runs || []).filter((r) => Number(r.credits) > 0);
    if (!used.length) return null;
    const avgCredits = used.reduce((sum, r) => sum + Number(r.credits), 0) / used.length;
    const avgContext = used.reduce((sum, r) => sum + (Number(r.contextTokens) || 0), 0) / used.length;
    const growth = avgContext > 0 && contextNow > 0 ? Math.max(1, contextNow / avgContext) : 1;
    return { credits: avgCredits * growth, basis: 'history', runs: used.length };
  }

  // A suggestion has to be worth acting on. Ranking by intelligence alone just
  // returns the next variant down of the same family -- nearly as clever and
  // nearly as dear, which is no help to anyone. So a candidate must first save
  // real money, and only then compete on how capable it is.
  const MAX_COST_FRACTION = 0.5;  // at most half the price of the chosen model
  const MAX_IQ_DROP = 12;         // and no further than this below it (index is 0-100)

  const iqOf = (m) => m.intelligence_index || 0;

  /**
   * Two models worth switching to: the cheapest one that is still nearly as
   * capable, and the most capable of the ones that are much cheaper. They are
   * usually different models, which is the point -- one is the bargain, the
   * other is the safe step down.
   *
   * A model the plan covers counts as free, so it wins on price outright.
   * @param {Function} rateOf model -> credits per 20k tokens
   */
  function rankAlternatives(models, current, rateOf, limit = 2) {
    const rate = rateOf(current);
    if (!rate) return [];

    // Anything that does not cut the bill meaningfully is not a suggestion.
    const muchCheaper = (models || []).filter((m) => m.id !== current.id && iqOf(m) > 0
      && rateOf(m) <= rate * MAX_COST_FRACTION);
    if (!muchCheaper.length) return [];

    // Prefer the ones that stay close in capability; if the chosen model is in
    // a class of its own, fall back to the best of what is much cheaper.
    const nearlyAsSmart = muchCheaper.filter((m) => iqOf(m) >= iqOf(current) - MAX_IQ_DROP);
    const pool = nearlyAsSmart.length ? nearlyAsSmart : muchCheaper;

    const cheapestFirst = [...pool].sort((a, b) => (rateOf(a) - rateOf(b)) || (iqOf(b) - iqOf(a)));
    const smartestFirst = [...pool].sort((a, b) => (iqOf(b) - iqOf(a)) || (rateOf(a) - rateOf(b)));

    const picks = [];
    for (const model of [cheapestFirst[0], smartestFirst[0], ...cheapestFirst]) {
      if (model && !picks.some((p) => p.id === model.id)) picks.push(model);
      if (picks.length >= limit) break;
    }
    return picks;
  }

  // ── Token accounting ────────────────────────────────────────────────────
  // Providers disagree about cache tokens, and it is the one place to get the
  // sum wrong.
  //
  // Anthropic (Claude) counts them *beside* the prompt: its `input_tokens` is
  // only what was neither read from nor written to the cache, and it reports
  // the cache figures separately, so the three parts add up.
  //
  // OpenAI-compatible providers (OpenAI, Gemini, DeepSeek, ...) fold both
  // kinds into `prompt_tokens` -- cache hits and misses together *are* the
  // prompt. There, both cache figures are slices of it, and adding them again
  // counts the same tokens twice.
  const APART = /anthropic|claude/i;

  /** True when this model's provider reports cache tokens beside the prompt. */
  function cacheApart(modelId, provider) {
    return APART.test(`${provider || ''} ${modelId || ''}`);
  }

  /**
   * One run's numbers, split so they add up to the tokens that really moved.
   * @param {object} usage prompt_tokens, cache_read_input_tokens, cache_creation_input_tokens
   * @param {{modelId?: string, provider?: string}} who the model that ran
   * @returns {{fresh: number, cacheRead: number, cacheWrite: number, prompt: number}}
   */
  function promptParts(usage, who = {}) {
    const prompt = (usage && usage.prompt_tokens) || 0;
    const cacheRead = (usage && usage.cache_read_input_tokens) || 0;
    const cacheWrite = (usage && usage.cache_creation_input_tokens) || 0;
    if (cacheApart(who.modelId, who.provider)) {
      return { fresh: prompt, cacheRead, cacheWrite, prompt: prompt + cacheRead + cacheWrite };
    }
    return {
      fresh: Math.max(0, prompt - cacheRead - cacheWrite), cacheRead, cacheWrite, prompt,
    };
  }

  // Credits are shown to a person, not billed from here: keep them readable.
  const round = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

  const api = {
    WARN_CREDITS, ASSUMED_STEPS, ASSUMED_OUTPUT, MAX_COST_FRACTION, MAX_IQ_DROP,
    fromModelPrice, fromHistory, rankAlternatives, round, cacheApart, promptParts,
  };
  root.CF_COST = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
