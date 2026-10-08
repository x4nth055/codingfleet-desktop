'use strict';
// The composer's @ mentions: where one is typed, what it matches, the text after.
const assert = require('node:assert/strict');
const test = require('node:test');

const { mentionAt, rankPaths, insertMention } = require('../src/renderer/lib/mention');

test('an @ starts a mention at the start or after a space, never inside a word', () => {
  assert.deepEqual(mentionAt('@src', 4), { start: 0, end: 4, query: 'src', quoted: false });
  assert.deepEqual(mentionAt('look at @src/ap', 15), { start: 8, end: 15, query: 'src/ap', quoted: false });
  assert.deepEqual(mentionAt('fix @', 5), { start: 4, end: 5, query: '', quoted: false });
  assert.deepEqual(mentionAt('(@lib', 5), { start: 1, end: 5, query: 'lib', quoted: false });
  assert.equal(mentionAt('mail me@example.com', 19), null);
  assert.equal(mentionAt('@src done', 9), null, 'a space ends it');
  assert.equal(mentionAt('', 0), null);
});

test('the caret in the middle of a mention covers the whole word', () => {
  // "@src/app.js" with the caret after "@src/a"
  assert.deepEqual(mentionAt('see @src/app.js now', 10), { start: 4, end: 15, query: 'src/a', quoted: false });
});

test('a quoted mention may hold spaces', () => {
  assert.deepEqual(mentionAt('open @"my do', 12), { start: 5, end: 12, query: 'my do', quoted: true });
  assert.deepEqual(mentionAt('open @"my doc.md" please', 9), { start: 5, end: 17, query: 'my', quoted: true });
});

const ENTRIES = [
  'src/', 'src/renderer/', 'src/renderer/app/', 'test/', 'docs/',
  'README.md', 'package.json', 'src/main.js', 'src/renderer/app/08-composer.js',
  'src/renderer/lib/mention.js', 'test/mention.test.js', 'src/renderer/index.html',
];

test('an empty query lists the top of the folder, folders first', () => {
  assert.deepEqual(rankPaths(ENTRIES, ''), ['docs/', 'src/', 'test/', 'package.json', 'README.md']);
});

test('a folder query lists what is directly inside it', () => {
  assert.deepEqual(rankPaths(ENTRIES, 'src/'), ['src/renderer/', 'src/main.js']);
  assert.deepEqual(rankPaths(ENTRIES, 'SRC/renderer/'), ['src/renderer/app/', 'src/renderer/index.html']);
});

test('names that start with the query come first, then names and paths that hold it', () => {
  const found = rankPaths(ENTRIES, 'mention');
  assert.deepEqual(found.slice(0, 2), ['src/renderer/lib/mention.js', 'test/mention.test.js']);
  assert.equal(rankPaths(ENTRIES, 'composer')[0], 'src/renderer/app/08-composer.js');
  assert.equal(rankPaths(ENTRIES, 'readme')[0], 'README.md');
});

test('letters in order match loosely, and nothing matches nothing', () => {
  assert.equal(rankPaths(ENTRIES, 'rndidx')[0], 'src/renderer/index.html');
  assert.deepEqual(rankPaths(ENTRIES, 'zzz'), []);
  assert.equal(rankPaths(ENTRIES, 'js', 3).length, 3);
});

test('a picked file is followed by a space; a picked folder stays open', () => {
  const text = 'fix @comp please';
  const mention = mentionAt(text, 9);
  assert.deepEqual(insertMention(text, mention, 'src/renderer/app/08-composer.js'),
    { text: 'fix @src/renderer/app/08-composer.js please', caret: 37 });
  const open = mentionAt('look @sr', 8);
  assert.deepEqual(insertMention('look @sr', open, 'src/'), { text: 'look @src/', caret: 10 });
  const end = mentionAt('look @ma', 8);
  assert.deepEqual(insertMention('look @ma', end, 'src/main.js'), { text: 'look @src/main.js ', caret: 18 });
});

test('a path with spaces is quoted', () => {
  const text = '@my';
  assert.deepEqual(insertMention(text, mentionAt(text, 3), 'my notes.md'), { text: '@"my notes.md" ', caret: 15 });
  assert.deepEqual(insertMention(text, mentionAt(text, 3), 'my docs/'), { text: '@"my docs/', caret: 10 });
  // And the folder's contents are offered next, inside the quotes.
  assert.equal(mentionAt('@"my docs/', 10).query, 'my docs/');
});
