'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createLinkedFiles, TEXT_VIEW_MAX_BYTES } = require('../src/main/linked-files');

// A session folder with what an agent leaves in one, and a file beside it.
function setup({ answer = 1, platform = 'win32' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-linked-'));
  const cwd = path.join(root, 'project');
  fs.mkdirSync(path.join(cwd, 'out'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'notes.md'), '﻿# Notes\n\nHello.\n');
  fs.writeFileSync(path.join(cwd, 'out', 'run.mp4'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]));
  fs.writeFileSync(path.join(cwd, 'out', 'page.html'), '<h1>Hi</h1>');
  fs.writeFileSync(path.join(cwd, 'setup.bat'), 'echo hi');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'outside');
  const calls = { opened: [], revealed: [], asked: [], browsed: [] };
  const files = createLinkedFiles({
    folderOf: (id) => (id === 's1' ? cwd : null),
    shell: {
      openPath: async (file) => { calls.opened.push(file); return ''; },
      showItemInFolder: (file) => { calls.revealed.push(file); },
    },
    dialog: { showMessageBox: async (_win, options) => { calls.asked.push(options); return { response: answer }; } },
    getWindow: () => null,
    browse: async (file) => { calls.browsed.push(file); return { url: `file://${file}` }; },
    platform,
  });
  return { root, cwd, files, calls };
}

test('a file in the session folder is described for the window', async () => {
  const { cwd, files } = setup();
  const video = await files.info({ sessionId: 's1', path: 'out/run.mp4' });
  assert.equal(video.path, path.join(cwd, 'out', 'run.mp4'));
  assert.equal(video.relative, 'out/run.mp4');
  assert.equal(video.kind, 'video');
  assert.equal(video.inside, true);
  assert.equal(video.exists, true);
  assert.equal(video.text, false);
  assert.equal(video.runs, false);

  const notes = await files.info({ sessionId: 's1', path: 'notes.md' });
  assert.equal(notes.text, true);

  const folder = await files.info({ sessionId: 's1', path: 'out' });
  assert.equal(folder.folder, true);
  assert.equal(folder.text, false);

  const missing = await files.info({ sessionId: 's1', path: 'gone.txt' });
  assert.equal(missing.exists, false);

  const script = await files.info({ sessionId: 's1', path: 'setup.bat' });
  assert.equal(script.runs, true);
});

test('a file outside the folder can be shown, never read', async () => {
  const { root, files } = setup();
  const outside = await files.info({ sessionId: 's1', path: '../secret.txt' });
  assert.equal(outside.inside, false);
  assert.equal(outside.exists, true);
  assert.equal(outside.text, false);
  assert.equal(outside.relative, null);
  await assert.rejects(files.readText({ sessionId: 's1', path: '../secret.txt' }), /outside the session folder/);
  await assert.rejects(files.readText({ sessionId: 's1', path: path.join(root, 'secret.txt') }), /outside the session folder/);
  await assert.rejects(files.browse({ sessionId: 's1', path: '../secret.txt' }), /outside the session folder/);
});

test('another computer is never touched', async () => {
  const { files, calls } = setup();
  for (const share of ['\\\\server\\share\\a.pdf', '//server/share/a.pdf']) {
    if (process.platform === 'win32') {
      await assert.rejects(files.info({ sessionId: 's1', path: share }), /on another computer/);
      await assert.rejects(files.open({ sessionId: 's1', path: share }), /on another computer/);
      await assert.rejects(files.reveal({ sessionId: 's1', path: share }), /on another computer/);
    } else {
      // A share is a Windows path. Elsewhere \\server\share\a.pdf is a file
      // name with backslashes in it, and //server/share is /server/share: a
      // path on this computer, which is simply not there.
      assert.equal((await files.info({ sessionId: 's1', path: share })).exists, false);
      await assert.rejects(files.open({ sessionId: 's1', path: share }), /not there/);
      await assert.rejects(files.reveal({ sessionId: 's1', path: share }), /not there/);
    }
  }
  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.revealed, []);
});

test('a session with no folder here, or a bad path, is refused', async () => {
  const { files } = setup();
  await assert.rejects(files.info({ sessionId: 'cloud', path: 'a.txt' }), /no folder on this computer/);
  await assert.rejects(files.info({ sessionId: 's1', path: '' }), /No file/);
  await assert.rejects(files.info({ sessionId: 's1', path: `a${String.fromCharCode(0)}.txt` }), /No file/);
  await assert.rejects(files.info({ sessionId: 's1', path: 42 }), /No file/);
});

test('text is read without its byte order mark; binary files are refused', async () => {
  const { files } = setup();
  const notes = await files.readText({ sessionId: 's1', path: 'notes.md' });
  assert.equal(notes.text, '# Notes\n\nHello.\n');
  assert.equal(notes.relative, 'notes.md');
  assert.equal(notes.truncated, false);
  await assert.rejects(files.readText({ sessionId: 's1', path: 'out/run.mp4' }), /not a text file/);
  await assert.rejects(files.readText({ sessionId: 's1', path: 'out' }), /not a file/);
  await assert.rejects(files.readText({ sessionId: 's1', path: 'gone.txt' }), /not there/);
});

test('a long file is cut at its last whole line', async () => {
  const { cwd, files } = setup();
  const line = `${'x'.repeat(99)}\n`;
  fs.writeFileSync(path.join(cwd, 'big.log'), line.repeat(Math.ceil(TEXT_VIEW_MAX_BYTES / line.length) + 10));
  const big = await files.readText({ sessionId: 's1', path: 'big.log' });
  assert.equal(big.truncated, true);
  assert.ok(big.text.length <= TEXT_VIEW_MAX_BYTES);
  assert.ok(big.text.endsWith('\n'));
});

test('opening a file uses its app; a program asks first', async () => {
  const { cwd, files, calls } = setup({ answer: 0 });
  assert.equal(await files.open({ sessionId: 's1', path: 'out/run.mp4' }), true);
  assert.deepEqual(calls.opened, [path.join(cwd, 'out', 'run.mp4')]);
  assert.equal(calls.asked.length, 0);

  assert.equal(await files.open({ sessionId: 's1', path: 'setup.bat' }), false);
  assert.equal(calls.asked.length, 1);
  assert.match(calls.asked[0].message, /setup\.bat/);
  assert.equal(calls.opened.length, 1, 'refused: not opened');
  await assert.rejects(files.open({ sessionId: 's1', path: 'gone.mp4' }), /not there/);
});

test('a program the user agreed to opens', async () => {
  const { cwd, files, calls } = setup({ answer: 1 });
  assert.equal(await files.open({ sessionId: 's1', path: 'setup.bat' }), true);
  assert.deepEqual(calls.opened, [path.join(cwd, 'setup.bat')]);
});

test('an executable file with no extension asks first on macOS and Linux', async () => {
  const { cwd, files, calls } = setup({ answer: 0, platform: 'linux' });
  const tool = path.join(cwd, 'tool');
  fs.writeFileSync(tool, '#!/bin/sh\necho hi\n');
  fs.chmodSync(tool, 0o755);
  // Windows has no execute bit to set: the check only runs where it means something.
  if ((fs.statSync(tool).mode & 0o111) === 0) return;
  assert.equal(await files.open({ sessionId: 's1', path: 'tool' }), false);
  assert.equal(calls.asked.length, 1);
});

test('showing a file selects it in its folder; a page goes to the browser pane', async () => {
  const { cwd, files, calls } = setup();
  await files.reveal({ sessionId: 's1', path: 'out/run.mp4' });
  assert.deepEqual(calls.revealed, [path.join(cwd, 'out', 'run.mp4')]);
  await assert.rejects(files.reveal({ sessionId: 's1', path: 'gone.mp4' }), /not there/);
  await files.browse({ sessionId: 's1', path: 'out/page.html' });
  assert.deepEqual(calls.browsed, [path.join(cwd, 'out', 'page.html')]);
});
