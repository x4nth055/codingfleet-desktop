'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tools = require('../src/core/tools');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cf-tools-'));
const run = (name, args, cwd) => tools.executeTool(name, args, { cwd });

test('fs_write creates missing folders; fs_read numbers the lines like the sandbox', async () => {
  const cwd = tmp();
  const wrote = await run('fs_write', { path: 'src/app/main.py', content: 'a = 1\nb = 2\n' }, cwd);
  assert.deepEqual(wrote, { output: 'File created.', is_error: false });
  const read = await run('fs_read', { path: 'src/app/main.py' }, cwd);
  assert.equal(read.output, '   1| a = 1\n   2| b = 2\n');
});

test('fs_read honours offset, limit and with_line_numbers', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'f.txt'), 'one\ntwo\nthree\nfour');
  assert.equal((await run('fs_read', { path: 'f.txt', offset: 1, limit: 2 }, cwd)).output, '   2| two\n   3| three\n');
  assert.equal((await run('fs_read', { path: 'f.txt', offset: 3, with_line_numbers: false }, cwd)).output, 'four');
});

test('fs_read reports a missing file as an error', async () => {
  const result = await run('fs_read', { path: 'nope.txt' }, tmp());
  assert.deepEqual(result, { output: 'error: file not found', is_error: true });
});

test('fs_edit refuses an ambiguous match, then edits with all', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'x.js'), 'let a = 1;\nlet a = 1;\n');
  const ambiguous = await run('fs_edit', { path: 'x.js', old: 'let a = 1;', new: 'const a = 2;' }, cwd);
  assert.equal(ambiguous.is_error, true);
  assert.match(ambiguous.output, /appears 2 times/);
  const all = await run('fs_edit', { path: 'x.js', old: 'let a = 1;', new: 'const a = 2;', all: true }, cwd);
  assert.equal(all.output, 'File edited.');
  assert.equal(fs.readFileSync(path.join(cwd, 'x.js'), 'utf8'), 'const a = 2;\nconst a = 2;\n');
});

test('fs_edit keeps $ patterns literal', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'p.txt'), 'price: X');
  await run('fs_edit', { path: 'p.txt', old: 'X', new: "$& and $'" }, cwd);
  assert.equal(fs.readFileSync(path.join(cwd, 'p.txt'), 'utf8'), "price: $& and $'");
});

test('fs_edit matches a CRLF file when the model writes LF', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'w.txt'), 'first\r\nsecond\r\n');
  const result = await run('fs_edit', { path: 'w.txt', old: 'first\nsecond', new: 'one\ntwo' }, cwd);
  assert.equal(result.output, 'File edited.');
  assert.equal(fs.readFileSync(path.join(cwd, 'w.txt'), 'utf8'), 'one\r\ntwo\r\n');
});

test('fs_glob lists newest first and skips node_modules', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, 'node_modules', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'old.js'), '');
  fs.writeFileSync(path.join(cwd, 'node_modules', 'lib', 'dep.js'), '');
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(cwd, 'src', 'new.js'), '');
  fs.utimesSync(path.join(cwd, 'src', 'new.js'), later, later);
  const result = await run('fs_glob', { pat: '**/*.js' }, cwd);
  assert.equal(result.output, 'src/new.js\nsrc/old.js');
  assert.equal((await run('fs_glob', { pat: '*.rs' }, cwd)).output, 'none');
});

const unixShell = tools.SHELL.unix;

test('run_command returns stdout, stderr and the exit code', { skip: !unixShell && 'needs bash' }, async () => {
  const cwd = tmp();
  const { output, is_error } = await run('run_command', { command: 'echo out; echo err 1>&2; exit 3' }, cwd);
  assert.equal(is_error, false);
  assert.equal(output.stdout.trim(), 'out');
  assert.equal(output.stderr.trim(), 'err');
  assert.equal(output.exit_code, 3);
});

test('run_command runs in the project folder', { skip: !unixShell && 'needs bash' }, async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'marker.txt'), 'here');
  const { output } = await run('run_command', { command: 'cat marker.txt' }, cwd);
  assert.equal(output.stdout, 'here');
});

test('run_command stops at its timeout', { skip: !unixShell && 'needs bash' }, async () => {
  const started = Date.now();
  const { output } = await run('run_command', { command: 'sleep 20', timeout: 1 }, tmp());
  assert.ok(Date.now() - started < 8000, 'the command was not stopped');
  assert.equal(output.exit_code, null);
  assert.match(output.stderr, /Stopped after 1 seconds/);
});

test('execute_code writes the file, then runs the command', { skip: !unixShell && 'needs bash' }, async () => {
  const cwd = tmp();
  const { output } = await run('execute_code', { code: 'hello from a file', filename: 'out/note.txt', command: 'cat out/note.txt' }, cwd);
  assert.equal(output.stdout, 'hello from a file');
  const saveOnly = await run('execute_code', { code: 'x', filename: 'only.txt', command: '' }, cwd);
  assert.equal(saveOnly.output.stdout, 'File saved to only.txt.');
});

test('an unknown tool is an error, not a crash', async () => {
  const result = await run('db_query', {}, tmp());
  assert.equal(result.is_error, true);
});

test('approval: reads inside the folder run; commands, writes and outside reads ask', () => {
  const cwd = tmp();
  assert.equal(tools.approvalReason('fs_read', { path: 'src/a.js' }, cwd), null);
  assert.equal(tools.approvalReason('fs_glob', { pat: '**/*.js' }, cwd), null);
  assert.equal(tools.approvalReason('fs_read', { path: '../secret.txt' }, cwd), 'reads outside the project folder');
  // A private key is a secret before it is an outside read: asked even in auto mode.
  assert.equal(tools.approvalReason('fs_read', { path: path.join(os.homedir(), '.ssh', 'id_rsa') }, cwd), 'reads secrets');
  assert.equal(tools.approvalReason('fs_read', { path: '.env' }, cwd), 'reads secrets');
  assert.equal(tools.approvalReason('run_command', { command: 'rm -rf dist' }, cwd), 'may delete or overwrite data');
  assert.equal(tools.approvalReason('read_background', { id: 'bg_1' }, cwd), null);
  assert.equal(tools.approvalReason('stop_background', { id: 'bg_1' }, cwd), null);
  assert.equal(tools.approvalReason('fs_glob', { pat: '/etc/*' }, cwd), 'reads outside the project folder');
  assert.equal(tools.approvalReason('view_image', { source: 'out/chart.png' }, cwd), null);
  assert.equal(tools.approvalReason('view_image', { source: '../photos/me.jpg' }, cwd), 'reads outside the project folder');
  assert.equal(tools.approvalReason('run_command', { command: 'ls' }, cwd), 'runs a command');
  assert.equal(tools.approvalReason('execute_code', { code: 'x', filename: 'a.py', command: 'python a.py' }, cwd), 'runs a command');
  assert.equal(tools.approvalReason('fs_write', { path: 'a.txt', content: '' }, cwd), 'changes files');
  assert.equal(tools.approvalReason('fs_edit', { path: 'a.txt', old: 'a', new: 'b' }, cwd), 'changes files');
});

test('a screenshot always waits for the user, wherever the folder is', () => {
  const cwd = tmp();
  assert.equal(tools.approvalReason('take_screenshot', {}, cwd), 'takes a picture of your screen');
  assert.equal(tools.approvalReason('take_screenshot', { window: 'Chrome' }, cwd),
    'takes a picture of your screen');
  // It is not one of the tools this module runs: the app takes the picture.
  assert.equal(tools.CLIENT_TOOLS.has('take_screenshot'), false);
});

test('a tool this computer does not have is refused by name', async () => {
  const result = await tools.executeTool('take_screenshot', {}, { cwd: tmp() });
  assert.equal(result.is_error, true);
  assert.match(result.output, /cannot run on this computer/);
});
