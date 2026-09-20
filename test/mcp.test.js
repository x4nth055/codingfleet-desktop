'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { LocalMcp, toolName, toOutput } = require('../src/core/mcp');

const FAKE = path.join(__dirname, 'fixtures', 'fake-mcp.js');

test('tool names are local_, safe, unique and at most 64 characters', () => {
  const taken = new Set();
  assert.equal(toolName('my server', 'read.file', taken), 'local_my_server_read_file');
  const long = toolName('x'.repeat(40), 'y'.repeat(40), taken);
  assert.ok(long.startsWith('local_') && long.length <= 64);
  const again = toolName('my server', 'read.file', taken);
  assert.notEqual(again, 'local_my_server_read_file');
  assert.match(again, /^local_[A-Za-z0-9_-]+$/);
});

test('a result becomes text, with other parts named', () => {
  assert.deepEqual(toOutput({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }] }),
    { output: 'a\n[image content omitted]', is_error: false });
  assert.equal(toOutput({ content: [], isError: true }).is_error, true);
});

test('a local server is started, listed and called', async () => {
  const mcp = new LocalMcp();
  mcp.configure([
    { id: 'a', name: 'fake', command: process.execPath, args: [FAKE], env: { FAKE_SUFFIX: '!' }, enabled: true },
    { id: 'b', name: 'off', command: process.execPath, args: [FAKE], enabled: false },
  ]);
  try {
    const status = await mcp.status();
    assert.deepEqual(status, [{ id: 'a', name: 'fake', tools: ['echo', 'fail'], error: null }]);
    const { declared, routes } = await mcp.toolsForRun();
    assert.deepEqual(declared.map((t) => t.name), ['local_fake_echo', 'local_fake_fail']);
    assert.equal(declared[0].input_schema.type, 'object');
    const echo = routes.get('local_fake_echo');
    assert.deepEqual(await echo.server.call(echo.tool, { text: 'hi' }), { output: 'echo: hi !', is_error: false });
    const fail = routes.get('local_fake_fail');
    assert.equal((await fail.server.call(fail.tool, {})).is_error, true);
  } finally {
    mcp.stopAll();
  }
});

test('a server that cannot start reports why', async () => {
  const mcp = new LocalMcp();
  mcp.configure([{ id: 'x', name: 'broken', command: process.execPath, args: ['-e', 'process.exit(3)'], enabled: true }]);
  try {
    const [status] = await mcp.status();
    assert.match(status.error, /broken stopped \(exit code 3\)/);
    const { declared } = await mcp.toolsForRun();
    assert.deepEqual(declared, []);
  } finally {
    mcp.stopAll();
  }
});

test('changing a server restarts it; removing one stops it', async () => {
  const mcp = new LocalMcp();
  const config = { id: 'a', name: 'fake', command: process.execPath, args: [FAKE], enabled: true };
  mcp.configure([config]);
  try {
    await mcp.status();
    const first = mcp.servers.get('a').server;
    mcp.configure([config]);
    assert.equal(mcp.servers.get('a').server, first);
    mcp.configure([{ ...config, name: 'renamed' }]);
    assert.notEqual(mcp.servers.get('a').server, first);
    assert.equal(first.child, null);
    mcp.configure([]);
    assert.equal(mcp.servers.size, 0);
  } finally {
    mcp.stopAll();
  }
});
