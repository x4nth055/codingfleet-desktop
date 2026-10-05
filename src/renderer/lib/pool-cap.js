'use strict';
// The strip above the composer for the 5-hour limit on Unlimited models. A run
// the limit moved to another model ends with a `notice` whose code is
// `pool_cap`; the strip shows it until `resets_at`, when Unlimited models are
// back. No DOM and no state, so the tests can require it.
(function (root) {
  const WINDOW_MS = 5 * 60 * 60 * 1000;
  // The server ends its message with when the models come back. That is true
  // only when the run ends, so the strip cuts it and says it again, live. It is
  // always the last sentence ("about 2.5 hours." has a dot of its own).
  const SERVER_RESET = /\s*Unlimited models are back in .*$/;

  // A run's notice -> what the strip holds, or null when the notice is about
  // something else or its window is already over.
  function capFromNotice(notice, now = Date.now()) {
    if (!notice || notice.code !== 'pool_cap' || !notice.message) return null;
    const parsed = Date.parse(notice.resets_at);
    const until = Number.isFinite(parsed) ? parsed : now + WINDOW_MS;
    if (until <= now) return null;
    return {
      message: String(notice.message).replace(SERVER_RESET, ''),
      upgrade: Boolean(notice.upgrade),
      until,
    };
  }

  // Shown until it resets, unless the user closed it for this window. A later
  // window (a later reset) shows again.
  function capVisible(cap, dismissedUntil, now = Date.now()) {
    if (!cap || !(Number(cap.until) > now)) return false;
    return !(Number(dismissedUntil) >= cap.until - 60000);
  }

  // Same rounding as the server: 90 minutes is "1.5 hours", not "1 hour".
  function backIn(until, now = Date.now()) {
    const seconds = (until - now) / 1000;
    if (seconds <= 60) return 'Unlimited models are back in under a minute.';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `Unlimited models are back in about ${minutes} minutes.`;
    const hours = seconds / 3600;
    const label = hours < 10 ? String(Number(hours.toFixed(1))) : String(Math.round(hours));
    return `Unlimited models are back in about ${label} ${label === '1' ? 'hour' : 'hours'}.`;
  }

  function capText(cap, now = Date.now()) {
    return `${cap.message} ${backIn(cap.until, now)}`;
  }

  const api = { capFromNotice, capVisible, backIn, capText };
  root.CF_POOL_CAP = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
