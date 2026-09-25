'use strict';
// The window's pure pieces: formatting, and the words for tools and approvals.
const assert = require('node:assert/strict');
const test = require('node:test');

const fmt = require('../src/renderer/lib/format');
const words = require('../src/renderer/lib/tool-words');
const guard = require('../src/core/guard');

test('numbers and durations read the way the window shows them', () => {
  assert.equal(fmt.fmtCompact(213300), '213.3k');
  assert.equal(fmt.fmtCompact(400000), '400k');
  assert.equal(fmt.fmtCompact(1057587), '1.06M');
  assert.equal(fmt.fmtCompact(999950), '1M');
  assert.equal(fmt.fmtCompact(-1500), '-1.5k');
  assert.equal(fmt.fmtCompact(12), '12');
  assert.equal(fmt.fmtTokens(null), '0 tokens');
  assert.equal(fmt.fmtDuration(9), '9s');
  assert.equal(fmt.fmtDuration(80), '1m 20s');
  assert.equal(fmt.fmtDuration(5435), '1h 30m 35s');
  assert.equal(fmt.fmtNum(null), '—');
});

test('paths, lines and clipping', () => {
  assert.equal(fmt.baseName('C:\\work\\demo\\'), 'demo');
  assert.equal(fmt.baseName('/home/u/project'), 'project');
  assert.equal(fmt.firstLine('one\ntwo'), 'one');
  assert.equal(fmt.firstLine(null), '');
  assert.equal(fmt.lineCount('a\nb\nc'), 3);
  assert.equal(fmt.lineCount(''), 0);
  assert.equal(fmt.clipText('abcdef', 3), 'abc\n… 3 more characters');
  assert.equal(fmt.clipText('abc', 3), 'abc');
});

test('dates fall into the sidebar groups', () => {
  const now = new Date();
  const daysAgo = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 12).toISOString();
  assert.equal(fmt.groupOf(daysAgo(0)), 'Today');
  assert.equal(fmt.groupOf(daysAgo(1)), 'Yesterday');
  assert.equal(fmt.groupOf(daysAgo(5)), 'Previous 7 days');
  assert.equal(fmt.groupOf(daysAgo(30)), 'Older');
  assert.match(fmt.fmtStamp(daysAgo(0)), /^Today /);
  assert.equal(fmt.fmtStamp('not a date'), '');
  assert.equal(fmt.relTime(new Date().toISOString()), 'now');
});

test('each tool call has a verb and its subject', () => {
  const summary = (name, args) => words.toolSummary({ name, arguments: args });
  assert.deepEqual(summary('run_command', { command: 'npm test' }), ['Run', 'npm test']);
  assert.deepEqual(summary('run_command', { command: 'npm run dev', background: true }), ['Run in background', 'npm run dev']);
  assert.deepEqual(summary('read_background', { id: 'bg_1' }), ['Read background output', 'bg_1']);
  assert.deepEqual(summary('take_screenshot', {}), ['Take a screenshot', 'the screen']);
  assert.deepEqual(summary('local_github_list_issues', { repo: 'x/y' }), ['Local MCP: github list issues', 'x/y']);
  assert.deepEqual(summary('some_new_tool', { q: 'hi' }), ['some new tool', 'hi']);
});

test('a group of calls is summed up once per kind, and one file read twice counts once', () => {
  const call = (name, args = {}) => ({ name, arguments: args });
  assert.equal(words.groupSummary([call('fs_read', { path: 'a' }), call('fs_read', { path: 'a' }),
    call('fs_read', { path: 'b' }), call('run_command')]), 'Read 2 files, ran 1 command');
  assert.equal(words.groupSummary([call('web_search'), call('web_search')]), 'Searched the web 2 times');
  assert.equal(words.groupSummary([call('web_search')]), 'Searched the web');
  assert.equal(words.groupSummary([call('mystery')]), 'Used 1 tool');
});

test('the window asks about exactly what the guard says must always be asked about', () => {
  assert.deepEqual([...words.ALWAYS_ASKED].sort(), [...guard.ALWAYS_ASK].sort());
  for (const reason of [guard.SECRETS, guard.DESTRUCTIVE, guard.REMOTE_SCRIPT]) {
    assert.ok(words.REASONS[reason], `no words for "${reason}"`);
  }
  // Only what may be allowed for a session has an "allow all" label.
  assert.ok(words.ALLOW_LABELS[guard.SECRETS]);
  for (const reason of guard.ALWAYS_ASK) assert.equal(words.ALLOW_LABELS[reason], undefined, reason);
});
