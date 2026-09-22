'use strict';
// Reading git's own diff output: the counts the composer shows, and the hunks
// the changes list draws.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseUnifiedDiff, addedFile, countLines } = require('../src/core/git-diff');

const DIFF = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,4 +1,6 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' ',
  ' export { a, b };',
  '@@ -20,3 +22,2 @@',
  ' keep();',
  '-gone();',
  ' }\n',
].join('\n');

test('a unified diff counts what it adds and removes', () => {
  const diff = parseUnifiedDiff(DIFF);
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 2);
  assert.equal(diff.truncated, false);
  assert.equal(diff.binary, false);
  assert.equal(diff.hunks.length, 2);
  assert.deepEqual(diff.hunks[0].lines.map((l) => l.t), [' ', '-', '+', '+', ' ', ' ']);
});

test('line numbers follow the file on both sides of the change', () => {
  const [first, second] = parseUnifiedDiff(DIFF).hunks;
  assert.deepEqual(first.lines.slice(0, 4), [
    { t: ' ', text: 'const a = 1;', old: 1, new: 1 },
    { t: '-', text: 'const b = 2;', old: 2, new: null },
    { t: '+', text: 'const b = 3;', old: null, new: 2 },
    { t: '+', text: 'const c = 4;', old: null, new: 3 },
  ]);
  assert.equal(second.lines[0].old, 20);
  assert.equal(second.lines[0].new, 22);
  assert.deepEqual(second.lines[1], { t: '-', text: 'gone();', old: 21, new: null });
});

test('file headers and "no newline" markers are not changes', () => {
  const diff = parseUnifiedDiff([
    'diff --git a/x b/x',
    '--- a/x',
    '+++ b/x',
    '@@ -1 +1 @@',
    '-one',
    '\\ No newline at end of file',
    '+two',
    '\\ No newline at end of file',
  ].join('\n'));
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.hunks[0].lines.map((l) => l.text), ['one', 'two']);
});

test('a hunk with no count in its header is read the same way', () => {
  const diff = parseUnifiedDiff('@@ -1 +1 @@\n-a\n+b');
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.hunks[0].lines[1].old, null);
});

test('a very large change says it was cut, and still counts every line', () => {
  const lines = ['--- a/big', '+++ b/big', `@@ -0,0 +1,${6000} @@`];
  for (let i = 0; i < 6000; i++) lines.push(`+line ${i}`);
  const diff = parseUnifiedDiff(lines.join('\n'));
  assert.equal(diff.added, 6000);
  assert.equal(diff.truncated, true);
  assert.equal(diff.hunks[0].lines.length, 4000);
});

test('a binary file has no hunks and says so', () => {
  const diff = parseUnifiedDiff([
    'diff --git a/logo.png b/logo.png',
    'index 1111111..2222222 100644',
    'Binary files a/logo.png and b/logo.png differ',
  ].join('\n'));
  assert.equal(diff.binary, true);
  assert.deepEqual(diff.hunks, []);
  assert.equal(diff.added, 0);
});

test('two diffs pasted together keep their hunks apart', () => {
  const diff = parseUnifiedDiff(`${DIFF}\n${DIFF}`);
  assert.equal(diff.added, 4);
  assert.equal(diff.removed, 4);
  assert.equal(diff.hunks.length, 4);
});

test('a file git does not track yet is all additions', () => {
  const diff = addedFile('one\ntwo\nthree\n');
  assert.equal(diff.added, 3);
  assert.equal(diff.removed, 0);
  assert.deepEqual(diff.hunks[0].lines.map((l) => l.new), [1, 2, 3]);
  assert.deepEqual(diff.hunks[0].lines[0], { t: '+', text: 'one', old: null, new: 1 });
});

test('an empty or missing file adds nothing', () => {
  assert.equal(addedFile('').added, 0);
  assert.deepEqual(addedFile('').hunks, []);
  assert.equal(addedFile(null).added, 0);
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\r\nb\r\n'), 2);
});
