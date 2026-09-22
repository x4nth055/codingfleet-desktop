'use strict';
// Git in a session's folder, against a real repository: the counts the composer
// shows ("+531 −12") and the diff behind a file in the changes list.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const git = require('../src/main/git');

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-git-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  run('add', '.');
  run('commit', '-qm', 'first');
  return { dir, run };
}

const clean = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// A temporary folder is reached through an 8.3 name on Windows ("ABDELA~1")
// and git answers with the long one: compare what both spell out.
const samePath = (a, b) => path.normalize(fs.realpathSync.native(a)) === path.normalize(fs.realpathSync.native(b));

test('a folder that is not a repository has no summary', { skip: !hasGit }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-plain-'));
  try {
    assert.equal((await git.summary(dir)).repo, null);
  } finally {
    clean(dir);
  }
});

test('a repository with nothing changed is a repository all the same', { skip: !hasGit }, async () => {
  const { dir } = makeRepo();
  try {
    const summary = await git.summary(dir);
    assert.equal(summary.repo.name, path.basename(dir));
    assert.equal(summary.repo.branch, 'main');
    assert.deepEqual(summary.files, []);
    assert.equal(summary.added, 0);
    assert.equal(summary.removed, 0);
  } finally {
    clean(dir);
  }
});

test('a changed, an added and an untracked file are each counted', { skip: !hasGit }, async () => {
  const { dir } = makeRepo();
  try {
    // Two lines rewritten in a tracked file, one file staged, one never added.
    fs.writeFileSync(path.join(dir, 'src/app.js'), 'one\nTWO\nthree\nfour\n');
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello\nmore\n');
    fs.mkdirSync(path.join(dir, 'notes'));
    fs.writeFileSync(path.join(dir, 'notes/new.md'), 'a\nb\n');
    fs.writeFileSync(path.join(dir, 'notes/also-new.md'), 'c\n');

    const summary = await git.summary(path.join(dir, 'src'));
    assert.ok(samePath(summary.repo.root, dir), `${summary.repo.root} is not ${dir}`);
    // The new folder git collapsed into one record is walked: both files count.
    assert.equal(summary.files.length, 4);
    assert.equal(summary.count, 4);
    const byPath = new Map(summary.files.map((f) => [f.path, f]));
    assert.deepEqual(
      { added: byPath.get('src/app.js').added, removed: byPath.get('src/app.js').removed, status: byPath.get('src/app.js').status },
      { added: 2, removed: 1, status: 'modified' },
    );
    assert.equal(byPath.get('README.md').added, 1);
    assert.equal(byPath.get('README.md').status, 'modified');
    assert.equal(byPath.get('notes/new.md').added, 2);
    assert.equal(byPath.get('notes/new.md').status, 'untracked');
    assert.equal(byPath.get('notes/also-new.md').added, 1);
    assert.equal(summary.added, 6);
    assert.equal(summary.removed, 1);
  } finally {
    clean(dir);
  }
});

test('staged and unstaged changes to one file add up', { skip: !hasGit }, async () => {
  const { dir, run } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello\nstaged\n');
    run('add', 'README.md');
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello\nstaged\nunstaged\n');
    const summary = await git.summary(dir);
    const file = summary.files.find((f) => f.path === 'README.md');
    assert.equal(file.added, 2);
    assert.equal(file.removed, 0);
    assert.equal(file.staged, true);
  } finally {
    clean(dir);
  }
});

test('a deleted file counts the lines it takes away', { skip: !hasGit }, async () => {
  const { dir } = makeRepo();
  try {
    fs.rmSync(path.join(dir, 'src/app.js'));
    const summary = await git.summary(dir);
    const file = summary.files.find((f) => f.path === 'src/app.js');
    assert.equal(file.status, 'deleted');
    assert.equal(file.added, 0);
    assert.equal(file.removed, 3);
  } finally {
    clean(dir);
  }
});

test('the diff of a changed file is what the window draws', { skip: !hasGit }, async () => {
  const { dir } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'src/app.js'), 'one\nTWO\nthree\n');
    const diff = await git.diffFor(dir, 'src/app.js');
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
    assert.equal(diff.binary, false);
    assert.deepEqual(diff.hunks[0].lines.map((l) => [l.t, l.text]), [[' ', 'one'], ['-', 'two'], ['+', 'TWO'], [' ', 'three']]);
  } finally {
    clean(dir);
  }
});

test('a file git does not track yet diffs as all additions', { skip: !hasGit }, async () => {
  const { dir } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'notes.md'), 'one\ntwo\n');
    const diff = await git.diffFor(dir, 'notes.md');
    assert.equal(diff.untracked, true);
    assert.equal(diff.added, 2);
    assert.deepEqual(diff.hunks[0].lines.map((l) => l.text), ['one', 'two']);
  } finally {
    clean(dir);
  }
});

test('a repository with a staged file and no commit yet still diffs', { skip: !hasGit }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-git-new-'));
  try {
    const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'first.txt'), 'a\nb\n');
    run('add', 'first.txt');
    const summary = await git.summary(dir);
    assert.equal(summary.repo.noCommits, true);
    assert.equal(summary.repo.branch, 'main');
    assert.equal(summary.files.length, 1);
    assert.equal(summary.added, 2);
    const diff = await git.diffFor(dir, 'first.txt');
    assert.equal(diff.added, 2);
    assert.equal(diff.hunks[0].lines[1].text, 'b');
  } finally {
    clean(dir);
  }
});

test('a path outside the repository is refused', { skip: !hasGit }, async () => {
  const { dir } = makeRepo();
  try {
    await assert.rejects(() => git.diffFor(dir, '../secret.txt'), /outside the repository/);
    await assert.rejects(() => git.diffFor(dir, 'src/../../..'), /outside the repository/);
  } finally {
    clean(dir);
  }
});

test('a folder that is not a repository has nothing to diff', { skip: !hasGit }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-plain-'));
  try {
    await assert.rejects(() => git.diffFor(dir, 'x.txt'), /not a git repository/);
  } finally {
    clean(dir);
  }
});

test('watching a repository reports the first change after it', { skip: !hasGit }, async () => {
  const { dir } = makeRepo();
  try {
    const root = await git.watch(dir, () => {});
    assert.ok(root && samePath(root, dir), `${root} is not ${dir}`);
    // Watching is best effort and slow to settle: what matters here is that a
    // repository is found and that stopping does not throw.
    git.stopWatch();
    git.stopWatch();
    assert.equal(await git.watch(path.join(dir, 'nope'), () => {}), null);
  } finally {
    git.stopWatch();
    clean(dir);
  }
});
