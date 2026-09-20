'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { diffLines } = require('../src/core/diff');

const changes = (d) => d.hunks.flatMap((h) => h.lines.filter((l) => l.t !== ' ').map((l) => `${l.t}${l.text}`));

test('a new file is all additions', () => {
  const d = diffLines('', 'one\ntwo\n');
  assert.equal(d.added, 2);
  assert.equal(d.removed, 0);
  assert.deepEqual(changes(d), ['+one', '+two']);
  assert.deepEqual(d.hunks[0].lines.map((l) => l.new), [1, 2]);
});

test('an edited line is one removal and one addition, with context and line numbers', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\n';
  const after = 'a\nb\nc\nD\ne\nf\ng\n';
  const d = diffLines(before, after);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.deepEqual(changes(d), ['-d', '+D']);
  const lines = d.hunks[0].lines;
  assert.deepEqual(lines.map((l) => l.text), ['a', 'b', 'c', 'd', 'D', 'e', 'f', 'g']);
  const removed = lines.find((l) => l.t === '-');
  const added = lines.find((l) => l.t === '+');
  assert.equal(removed.old, 4);
  assert.equal(removed.new, null);
  assert.equal(added.new, 4);
});

test('distant changes become separate hunks', () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 2', 'LINE 2').replace('line 27', 'LINE 27');
  const d = diffLines(before, after);
  assert.equal(d.hunks.length, 2);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 2);
});

test('unchanged text has no hunks; CRLF and LF are the same text', () => {
  assert.deepEqual(diffLines('x\ny\n', 'x\ny\n').hunks, []);
  const d = diffLines('x\r\ny\r\n', 'x\ny\n');
  assert.equal(d.added + d.removed, 0);
});

test('inserted lines are aligned, not rewritten', () => {
  const d = diffLines('import os\n\ndef main():\n    pass\n', 'import os\nimport sys\n\ndef main():\n    print(sys.argv)\n    pass\n');
  assert.deepEqual(changes(d), ['+import sys', '+    print(sys.argv)']);
});
