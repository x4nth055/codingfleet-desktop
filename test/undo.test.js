'use strict';
// Undoing a run: the file goes back to the version from before the run, a file
// the run created is removed again, and anything the user touched since is
// left alone unless they insist.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { revertRun, revertOne, blocked, changedSince } = require('../src/core/undo');

let dir;
test.beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-undo-'));
});
test.afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const file = (name) => path.join(dir, name);
const entry = (name, beforeText, afterText) => ({
  path: file(name),
  before: beforeText === null ? { exists: false, text: '' } : { exists: true, text: beforeText },
  after: afterText === null ? { exists: false, text: '' } : { exists: true, text: afterText },
});

test('an edited file goes back to the version from before the run', async () => {
  await fsp.writeFile(file('a.js'), 'new\n');
  const out = await revertRun([entry('a.js', 'old\n', 'new\n')]);
  assert.equal(out.restored.length, 1);
  assert.equal(out.skipped.length, 0);
  assert.equal(await fsp.readFile(file('a.js'), 'utf8'), 'old\n');
});

test('a file the run created is removed again', async () => {
  await fsp.writeFile(file('made.js'), 'generated\n');
  const out = await revertRun([entry('made.js', null, 'generated\n')]);
  assert.equal(out.restored[0].action, 'deleted');
  assert.equal(fs.existsSync(file('made.js')), false);
});

test('a file the run deleted is put back', async () => {
  const out = await revertRun([entry('gone.js', 'still here\n', null)]);
  assert.equal(out.restored[0].action, 'recreated');
  assert.equal(await fsp.readFile(file('gone.js'), 'utf8'), 'still here\n');
});

test('a file edited after the run is left alone, and says why', async () => {
  await fsp.writeFile(file('a.js'), 'my own change\n');
  const out = await revertRun([entry('a.js', 'old\n', 'new\n')]);
  assert.equal(out.restored.length, 0);
  assert.equal(out.conflicts, 1);
  assert.match(out.skipped[0].reason, /changed after the run/);
  // Untouched: the user's work survives.
  assert.equal(await fsp.readFile(file('a.js'), 'utf8'), 'my own change\n');
});

test('force puts it back anyway', async () => {
  await fsp.writeFile(file('a.js'), 'my own change\n');
  const out = await revertRun([entry('a.js', 'old\n', 'new\n')], { force: true });
  assert.equal(out.restored.length, 1);
  assert.equal(await fsp.readFile(file('a.js'), 'utf8'), 'old\n');
});

test('a binary or very large file is skipped, never guessed at', async () => {
  const big = { path: file('img.png'), before: { exists: true, text: null }, after: { exists: true, text: null } };
  assert.match(blocked(big), /no copy was kept/);
  await fsp.writeFile(file('img.png'), 'whatever');
  const out = await revertRun([big]);
  assert.equal(out.restored.length, 0);
  assert.equal(out.skipped.length, 1);
  assert.equal(await fsp.readFile(file('img.png'), 'utf8'), 'whatever');
});

test('a half-written entry is skipped rather than throwing', async () => {
  const out = await revertRun([{ path: file('x.js'), before: { exists: true, text: 'a' } }]);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /did not finish/);
});

test('restoring nested paths recreates the folders', async () => {
  const nested = {
    path: path.join(dir, 'deep', 'in', 'here.js'),
    before: { exists: true, text: 'root\n' },
    after: { exists: false, text: '' },
  };
  const out = await revertRun([nested]);
  assert.equal(out.restored.length, 1);
  assert.equal(await fsp.readFile(nested.path, 'utf8'), 'root\n');
});

test('changedSince spots both edits and deletions', () => {
  assert.equal(changedSince({ exists: true, text: 'a' }, { exists: true, text: 'a' }), false);
  assert.equal(changedSince({ exists: true, text: 'b' }, { exists: true, text: 'a' }), true);
  assert.equal(changedSince({ exists: false, text: '' }, { exists: true, text: 'a' }), true);
});

test('one bad entry does not stop the others', async () => {
  await fsp.writeFile(file('ok.js'), 'new\n');
  const out = await revertRun([
    { path: file('bad.js'), before: { exists: true, text: null }, after: { exists: true, text: null } },
    entry('ok.js', 'old\n', 'new\n'),
  ]);
  assert.equal(out.restored.length, 1);
  assert.equal(out.skipped.length, 1);
  assert.equal(await fsp.readFile(file('ok.js'), 'utf8'), 'old\n');
});

test('revertOne reports the file it acted on', async () => {
  await fsp.writeFile(file('a.js'), 'new\n');
  const result = await revertOne(entry('a.js', 'old\n', 'new\n'));
  assert.equal(result.ok, true);
  assert.equal(result.path, file('a.js'));
});
