'use strict';
// Where a message sent while the agent works (a steer) sits in the answer
// (src/renderer/lib/steer-place.js), and the history drawn with it
// (fromHistory, src/renderer/app/09-navigation.js).
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const steer = require('../src/renderer/lib/steer-place');

const { snapSteerOffset: snap } = steer;

test('a steer never cuts a paragraph: it moves on to the next blank line', () => {
  const text = 'First paragraph here.\n\nSecond one.';
  assert.equal(snap(text, 0), 0);           // the start splits nothing
  assert.equal(snap(text, 5), 21);
  assert.equal(snap(text, 21), 21);
  assert.equal(snap(text, 22), 23);         // directly after it
  assert.equal(snap(text, 23), 23);
  assert.equal(snap(text, 24), text.length); // the end of the text
  assert.equal(snap(text, 999), text.length);
  assert.equal(snap(text, -4), 0);
  assert.equal(snap('', 3), 0);
  assert.equal(snap('No break at all', 3), 15);
});

test('a steer inside a code block moves past the line that closes it', () => {
  const text = 'Run this:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\nThen this.\n\nDone.';
  const blank = text.indexOf('1;\n\n') + 2; // a blank line inside the block
  const close = text.indexOf('```\nThen') + 3;
  assert.equal(snap(text, blank), close);
  assert.equal(snap(text, text.indexOf('const a')), close);
  // Before the block: the blank line before it is a fine place.
  assert.equal(snap(text, 2), 9);
  assert.equal(snap(text, 10), 11);
  // After the block is closed, blank lines count again.
  assert.equal(snap(text, close + 1), text.indexOf('\n\nDone.'));
});

test('a code block that is never closed takes the steer to the end', () => {
  const text = 'Here:\n\n~~~\nline\n\nmore';
  assert.equal(snap(text, 9), text.length);
  // Fences may be indented a little, as in a list.
  const listed = '- step:\n\n   ```\n   a\n\n   b\n   ```\n\nnext';
  assert.equal(snap(listed, listed.indexOf('a\n\n') + 2), listed.indexOf('```\n\nnext') + 3);
});

test('an answer is cut at its tools, as before, when nothing was sent into it', () => {
  const text = 'Reading.Found it.';
  const pieces = steer.answerPieces(text, [{ text_offset: 8 }, { text_offset: 8 }, {}], []);
  assert.deepEqual(pieces, [
    { type: 'text', text: 'Reading.' }, { type: 'tool', index: 0 }, { type: 'tool', index: 1 },
    { type: 'tool', index: 2 }, { type: 'text', text: 'Found it.' },
  ]);
  // An older turn: no offsets, its tools first.
  assert.deepEqual(steer.answerPieces('All done.', [{}, {}], []).map((p) => p.type), ['tool', 'tool', 'text']);
});

test('a steer sits at its snapped place, after the tools called before it', () => {
  const text = 'One two.\n\nThree.\n\nFour.';
  const tools = [{ text_offset: 8 }, { text_offset: 16 }];
  // Sent at offset 12 ("Th|ree"), with one tool called: after "Three.", before the second tool.
  const pieces = steer.answerPieces(text, tools, [{ text_offset: 12, after_tools: 1 }]);
  assert.deepEqual(pieces, [
    { type: 'text', text: 'One two.' }, { type: 'tool', index: 0 }, { type: 'text', text: 'Three.' },
    { type: 'steer', index: 0, at: 16, after: 1 }, { type: 'tool', index: 1 }, { type: 'text', text: 'Four.' },
  ]);
});

test('a steer between two tools called together splits them', () => {
  const pieces = steer.answerPieces('Look.Done.', [{ text_offset: 5 }, { text_offset: 5 }], [
    { text_offset: 5, after_tools: 1 },
  ]);
  assert.deepEqual(pieces.map((p) => p.type), ['text', 'tool', 'steer', 'tool', 'text']);
});

test('a steer does not go past the first tool after it, where the text is cut already', () => {
  // Snapping offset 3 would go to the end; the next tool is at 9.
  const pieces = steer.answerPieces('Long text with no break', [{ text_offset: 9 }], [
    { text_offset: 3, after_tools: 0 },
  ]);
  assert.deepEqual(pieces, [
    { type: 'text', text: 'Long text' }, { type: 'steer', index: 0, at: 9, after: 0 },
    { type: 'tool', index: 0 }, { type: 'text', text: 'with no break' },
  ]);
});

test('a steer with no place goes first; several keep their order', () => {
  const text = 'A.\n\nB.\n\nC.';
  const pieces = steer.answerPieces(text, [{ text_offset: 2 }], [
    null, { text_offset: 5, after_tools: 1 }, { text_offset: 0, after_tools: 0 }, { text_offset: 7, after_tools: 1 },
  ]);
  assert.deepEqual(pieces.map((p) => (p.type === 'text' ? p.text : `${p.type}${p.index ?? ''}${p.top ? ' top' : ''}`)),
    ['steer0 top', 'steer2', 'A.', 'tool0', 'B.', 'steer1', 'steer3', 'C.']);
  // A place the server could not give (a bad value) is no place.
  assert.equal(steer.answerPieces('x', [], [{ text_offset: '3', after_tools: 0 }])[0].top, true);
  assert.equal(steer.answerPieces('x', [], [{ text_offset: 1 }])[0].top, true);
});

test('a steer after every tool, at the end of the answer', () => {
  const pieces = steer.answerPieces('Done.', [{ text_offset: 0 }], [{ text_offset: 5, after_tools: 4 }]);
  assert.deepEqual(pieces.map((p) => p.type), ['tool', 'text', 'steer']);
});

test('a live answer: steers held for a replay go back where they were sent', () => {
  const flow = {};
  const out = [];
  const write = (t) => out.push(t);
  const put = (item) => out.push(`[${item.text}]`);
  steer.feedText(flow, 'Hello ', write, put);
  steer.feedTool(flow, put);
  assert.deepEqual(steer.livePlace(flow), { text: 6, tools: 1 });
  const items = [{ type: 'assistant', text: 'Hello ' }, { type: 'tools' },
    { type: 'user', text: 'b', steer: true, place: { text: 14, tools: 1 } },
    { type: 'user', text: 'a', steer: true, place: { text: 6, tools: 1 } },
    { type: 'user', text: 'prompt' }];
  steer.holdSteers(flow, items);
  assert.deepEqual(flow.heldSteers.map((i) => i.text), ['a', 'b']);
  assert.deepEqual(steer.livePlace(flow), { text: 0, tools: 0 });
  out.length = 0;
  steer.feedText(flow, 'Hello world', write, put);   // not before the tool
  steer.feedTool(flow, put);
  steer.feedText(flow, 'Again', write, put);
  assert.deepEqual(out, ['Hello world', '[a]', 'Aga', '[b]', 'in']);
  // Not reached: put at the end.
  steer.holdSteers(flow, [{ type: 'user', text: 'c', steer: true, place: { text: 99, tools: 0 } }]);
  steer.feedText(flow, 'x', write, put);
  steer.flushSteers(flow, put);
  assert.deepEqual(out.slice(-2), ['x', '[c]']);
  // No flow: the text is only written.
  steer.feedText(null, 'plain', write, put);
  assert.equal(out.at(-1), 'plain');
});

// ── The history, drawn ─────────────────────────────────────────────────────
function navigation() {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app/09-navigation.js'), 'utf8');
  const context = {
    CF_STEER: steer,
    S: {},
    document: { addEventListener: () => {} },
    splitReferences: (text) => ({ text: String(text || ''), refs: [] }),
    agentsOf: () => new Map(),
    ensureAgent: () => {},
    markPhoneMessages: () => {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

// (Made in this realm: the window's arrays are compared by value.)
const shown = (items) => Array.from(items, (i) => (i.type === 'user' ? `${i.steer ? 'steer' : 'you'}: ${i.text}`
  : i.type === 'assistant' ? i.text : i.type === 'tools' ? `tools(${i.tools.length})` : i.type));

test('the history puts each steer inside the answer, where it was sent', () => {
  const nav = navigation();
  const items = nav.fromHistory('s1', [
    { role: 'user', text: 'Fix the bug', created_at: '2026-11-23T10:00:00Z',
      steers: ['old one', 'and the tests'], steer_places: [null, { text_offset: 14, after_tools: 1 }] },
    { role: 'assistant', created_at: '2026-11-23T10:00:05Z', text: 'Reading.Found it.\n\nFixed.',
      tools: [{ name: 'fs_read', text_offset: 8, ok: true }, { name: 'fs_edit', text_offset: 19, ok: true }],
      model: 'm1' },
  ]);
  assert.deepEqual(shown(items), [
    'you: Fix the bug', 'steer: old one', 'stamp', 'Reading.', 'tools(1)', 'Found it.',
    'steer: and the tests', 'tools(1)', 'Fixed.', 'footer',
  ]);
  // Not a turn: the turn counters skip them.
  const tools = require('../src/renderer/lib/session-tools');
  assert.equal(tools.turnsFrom(items, 0), 1);
  assert.deepEqual({ ...items[6].place }, { text: 17, tools: 1 });
});

test('the history without places, or a prompt with no answer yet, keeps steers under the prompt', () => {
  const nav = navigation();
  const items = nav.fromHistory('s1', [
    { role: 'user', text: 'One', steers: ['a'] },
    { role: 'assistant', text: 'Done.', tools: [{ name: 'fs_read', text_offset: 0, ok: true }] },
    { role: 'user', text: 'Two', steers: ['b'], steer_places: [{ text_offset: 0, after_tools: 0 }] },
  ]);
  assert.deepEqual(shown(items), ['you: One', 'steer: a', 'tools(1)', 'Done.', 'you: Two', 'steer: b']);
});

test('a rebuild keeps the turn this window drew, its steer included, once', () => {
  const nav = navigation();
  const drawn = [
    { type: 'assistant', text: 'Working on it.' },
    { type: 'user', text: 'and the docs', steer: true, place: { text: 14, tools: 0 } },
    { type: 'assistant', text: 'Docs too. All done.' },
  ];
  vm.runInContext('(own) => ownTurns.set("s1", own)', nav)({ text: 'Working on it.Docs too. All done.', items: drawn });
  const items = nav.rebuiltTranscript('s1', { messages: [
    { role: 'user', text: 'Do it', steers: ['and the docs'], steer_places: [{ text_offset: 14, after_tools: 0 }] },
    { role: 'assistant', text: 'Working on it.Docs too. All done.' },
  ] });
  assert.deepEqual(shown(items), ['you: Do it', 'Working on it.', 'steer: and the docs', 'Docs too. All done.']);
  assert.equal(items[2], drawn[1]);
});
