'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const links = require('../src/core/file-links');

test('a relative or absolute path in a link is a file on this computer', () => {
  assert.deepEqual(links.localFileTarget('out/run.mp4'), { path: 'out/run.mp4', line: null });
  assert.deepEqual(links.localFileTarget('./notes.md'), { path: './notes.md', line: null });
  assert.deepEqual(links.localFileTarget('C:\\work\\demo\\report.pdf'), { path: 'C:\\work\\demo\\report.pdf', line: null });
  assert.deepEqual(links.localFileTarget('/home/u/a.txt'), { path: '/home/u/a.txt', line: null });
  assert.deepEqual(links.localFileTarget('<out/my file.mp4>'), { path: 'out/my file.mp4', line: null });
  assert.deepEqual(links.localFileTarget('out/my%20file.mp4'), { path: 'out/my file.mp4', line: null });
  assert.deepEqual(links.localFileTarget('C:%5Cwork%5Crun.mp4'), { path: 'C:\\work\\run.mp4', line: null });
  assert.deepEqual(links.localFileTarget('Makefile'), { path: 'Makefile', line: null });
});

test('a file URL becomes a plain path', () => {
  assert.deepEqual(links.localFileTarget('file:///C:/work/out/run.mp4'), { path: 'C:/work/out/run.mp4', line: null });
  assert.deepEqual(links.localFileTarget('file:///home/u/a.pdf'), { path: '/home/u/a.pdf', line: null });
});

test('a line number after the path is kept apart from it', () => {
  assert.deepEqual(links.localFileTarget('src/app.js:42'), { path: 'src/app.js', line: 42 });
  assert.deepEqual(links.localFileTarget('src/app.js:42:7'), { path: 'src/app.js', line: 42 });
  assert.deepEqual(links.localFileTarget('src/app.js#L12'), { path: 'src/app.js', line: 12 });
  assert.deepEqual(links.localFileTarget('src/app.js#L12-L20'), { path: 'src/app.js', line: 12 });
  assert.deepEqual(links.localFileTarget('C:\\work\\app.js:9'), { path: 'C:\\work\\app.js', line: 9 });
  assert.deepEqual(links.localFileTarget('file:///C:/work/app.js#L3'), { path: 'C:/work/app.js', line: 3 });
});

test('URLs, anchors and other computers are not files here', () => {
  assert.equal(links.localFileTarget('https://codingfleet.com/a.pdf'), null);
  assert.equal(links.localFileTarget('http://localhost:3000/'), null);
  assert.equal(links.localFileTarget('localhost:3000'), null);
  assert.equal(links.localFileTarget('mailto:a@b.c'), null);
  assert.equal(links.localFileTarget('javascript:alert(1)'), null);
  assert.equal(links.localFileTarget('#section'), null);
  assert.equal(links.localFileTarget('\\\\server\\share\\a.pdf'), null);
  assert.equal(links.localFileTarget('//server/share/a.pdf'), null);
  assert.equal(links.localFileTarget(''), null);
  assert.equal(links.localFileTarget(null), null);
  assert.equal(links.localFileTarget(`bad${String.fromCharCode(0)}.txt`), null);
  assert.equal(links.localFileTarget(`${'a'.repeat(1200)}.txt`), null);
});

test('the sanitizer is told about paths that name their drive or say file://', () => {
  assert.equal(links.isAbsoluteLocal('C:\\work\\a.mp4'), true);
  assert.equal(links.isAbsoluteLocal('d:/work/a.mp4'), true);
  assert.equal(links.isAbsoluteLocal('C:%5Cwork%5Ca.mp4'), true);
  assert.equal(links.isAbsoluteLocal('file:///C:/a.mp4'), true);
  assert.equal(links.isAbsoluteLocal('out/a.mp4'), false);
  assert.equal(links.isAbsoluteLocal('https://a.b/c'), false);
  assert.equal(links.isAbsoluteLocal('javascript:alert(1)'), false);
});

test('the kind of a file follows its extension', () => {
  assert.equal(links.kindOf('out/run.MP4'), 'video');
  assert.equal(links.kindOf('a/b.gif'), 'image');
  assert.equal(links.kindOf('song.flac'), 'audio');
  assert.equal(links.kindOf('report.pdf'), 'pdf');
  assert.equal(links.kindOf('site/index.html'), 'html');
  assert.equal(links.kindOf('plan.docx'), 'document');
  assert.equal(links.kindOf('dist.zip'), 'archive');
  assert.equal(links.kindOf('src/app.ts'), 'other');
  assert.equal(links.kindOf('Makefile'), 'other');
});

test('programs, scripts and macro documents run when opened', () => {
  for (const file of ['setup.exe', 'run.BAT', 'x.cmd', 'a.ps1', 'b.vbs', 'c.js', 'd.py', 'e.sh', 'f.lnk', 'g.msi',
    'h.hta', 'i.jar', 'j.app', 'k.command', 'l.xlsm', 'm.reg', 'n.scr', 'o.url', 'p.AppImage', 'q.appinstaller', 'r.diagcab']) {
    assert.equal(links.runsWhenOpened(file), true, file);
  }
  for (const file of ['run.mp4', 'a.png', 'b.pdf', 'c.txt', 'd.md', 'e.json', 'f.ts', 'g.html', 'h.docx', 'i.csv']) {
    assert.equal(links.runsWhenOpened(file), false, file);
  }
});

test('the side panel tries text files, never media or documents', () => {
  assert.equal(links.maybeText('src/app.ts'), true);
  assert.equal(links.maybeText('README'), true);
  assert.equal(links.maybeText('index.html'), true);
  assert.equal(links.maybeText('logo.svg'), true);
  assert.equal(links.maybeText('run.mp4'), false);
  assert.equal(links.maybeText('a.png'), false);
  assert.equal(links.maybeText('b.pdf'), false);
  assert.equal(links.maybeText('c.docx'), false);
});

test('a file names its highlighting language', () => {
  assert.equal(links.languageOf('src/app.ts'), 'ts');
  assert.equal(links.languageOf('lib/x.mjs'), 'javascript');
  assert.equal(links.languageOf('Dockerfile'), 'dockerfile');
  assert.equal(links.languageOf('a/CMakeLists.txt'), 'cmake');
  assert.equal(links.languageOf('.env'), 'bash');
  assert.equal(links.languageOf('notes.txt'), 'plaintext');
  assert.equal(links.languageOf('LICENSE'), '');
});
