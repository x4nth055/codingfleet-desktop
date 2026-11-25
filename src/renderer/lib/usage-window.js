'use strict';
// The 5-hour fair-use limit on Unlimited models, as the Usage tab and the chat
// show it. /v1/credits carries it as `standard_window` (a whole percentage and
// two times, never dollars), and a run on an Unlimited model past 80% ends with
// a `notice` whose code is `pool_warn` and whose `usage` is the same object.
// No DOM and no state, so the tests can require it.
(function (root) {
  const WARN_PERCENT = 80;

  function clock(ms, now) {
    const at = new Date(ms);
    const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return at.toDateString() === new Date(now).toDateString()
      ? time
      : `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  }

  // standard_window -> what the Usage tab draws, or null on plans without it.
  // state: '' (fine), 'warn' (80% or more) or 'reached'.
  function windowView(win, now = Date.now()) {
    if (!win || typeof win !== 'object') return null;
    const percent = Math.max(0, Math.min(100, Math.round(Number(win.percent_used) || 0)));
    const hours = Number(win.window_hours) || 5;
    const reached = Boolean(win.limit_reached);
    const back = Date.parse(win.back_under_limit_at);
    const clears = Date.parse(win.clears_at);
    let line;
    if (reached && Number.isFinite(back) && back > now) line = `${percent}% used · back at ${clock(back, now)}`;
    else if (Number.isFinite(clears) && clears > now) line = `${percent}% used · clears by ${clock(clears, now)}`;
    else line = `${percent}% used`;
    return {
      percent,
      hours,
      state: reached ? 'reached' : (percent >= WARN_PERCENT ? 'warn' : ''),
      line,
    };
  }

  // A run's notice -> the in-chat link to the Usage tab, or null. The limit
  // notices (near it, or reached) get one; other notices do not.
  function usageLink(notice) {
    if (!notice || (notice.code !== 'pool_warn' && notice.code !== 'pool_cap')) return null;
    return { tab: 'usage', label: 'See usage' };
  }

  const api = { WARN_PERCENT, windowView, usageLink };
  root.CF_USAGE_WINDOW = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
