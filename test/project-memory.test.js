'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const memory = require('../src/core/project-memory');
const words = require('../src/renderer/lib/tool-words');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-memory-')));
const write = (dir, file, text) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('the memory folder is in the app data folder unless the user chose another place', () => {
  const cwd = path.join(tmp(), 'My Shop');
  const appDir = tmp();
  const key = memory.folderKey(cwd);
  assert.match(key, /^my-shop-[0-9a-f]{8}$/);
  assert.equal(memory.memoryDir(cwd, { appDir }), path.join(appDir, 'projects', key, 'memory'));
  assert.equal(memory.memoryDir(cwd, { location: 'project', appDir }), path.join(cwd, '.codingfleet', 'memory'));
  const custom = tmp();
  assert.equal(memory.memoryDir(cwd, { location: 'custom', customDir: custom, appDir }), path.join(custom, key));
  // "custom" with no folder chosen falls back to the default place.
  assert.equal(memory.memoryDir(cwd, { location: 'custom', appDir }), path.join(appDir, 'projects', key, 'memory'));
});

test('two folders of the same name get different memory folders', () => {
  const a = path.join(tmp(), 'api');
  const b = path.join(tmp(), 'api');
  assert.notEqual(memory.folderKey(a), memory.folderKey(b));
  assert.equal(memory.folderKey(a), memory.folderKey(`${a}${path.sep}`));
});

test('ensure makes the folder and an index, and leaves a good index alone', () => {
  const dir = path.join(tmp(), 'memory');
  const index = memory.ensure(dir);
  assert.match(index, /^# Project memory/);
  assert.equal(read(dir, 'MEMORY.md'), index);
  const before = fs.statSync(path.join(dir, 'MEMORY.md')).mtimeMs;
  assert.equal(memory.ensure(dir), index);
  assert.equal(fs.statSync(path.join(dir, 'MEMORY.md')).mtimeMs, before);
});

test('the index follows the files: missing lines are added, dead lines dropped, empty files deleted', () => {
  const dir = tmp();
  write(dir, 'MEMORY.md', '# Project memory\n\n- [tests](tests.md): How to run the tests\n- [gone](gone.md): No file for this\n');
  write(dir, 'tests.md', 'Run `npm test`.');
  write(dir, 'deploy.md', '# Deploy\n\nPush a tag named vX.Y.Z.\n');
  write(dir, 'old.md', '   \n');
  const index = memory.syncIndex(dir);
  assert.match(index, /- \[tests\]\(tests\.md\): How to run the tests/); // the agent's own line is kept
  assert.match(index, /- \[deploy\]\(deploy\.md\): Deploy/);              // described by its first line
  assert.doesNotMatch(index, /gone/);
  assert.equal(fs.existsSync(path.join(dir, 'old.md')), false);
  assert.deepEqual(memory.listEntries(dir).map((e) => [e.name, e.description]),
    [['deploy', 'Deploy'], ['tests', 'How to run the tests']]);
});

test('the instructions name the folder with forward slashes and carry the index', () => {
  const dir = path.join(tmp(), 'memory');
  write(dir, 'tests.md', 'Run npm test.');
  const text = memory.instructions(dir, memory.ensure(dir));
  assert.ok(text.includes(`${dir.replace(/\\/g, '/')}/`));
  assert.ok(!text.includes('\\'));
  assert.match(text, /- \[tests\]\(tests\.md\)/);
  assert.match(text, /Do not save secrets/);
  assert.match(memory.instructions(dir, ''), /\(no entries yet\)/);
});

test('a very long index is cut in the instructions', () => {
  const long = Array.from({ length: 400 }, (_, i) => `- [entry-${i}](entry-${i}.md): ${'d'.repeat(60)}`).join('\n');
  const text = memory.instructions(tmp(), long);
  assert.ok(text.length < memory.INDEX_MAX_CHARS + 3000);
  assert.match(text, /the index is longer/);
});

test('file tools on .md files in the memory folder need no approval; anything else does', () => {
  const cwd = tmp();
  const dir = path.join(tmp(), 'memory');
  memory.ensure(dir);
  const inside = (file) => path.join(dir, file).replace(/\\/g, '/');
  assert.equal(memory.allows('fs_read', { path: inside('MEMORY.md') }, cwd, dir), true);
  assert.equal(memory.allows('fs_write', { path: inside('tests.md'), content: 'x' }, cwd, dir), true);
  assert.equal(memory.allows('fs_edit', { path: inside('tests.md'), old: 'a', new: 'b' }, cwd, [null, dir]), true);
  assert.equal(memory.allows('fs_glob', { path: dir, pat: '*.md' }, cwd, dir), true);
  // Not a Markdown file, not in the folder, a way out of it, or another tool.
  assert.equal(memory.allows('fs_write', { path: inside('run.sh'), content: 'x' }, cwd, dir), false);
  assert.equal(memory.allows('fs_write', { path: path.join(dir, '..', 'evil.md'), content: 'x' }, cwd, dir), false);
  assert.equal(memory.allows('fs_read', { path: path.join(cwd, 'notes.md') }, cwd, dir), false);
  assert.equal(memory.allows('fs_glob', { path: dir, pat: '../*' }, cwd, dir), false);
  assert.equal(memory.allows('fs_glob', { pat: '*.md' }, cwd, dir), false);
  assert.equal(memory.allows('run_command', { command: `cat ${inside('tests.md')}` }, cwd, dir), false);
  assert.equal(memory.allows('fs_read', { path: inside('MEMORY.md') }, cwd, []), false);
});

test('a link out of the memory folder is not inside it', (t) => {
  const dir = path.join(tmp(), 'memory');
  const outside = tmp();
  memory.ensure(dir);
  try {
    fs.symlinkSync(outside, path.join(dir, 'link'), 'junction');
  } catch {
    t.skip('this computer cannot make a link');
    return;
  }
  assert.equal(memory.allows('fs_write', { path: path.join(dir, 'link', 'x.md'), content: 'x' }, outside, dir), false);
  assert.equal(memory.allows('fs_write', { path: path.join(dir, 'x.md'), content: 'x' }, outside, dir), true);
});

test('an in-project memory folder is kept out of git once, without touching .gitignore', (t) => {
  const cwd = tmp();
  try {
    execFileSync('git', ['init', '-q'], { cwd, stdio: 'ignore' });
  } catch {
    t.skip('git is not installed');
    return;
  }
  assert.equal(memory.excludeFromGit(cwd), true);
  assert.equal(memory.excludeFromGit(cwd), true);
  const exclude = read(path.join(cwd, '.git', 'info'), 'exclude');
  assert.equal(exclude.split(/\r?\n/).filter((line) => line.trim() === '.codingfleet/').length, 1);
  assert.equal(fs.existsSync(path.join(cwd, '.gitignore')), false);
  write(path.join(cwd, '.codingfleet', 'memory'), 'tests.md', 'x');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim(), '');
});

test('a folder that is not a repository is left alone', () => {
  const cwd = tmp();
  assert.equal(memory.excludeFromGit(cwd), false);
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('moving memory takes the entries and their descriptions, and keeps what is already there', () => {
  const cwd = tmp();
  const from = path.join(cwd, '.codingfleet', 'memory');
  const to = path.join(tmp(), 'memory');
  write(from, 'MEMORY.md', '# Project memory\n\n- [tests](tests.md): How to run the tests\n- [same](same.md): Old one\n');
  write(from, 'tests.md', 'Run npm test.');
  write(from, 'same.md', 'old text');
  write(to, 'same.md', 'new text');
  memory.ensure(to);

  write(from, 'twin.md', 'the same text');
  write(to, 'twin.md', 'the same text');
  memory.syncIndex(from);
  assert.equal(memory.moveMemory(from, to), 2);
  assert.equal(read(to, 'tests.md'), 'Run npm test.');
  assert.equal(read(to, 'same.md'), 'new text');          // not replaced
  assert.equal(read(to, 'same-2.md'), 'old text');        // and not lost: it moved under a new name
  assert.deepEqual(memory.entryFiles(to).map((e) => e.file), ['same.md', 'same-2.md', 'tests.md', 'twin.md']);
  assert.match(read(to, 'MEMORY.md'), /- \[tests\]\(tests\.md\): How to run the tests/);
  assert.equal((read(to, 'MEMORY.md').match(/^- \[/gm) || []).length, 4);
  // Nothing stays behind, so the old folder is gone.
  assert.equal(fs.existsSync(path.join(cwd, '.codingfleet')), false);

  // Nothing left behind when every file moved.
  const from2 = path.join(cwd, 'b', '.codingfleet', 'memory');
  write(from2, 'only.md', 'x');
  memory.ensure(from2);
  assert.equal(memory.moveMemory(from2, path.join(tmp(), 'memory')), 1);
  assert.equal(fs.existsSync(path.join(cwd, 'b', '.codingfleet')), false);
  assert.equal(memory.moveMemory(from2, from2), 0);
});

test('the window names the memory tools', () => {
  assert.deepEqual(words.VERBS.read_memory({ scope: 'user', names: ['stack', 'tests'] }), ['Read memory', 'stack, tests']);
  assert.deepEqual(words.VERBS.update_memory({ name: 'stack', content: 'Django' }), ['Update memory', 'stack']);
  assert.deepEqual(words.VERBS.update_memory({ name: 'stack', content: '' }), ['Delete from memory', 'stack']);
});

test('a file name with brackets keeps one index line and the words the agent wrote for it', () => {
  const dir = path.join(tmp(), 'memory');
  for (const file of ['paren (old).md', 'bracket [v2].md', 'UPPER.MD']) write(dir, file, `About ${file}`);
  memory.ensure(dir);
  const rewritten = read(dir, 'MEMORY.md').replace(/^(- \[.*\.md\)): .*$/gim, '$1: The agent wrote this');
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), rewritten);
  const index = memory.syncIndex(dir);
  assert.equal(index, rewritten);
  assert.equal((index.match(/^- \[/gm) || []).length, 3);
  assert.deepEqual(memory.listEntries(dir).map((e) => e.description), ['The agent wrote this', 'The agent wrote this', 'The agent wrote this']);
});

test('an emptied entry file is a deleted entry, whatever white space is left in it', () => {
  const dir = path.join(tmp(), 'memory');
  write(dir, 'kept.md', 'A fact.');
  write(dir, 'spaces.md', `${' '.repeat(500)}\r\n\t`);
  write(dir, 'empty.md', '');
  // Before the next sync, the list already leaves them out (what Preferences counts).
  assert.deepEqual(memory.listEntries(dir).map((e) => e.name), ['kept']);
  memory.ensure(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['MEMORY.md', 'kept.md']);
});

test('a project whose .codingfleet is a link keeps its notes in the app folder', (t) => {
  const appDir = tmp();
  const elsewhere = tmp();
  // The link leads out of the project, or back into it: neither is a memory folder.
  for (const [linkAt, leadsTo] of [['.codingfleet', () => elsewhere], [path.join('.codingfleet', 'memory'), (cwd) => path.join(cwd, 'docs')]]) {
    const cwd = tmp();
    write(path.join(cwd, 'docs'), 'private.md', 'not a note');
    fs.mkdirSync(path.dirname(path.join(cwd, linkAt)), { recursive: true });
    try {
      fs.symlinkSync(leadsTo(cwd), path.join(cwd, linkAt), 'junction');
    } catch {
      t.skip('this account cannot make links');
      return;
    }
    const dir = memory.memoryDir(cwd, { location: 'project', appDir });
    assert.equal(dir, path.join(appDir, 'projects', memory.folderKey(cwd), 'memory'), linkAt);
    // The no-approval rule does not follow the link either.
    const linked = path.join(cwd, '.codingfleet', 'memory');
    assert.equal(memory.allows('fs_write', { path: path.join(linked, 'planted.md') }, cwd, [linked]), false, linkAt);
    assert.equal(memory.allows('fs_read', { path: path.join(linked, 'private.md') }, cwd, [linked]), false, linkAt);
    assert.equal(memory.allows('fs_write', { path: path.join(dir, 'note.md') }, cwd, [dir]), true);
  }
  assert.deepEqual(fs.readdirSync(elsewhere), []);
  // A plain folder is still the project's own.
  const plain = tmp();
  assert.equal(memory.memoryDir(plain, { location: 'project', appDir }), path.join(plain, '.codingfleet', 'memory'));
});

test('a link among the entry files is not an entry', (t) => {
  const dir = path.join(tmp(), 'memory');
  const outside = tmp();
  write(outside, 'secret.md', 'API_KEY=not-for-the-index');
  write(dir, 'real.md', 'A fact.');
  try {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(dir, 'notes.md'), 'file');
  } catch {
    t.skip('this account cannot make file links');
    return;
  }
  const index = memory.ensure(dir);
  assert.doesNotMatch(index, /API_KEY|notes\.md/);
  assert.deepEqual(memory.listEntries(dir).map((e) => e.name), ['real']);
});

test('moving a folder onto itself under another spelling keeps its index', (t) => {
  const dir = path.join(tmp(), 'Memory');
  write(dir, 'build.md', 'how to build');
  write(dir, 'MEMORY.md', '# Project memory\n\n- [build](build.md): THE AGENT WROTE THIS\n');
  const before = read(dir, 'MEMORY.md');
  const link = path.join(tmp(), 'link');
  let spellings = memory.FOLDS_CASE ? [path.join(path.dirname(dir), 'mEMORY')] : [];
  try { fs.symlinkSync(dir, link, 'junction'); spellings.push(link); } catch { /* no links for this account */ }
  if (!spellings.length) { t.skip('no second spelling on this system'); return; }
  for (const other of spellings) {
    assert.equal(memory.moveMemory(dir, other), 0, other);
    assert.equal(memory.moveMemory(other, dir), 0, other);
    assert.equal(read(dir, 'MEMORY.md'), before, other);
    assert.equal(read(dir, 'build.md'), 'how to build');
  }
});
