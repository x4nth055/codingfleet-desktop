'use strict';
// How the window writes numbers, sizes, durations and dates. No DOM and no
// state, so it can be tested on its own: the window loads this before its own
// scripts (which use these names as they are), the tests require it.
(function (root) {
  const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
  const firstLine = (t) => String(t == null ? '' : t).split('\n')[0];
  const lineCount = (t) => (t ? String(t).split('\n').length : 0);
  // 213300 -> "213.3k", 400000 -> "400k", 1057587 -> "1.06M", 2.5e9 -> "2.5B"
  function fmtCompact(n) {
    const value = Math.abs(Number(n) || 0);
    const sign = Number(n) < 0 ? '-' : '';
    const units = [[1e3, 'k', 1], [1e6, 'M', 2], [1e9, 'B', 2]];
    if (value < 1000) return `${sign}${Math.round(value)}`;
    for (let i = units.length - 1; i >= 0; i--) {
      const [size, unit, digits] = units[i];
      if (value < size) continue;
      const shown = Number((value / size).toFixed(digits));
      // Rounding can carry into the next unit: 999,950 is "1M", not "1000k".
      if (shown >= 1000 && units[i + 1]) {
        return `${sign}${Number((value / units[i + 1][0]).toFixed(units[i + 1][2]))}${units[i + 1][1]}`;
      }
      return `${sign}${shown}${unit}`;
    }
    return `${sign}${Math.round(value)}`;
  }

  function fmtTokens(n) {
    return `${fmtCompact(n || 0)} tokens`;
  }

  // 80 -> "1m 20s", 5435 -> "1h 30m 35s", 9 -> "9s"
  function fmtDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return `${h}h ${m}m ${s}s`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function relTime(iso) {
    const date = new Date(iso);
    const s = (Date.now() - date.getTime()) / 1000;
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function groupOf(iso) {
    const days = (startOfDay(new Date()) - startOfDay(iso)) / 86400000;
    if (days <= 0) return 'Today';
    if (days <= 1) return 'Yesterday';
    if (days <= 7) return 'Previous 7 days';
    return 'Older';
  }

  // "Today 14:32", "Yesterday 09:05", "Sep 12, 14:32"
  function fmtStamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
    if (days === 0) return `Today ${time}`;
    if (days === 1) return `Yesterday ${time}`;
    const options = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
    return `${date.toLocaleDateString(undefined, options)}, ${time}`;
  }

  function clipText(text, max = 20000) {
    const t = text == null ? '' : String(text);
    return t.length > max ? `${t.slice(0, max)}\n… ${t.length - max} more characters` : t;
  }

  const api = {
    fmtNum, baseName, firstLine, lineCount, fmtCompact, fmtTokens, fmtDuration,
    relTime, startOfDay, groupOf, fmtStamp, clipText,
  };
  root.CF_FORMAT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
