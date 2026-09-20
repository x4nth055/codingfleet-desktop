'use strict';
// Line diffs for the "edited files" card: added/removed counts, and hunks with
// a few lines of context, like `git diff`.

// Past this many cells the middle of a change is shown as removed-then-added
// instead of aligned line by line. Keeps a huge rewrite from stalling the app.
const MAX_CELLS = 4_000_000;
const MAX_LINE_CHARS = 2000;
const MAX_HUNK_LINES = 4000;

function splitLines(text) {
  if (text == null || text === '') return [];
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Longest-common-subsequence alignment of two line arrays.
function align(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ t: '-', text: a[i++] });
    } else {
      ops.push({ t: '+', text: b[j++] });
    }
  }
  while (i < n) ops.push({ t: '-', text: a[i++] });
  while (j < m) ops.push({ t: '+', text: b[j++] });
  return ops;
}

function hunksOf(ops, context) {
  const changed = [];
  ops.forEach((op, index) => { if (op.t !== ' ') changed.push(index); });
  if (!changed.length) return [];
  const ranges = [];
  let from = Math.max(0, changed[0] - context);
  let to = Math.min(ops.length - 1, changed[0] + context);
  for (const index of changed.slice(1)) {
    if (index - context <= to + 1) {
      to = Math.min(ops.length - 1, index + context);
    } else {
      ranges.push([from, to]);
      from = Math.max(0, index - context);
      to = Math.min(ops.length - 1, index + context);
    }
  }
  ranges.push([from, to]);

  let budget = MAX_HUNK_LINES;
  const hunks = [];
  for (const [start, end] of ranges) {
    if (budget <= 0) break;
    const lines = ops.slice(start, Math.min(end + 1, start + budget)).map((op) => ({
      t: op.t,
      text: op.text.length > MAX_LINE_CHARS ? `${op.text.slice(0, MAX_LINE_CHARS)}…` : op.text,
      old: op.old == null ? null : op.old,
      new: op.new == null ? null : op.new,
    }));
    budget -= lines.length;
    hunks.push({ lines });
  }
  return hunks;
}

/**
 * @returns {{ added: number, removed: number, hunks: { lines: { t: ' '|'-'|'+', text: string, old: number|null, new: number|null }[] }[], truncated: boolean }}
 */
function diffLines(before, after, context = 3) {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle = midA.length * midB.length > MAX_CELLS
    ? [...midA.map((text) => ({ t: '-', text })), ...midB.map((text) => ({ t: '+', text }))]
    : align(midA, midB);
  const ops = [
    ...a.slice(0, start).map((text) => ({ t: ' ', text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ t: ' ', text })),
  ];

  let oldNo = 0;
  let newNo = 0;
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.t !== '+') op.old = ++oldNo;
    if (op.t !== '-') op.new = ++newNo;
    if (op.t === '+') added++;
    if (op.t === '-') removed++;
  }
  const hunks = hunksOf(ops, context);
  const shown = hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.t !== ' ').length, 0);
  return { added, removed, hunks, truncated: shown < added + removed };
}

module.exports = { diffLines, splitLines };
