'use strict';
// The composer's @ mentions: where one is being typed, which files of the
// folder it could mean, and the text once one is picked. No DOM and no state:
// the window loads this before its own scripts, the tests require it.
(function (root) {
  // An @ starts a mention at the start of the text or after a space or an
  // opening bracket, never inside a word: "me@example.com" is an address.
  const MENTION = /(?:^|[\s([{,;])@(?:"([^"\n]*)|([^\s"@]*))$/;

  /**
   * The mention the caret is in, or null.
   * @returns {{ start: number, end: number, query: string, quoted: boolean } | null}
   *   start is the @, end is past what the mention covers after the caret.
   */
  function mentionAt(text, caret) {
    const value = String(text || '');
    const at = Math.max(0, Math.min(Number.isInteger(caret) ? caret : value.length, value.length));
    const match = MENTION.exec(value.slice(0, at));
    if (!match) return null;
    const quoted = match[1] !== undefined;
    const query = quoted ? match[1] : match[2];
    const start = at - query.length - (quoted ? 2 : 1);
    // The rest of the word the caret sits in belongs to the mention too.
    const rest = value.slice(at);
    let end = at + (quoted ? /^[^"\n]*/.exec(rest)[0].length : /^[^\s"]*/.exec(rest)[0].length);
    if (quoted && value[end] === '"') end += 1;
    return { start, end, query, quoted };
  }

  const nameOf = (entry) => {
    const trimmed = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    return trimmed.slice(trimmed.lastIndexOf('/') + 1);
  };
  const depthOf = (entry) => (entry.endsWith('/') ? entry.slice(0, -1) : entry).split('/').length;

  // Every character of the query, in order, somewhere in the text. Higher is
  // better: letters that follow each other, and letters that start a word.
  function fuzzy(text, query) {
    let score = 0;
    let from = 0;
    let last = -2;
    for (const ch of query) {
      const found = text.indexOf(ch, from);
      if (found === -1) return -1;
      if (found === last + 1) score += 6;
      if (found === 0 || '/._- '.includes(text[found - 1])) score += 4;
      score -= Math.min(found - from, 10) * 0.2;
      last = found;
      from = found + 1;
    }
    return score;
  }

  function scoreOf(entry, query) {
    const path = entry.toLowerCase();
    const name = nameOf(path);
    if (name === query) return 1200;
    if (name.startsWith(query)) return 1000 - name.length;
    if (path.startsWith(query)) return 900 - path.length / 10;
    const inName = name.indexOf(query);
    if (inName >= 0) return 800 - inName;
    const inPath = path.indexOf(query);
    if (inPath >= 0) return 600 - inPath / 10;
    const loose = fuzzy(path, query);
    return loose < 0 ? -1 : 100 + loose;
  }

  const byShape = (a, b) => {
    const dirA = a.endsWith('/');
    const dirB = b.endsWith('/');
    if (dirA !== dirB) return dirA ? -1 : 1;
    return a.localeCompare(b);
  };

  /**
   * The entries (files, and folders ending in "/") a query most likely means.
   *   ""      the top of the folder
   *   "src/"  what is directly in src
   *   "rend"  the best matches anywhere, by name first
   */
  function rankPaths(entries, query, limit = 8) {
    const q = String(query || '').replace(/\\/g, '/').toLowerCase();
    const list = Array.isArray(entries) ? entries : [];
    if (!q || q.endsWith('/')) {
      const depth = q ? depthOf(q) + 1 : 1;
      return list
        .filter((entry) => entry.toLowerCase().startsWith(q) && entry.length > q.length && depthOf(entry) === depth)
        .sort(byShape)
        .slice(0, limit);
    }
    const scored = [];
    for (const entry of list) {
      const score = scoreOf(entry, q);
      if (score >= 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || a.entry.length - b.entry.length || a.entry.localeCompare(b.entry));
    return scored.slice(0, limit).map((s) => s.entry);
  }

  /**
   * The text with the mention replaced by `entry`. A file is followed by a
   * space, so typing goes on; a folder is not, so its contents show next.
   * @returns {{ text: string, caret: number }}
   */
  function insertMention(text, mention, entry) {
    const value = String(text || '');
    const folder = entry.endsWith('/');
    const needsQuotes = /\s/.test(entry);
    const body = needsQuotes ? `"${entry}${folder ? '' : '"'}` : entry;
    const after = value.slice(mention.end);
    const gap = folder || /^\s/.test(after) ? '' : ' ';
    const inserted = `@${body}${gap}`;
    const caret = mention.start + inserted.length + (!folder && gap === '' && /^\s/.test(after) ? 1 : 0);
    return { text: value.slice(0, mention.start) + inserted + after, caret };
  }

  const api = { mentionAt, rankPaths, insertMention };
  root.CF_MENTION = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
