'use strict';
// Reading git's own diff output: how many lines a change adds and takes away,
// and the hunks the window draws.
//
// Git has already aligned the two versions of a file, so its unified diff is
// both faster and more accurate than aligning them again here — core/diff.js
// does that for the edits the agent makes, where no repository stands behind
// them.

const MAX_HUNK_LINES = 4000;   // kept for one file, across all of its hunks
const MAX_LINE_CHARS = 2000;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const clip = (text) => (text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text);

// "a\n" is one line, not two; "" is none.
function countLines(text) {
  const str = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  if (!str) return 0;
  const lines = str.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * Every line of a file git does not track yet: there is nothing to align it to,
 * so the whole thing is one hunk of additions.
 * @returns {{ added: number, removed: number, hunks: object[], truncated: boolean, binary: boolean }}
 */
function addedFile(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const kept = lines.slice(0, MAX_HUNK_LINES);
  return {
    added: lines.length,
    removed: 0,
    hunks: kept.length
      ? [{ lines: kept.map((line, index) => ({ t: '+', text: clip(line), old: null, new: index + 1 })) }]
      : [],
    truncated: kept.length < lines.length,
    binary: false,
  };
}

/**
 * One file's unified diff (what `git diff` prints for a single path).
 * @returns {{ added: number, removed: number, hunks: { lines: { t: ' '|'-'|'+', text: string, old: number|null, new: number|null }[] }[], truncated: boolean, binary: boolean }}
 */
function parseUnifiedDiff(text) {
  // A diff's last line ends with a newline: the empty piece after it is not a
  // line of the file, and would otherwise read as a blank context line.
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const hunks = [];
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  let added = 0;
  let removed = 0;
  let kept = 0;
  let binary = false;

  for (const line of lines) {
    // A second file's diff in the same text: its headers are not this file's.
    if (line.startsWith('diff --git') || line.startsWith('index ')) {
      hunk = null;
      continue;
    }
    if (line.startsWith('@@')) {
      const header = HUNK_HEADER.exec(line);
      if (!header) continue;
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      hunk = { lines: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      // Before the first hunk: "--- a/x", "+++ b/x", mode and rename headers,
      // and the one line git prints instead of a diff for a binary file.
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) binary = true;
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    const sign = line[0];
    if (sign === '+') {
      added++;
      if (kept < MAX_HUNK_LINES) {
        hunk.lines.push({ t: '+', text: clip(line.slice(1)), old: null, new: newNo });
        kept++;
      }
      newNo++;
    } else if (sign === '-') {
      removed++;
      if (kept < MAX_HUNK_LINES) {
        hunk.lines.push({ t: '-', text: clip(line.slice(1)), old: oldNo, new: null });
        kept++;
      }
      oldNo++;
    } else {
      // A context line. Its own leading space is the prefix; a tool that
      // trimmed an empty line leaves nothing behind.
      const body = sign === ' ' ? line.slice(1) : line;
      if (kept < MAX_HUNK_LINES) {
        hunk.lines.push({ t: ' ', text: clip(body), old: oldNo, new: newNo });
        kept++;
      }
      oldNo++;
      newNo++;
    }
  }

  const changed = hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.t !== ' ').length, 0);
  return { added, removed, hunks: hunks.filter((h) => h.lines.length), truncated: changed < added + removed, binary };
}

module.exports = { parseUnifiedDiff, addedFile, countLines, MAX_HUNK_LINES, MAX_LINE_CHARS };
