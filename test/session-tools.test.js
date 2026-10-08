'use strict';
// Sessions and their transcripts: cost, search, recent folders, Markdown.
const assert = require('node:assert/strict');
const test = require('node:test');

const tools = require('../src/renderer/lib/session-tools');

const ITEMS = [
  { type: 'user', text: 'Add a test' },
  { type: 'stamp', at: '2026-10-08T10:00:00Z' },
  { type: 'assistant', text: 'Reading the code first.' },
  { type: 'tools', tools: [
    { name: 'fs_read', arguments: { path: 'src/a.js' }, status: 'done' },
    { name: 'run_command', arguments: { command: 'npm test' }, status: 'failed' },
  ] },
  { type: 'assistant', text: 'Done: the test passes.' },
  { type: 'files', files: [{ path: 'test/a.test.js', added: 10, removed: 0 }] },
  { type: 'footer', model: 'm1', modelName: 'Model One', usage: { credits: 12.5 } },
  { type: 'user', text: 'Thanks' },
  { type: 'user', text: 'and the docs', steer: true },
  { type: 'assistant', text: 'You are welcome.' },
  { type: 'footer', model: 'm1', usage: { credits: 0 } },
  { type: 'footer', note: 'Stopped' },
];

test('a session costs what its footers say, and runs without a price are not counted', () => {
  assert.deepEqual(tools.sessionSpend(ITEMS), { credits: 12.5, runs: 2 });
  assert.deepEqual(tools.sessionSpend([]), { credits: 0, runs: 0 });
  assert.deepEqual(tools.sessionSpend([{ type: 'footer', usage: { credits: 0.1 } }, { type: 'footer', usage: { credits: 0.2 } }]),
    { credits: 0.3, runs: 2 });
});

test('a search matches every word, anywhere in the names, ignoring case', () => {
  assert.equal(tools.sessionMatches('', ['x']), true);
  assert.equal(tools.sessionMatches('fix LOGIN', ['Fix the login bug', 'webapp']), true);
  assert.equal(tools.sessionMatches('fix webapp', ['Fix the login bug', 'webapp']), true);
  assert.equal(tools.sessionMatches('fix api', ['Fix the login bug', 'webapp']), false);
  assert.equal(tools.sessionMatches('work', [null, 'C:\\work\\app']), true);
});

test('recent folders: newest first, each once, without the excluded one', () => {
  const uses = [
    { cwd: 'C:\\a', at: 1 }, { cwd: 'C:\\b', at: 5 }, { cwd: 'c:\\A\\', at: 9 }, { cwd: 'C:\\c', at: 3 }, { cwd: null, at: 99 },
  ];
  assert.deepEqual(tools.recentFolders(uses), ['c:\\A\\', 'C:\\b', 'C:\\c']);
  assert.deepEqual(tools.recentFolders(uses, { exclude: ['C:\\b'] }), ['c:\\A\\', 'C:\\c']);
  assert.deepEqual(tools.recentFolders(uses, { limit: 1 }), ['c:\\A\\']);
});

test("a turn's answer is every paragraph since its prompt, steers included", () => {
  assert.equal(tools.turnText(ITEMS, 6), 'Reading the code first.\n\nDone: the test passes.');
  assert.equal(tools.turnText(ITEMS, 10), 'You are welcome.');
  assert.equal(tools.turnText([], 0), '');
});

test('a conversation exports as Markdown with who said what and what was done', () => {
  const md = tools.transcriptMarkdown({ title: 'Add a test', folder: 'C:\\work', exportedAt: 'today', items: ITEMS });
  assert.match(md, /^# Add a test\n\nFolder: `C:\\work`  \nExported: today\n\n## You\n\nAdd a test\n\n## CodingFleet\n\nReading the code first\./);
  assert.match(md, /\*Read 1 file, ran 1 command\*\n- Read `src\/a\.js`\n- Run `npm test` \(failed\)/);
  assert.match(md, /\*Edited 1 file: `test\/a\.test\.js`\*/);
  assert.match(md, /\*Model One · 12\.5 credits\*/);
  assert.match(md, /## You \(while it worked\)\n\nand the docs\n\n## CodingFleet\n\nYou are welcome\./);
  assert.match(md, /\*Stopped\*\n$/);
  assert.doesNotMatch(md, /\n{3,}/);
});

test('an exported file name is safe on every system', () => {
  assert.equal(tools.exportFileName('Fix: a/b <c>?'), 'Fix a b c.md');
  assert.equal(tools.exportFileName('   '), 'session.md');
  assert.equal(tools.exportFileName('ends with dots...'), 'ends with dots.md');
});
