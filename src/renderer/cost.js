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

  /**
   * The smartest models that cost less than this one. A model the plan covers
   * counts as free, so it comes out on top when the plan includes something good.
   * @param {Function} rateOf model -> credits per 20k tokens
   */
  function rankAlternatives(models, current, rateOf, limit = 2) {
    const rate = rateOf(current);
    if (!rate) return [];
    return (models || [])
      .filter((m) => m.id !== current.id && rateOf(m) < rate && (m.intelligence_index || 0) > 0)
      .sort((a, b) => ((b.intelligence_index || 0) - (a.intelligence_index || 0)) || (rateOf(a) - rateOf(b)))
      .slice(0, limit);
  }

  // Credits are shown to a person, not billed from here: keep them readable.
  const round = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

  const api = {
    WARN_CREDITS, ASSUMED_STEPS, ASSUMED_OUTPUT, fromModelPrice, fromHistory, rankAlternatives, round,
  };
  root.CF_COST = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
