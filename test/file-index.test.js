'use strict';
// The files of a folder, for @ mentions: from git in a repository, walked otherwise.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listFiles, foldersOf } = require('../src/core/file-index');

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-index-'));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return dir;
}

const hasGit = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

test('the folders holding files are listed once each', () => {
  assert.deepEqual(foldersOf(['a/b/c.js', 'a/b/d.js', 'a/e.js', 'f.js']).sort(), ['a/', 'a/b/']);
});

test('outside a repository the folder is walked, skipping dependencies and build output', async () => {
  const dir = tree({
    'README.md': '', 'src/app.js': '', 'src/lib/util.js': '',
    'node_modules/x/index.js': '', 'dist/out.js': '', '.git/HEAD': '',
  });
  try {
    const index = await listFiles(dir);
    // A temp folder may sit inside some repository; only a walk is tested here.
    if (index.source !== 'walk') return;
    assert.deepEqual(index.files.sort(), ['README.md', 'src/app.js', 'src/lib/util.js']);
    assert.deepEqual(index.dirs.sort(), ['src/', 'src/lib/']);
    assert.equal(index.truncated, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('in a repository git answers, and what is ignored stays out', { skip: !hasGit }, async () => {
  const dir = tree({ '.gitignore': 'secret.txt\nbuild/\n', 'a.js': '', 'secret.txt': '', 'build/x.js': '', 'lib/b.js': '' });
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', 'a.js'], { cwd: dir });
    const index = await listFiles(dir);
    assert.equal(index.source, 'git');
    assert.deepEqual(index.files.sort(), ['.gitignore', 'a.js', 'lib/b.js']);
    assert.deepEqual(index.dirs, ['lib/']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
