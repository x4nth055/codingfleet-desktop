'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RecoveryStore, INLINE_CHARS } = require('../src/core/recovery-store');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cf-recovery-'));
const copiesIn = (dir) => {
  try { return fs.readdirSync(path.join(dir, 'run-recovery-copies')).sort(); } catch { return []; }
};
const big = (char) => char.repeat(INLINE_CHARS * 50);

test('a restart retains uncertain tool state and completed undo copies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-recovery-'));
  try {
    const file = path.join(dir, 'run-recovery.json');
    const first = new RecoveryStore(file);
    first.start('session', dir);
    first.setRunId('session', 'run');
    first.setCall('session', 'call', { state: 'executing' });
    first.setChange('session', path.join(dir, 'edited.txt'), {
      before: { exists: true, text: 'before' }, after: { exists: true, text: 'after' },
    });
    const reopened = new RecoveryStore(file);
    assert.equal(reopened.active('session').runId, 'run');
    assert.equal(reopened.call('session', 'call').state, 'executing');
    reopened.finish('session', 'run', Object.entries(reopened.active('session').changes)
      .map(([name, change]) => ({ path: name, ...change })));
    const later = new RecoveryStore(file);
    assert.equal(later.active('session'), null);
    assert.equal(later.data.undo.run.files[0].before.text, 'before');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('file versions live beside the journal, so each step writes a small journal', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'run-recovery.json');
    const store = new RecoveryStore(file);
    store.start('session', dir);
    for (let i = 0; i < 20; i++) {
      store.setChange('session', path.join(dir, `f${i}.js`), {
        before: { exists: true, text: big(String.fromCharCode(97 + i)) },
        after: { exists: true, text: `${big(String.fromCharCode(97 + i))}!` },
      });
    }
    const written = fs.statSync(file).size;
    store.setCall('session', 'call', { state: 'executing' });
    assert.ok(fs.statSync(file).size < 20_000, `the journal stays small (${fs.statSync(file).size} bytes)`);
    assert.ok(written < 20_000);
    assert.equal(copiesIn(dir).length, 40, 'one copy per version');

    const reopened = new RecoveryStore(file);
    const change = reopened.active('session').changes[path.join(dir, 'f3.js')];
    assert.equal(change.before.text, big('d'));
    assert.equal(change.after.text, `${big('d')}!`);
    assert.equal(change.before.exists, true);
    assert.equal(reopened.call('session', 'call').state, 'executing');

    // Saving again names the same copies, without reading or writing them.
    reopened.setCall('session', 'another', { state: 'received' });
    assert.equal(copiesIn(dir).length, 40);
    assert.equal(new RecoveryStore(file).active('session').changes[path.join(dir, 'f9.js')].after.text, `${big('j')}!`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a version is read from its copy when asked for, not at start', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'run-recovery.json');
    const target = path.join(dir, 'a.js');
    const first = new RecoveryStore(file);
    first.start('session', dir);
    first.setChange('session', target, { before: { exists: true, text: big('a') }, after: { exists: true, text: big('b') } });
    const [copy] = copiesIn(dir).filter((name) => {
      const text = fs.readFileSync(path.join(dir, 'run-recovery-copies', name), 'utf8');
      return text === big('a');
    });
    const reopened = new RecoveryStore(file);
    fs.writeFileSync(path.join(dir, 'run-recovery-copies', copy), 'read late');
    assert.equal(reopened.active('session').changes[target].before.text, 'read late');

    // Text replaced on a version read back: it gets a copy of its own.
    const change = reopened.active('session').changes[target];
    change.after.text = big('c');
    reopened.setChange('session', target, change);
    assert.equal(new RecoveryStore(file).active('session').changes[target].after.text, big('c'));
    assert.equal(copiesIn(dir).length, 2, 'the replaced copy is gone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a version replaced by a newer one, or no longer undoable, is deleted', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'run-recovery.json');
    const store = new RecoveryStore(file);
    store.start('session', dir);
    const target = path.join(dir, 'a.js');
    const change = { before: { exists: true, text: big('a') } };
    store.setChange('session', target, change);
    change.after = { exists: true, text: big('b') };
    store.setChange('session', target, change);
    change.after = { exists: true, text: big('c') };
    store.setChange('session', target, change);
    assert.equal(copiesIn(dir).length, 2, 'the first version and the newest one');

    store.finish('session', 'run', [{ path: target, ...change }]);
    assert.equal(copiesIn(dir).length, 2, 'undo keeps them');
    const later = new RecoveryStore(file);
    assert.equal(later.data.undo.run.files[0].before.text, big('a'));
    assert.equal(later.data.undo.run.files[0].after.text, big('c'));

    later.removeUndo('run');
    assert.deepEqual(copiesIn(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('two versions with the same text share one copy, and keep it while either is named', () => {
  const dir = tempDir();
  try {
    const store = new RecoveryStore(path.join(dir, 'run-recovery.json'));
    store.start('one', dir);
    store.start('two', dir);
    store.setChange('one', path.join(dir, 'a.js'), { before: { exists: true, text: big('x') } });
    store.setChange('two', path.join(dir, 'b.js'), { before: { exists: true, text: big('x') } });
    assert.equal(copiesIn(dir).length, 1);
    store.finish('one', null, []);
    assert.equal(copiesIn(dir).length, 1, 'still named by the other run');
    store.finish('two', null, []);
    assert.deepEqual(copiesIn(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a journal written with the text inside still loads, and a lost copy reads as unknown', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'run-recovery.json');
    const target = path.join(dir, 'a.js');
    fs.writeFileSync(file, JSON.stringify({ active: { session: {
      sessionId: 'session', cwd: dir, runId: 'run', calls: {},
      changes: { [target]: { before: { exists: true, text: big('o') }, after: { exists: true, text: 'new' } } },
    } } }));
    fs.writeFileSync(path.join(dir, 'run-recovery-undo.json'), JSON.stringify({ undo: { old: {
      sessionId: 'session', at: 1, files: [{ path: target, before: { exists: true, copy: 'f'.repeat(64) }, after: { exists: true, text: 'x' } }],
    } } }));
    const store = new RecoveryStore(file);
    assert.equal(store.active('session').changes[target].before.text, big('o'));
    assert.equal(store.data.undo.old.files[0].before.text, null, 'a copy that is gone');
    store.setRunId('session', 'run2');
    assert.equal(copiesIn(dir).length, 1, 'written as a copy from now on');
    assert.equal(new RecoveryStore(file).active('session').changes[target].before.text, big('o'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('copies no journal names are cleared at start, unless the journal could not be read', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'run-recovery.json');
    const copies = path.join(dir, 'run-recovery-copies');
    fs.mkdirSync(copies);
    fs.writeFileSync(path.join(copies, `${'a'.repeat(64)}.txt`), 'orphan');
    fs.writeFileSync(path.join(copies, `${'b'.repeat(64)}.txt.123.tmp`), 'half');
    fs.writeFileSync(file, '{ not json');
    new RecoveryStore(file);
    assert.deepEqual(copiesIn(dir), [`${'a'.repeat(64)}.txt`], 'kept while the journal is unreadable');
    fs.writeFileSync(file, JSON.stringify({ active: {} }));
    new RecoveryStore(file);
    assert.deepEqual(copiesIn(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('undo after a restart puts a file back from its copy', async () => {
  const { revertRun } = require('../src/core/undo');
  const dir = tempDir();
  try {
    const file = path.join(dir, 'run-recovery.json');
    const target = path.join(dir, 'edited.js');
    fs.writeFileSync(target, `${big('n')}\n`);
    const store = new RecoveryStore(file);
    store.start('session', dir);
    store.setChange('session', target, {
      before: { exists: true, text: big('o') }, after: { exists: true, text: `${big('n')}\n` },
    });
    store.finish('session', 'run', Object.entries(store.active('session').changes).map(([name, change]) => ({ path: name, ...change })));

    const later = new RecoveryStore(file);
    const result = await revertRun(later.data.undo.run.files);
    assert.deepEqual(result.skipped, []);
    assert.equal(fs.readFileSync(target, 'utf8'), big('o'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
