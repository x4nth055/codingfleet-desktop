'use strict';
// The terminal panel's shells, with a stand-in for node-pty: what is spawned,
// how output is batched and kept, and what happens when a shell exits.
const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');

const { Terminals, listShells, MAX_TERMINALS, KEEP_CHARS } = require('../src/core/terminal');

function fakePty() {
  const spawned = [];
  const spawn = (file, args, options) => {
    const pty = {
      file, args, options, written: [], size: [options.cols, options.rows], killed: false,
      onData(fn) { this.emitData = fn; },
      onExit(fn) { this.emitExit = fn; },
      write(data) { this.written.push(data); },
      resize(cols, rows) { this.size = [cols, rows]; },
      kill() { this.killed = true; this.emitExit({ exitCode: 1 }); },
    };
    spawned.push(pty);
    return pty;
  };
  return { spawn, spawned };
}

const SHELLS = () => [{ id: 'a', name: 'Shell A', file: '/bin/a', args: ['-l'] }, { id: 'b', name: 'Shell B', file: '/bin/b', args: [] }];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function host(extra = {}) {
  const { spawn, spawned } = fakePty();
  const data = [];
  const exits = [];
  const terms = new Terminals({
    spawn, shells: SHELLS, env: () => ({ PATH: '/bin' }),
    onData: (id, chunk) => data.push([id, chunk]), onExit: (id, code) => exits.push([id, code]), ...extra,
  });
  return { terms, spawned, data, exits };
}

test('a terminal starts the chosen shell in the folder, with terminal settings in its environment', () => {
  const { terms, spawned } = host();
  const view = terms.create({ cwd: os.tmpdir(), shell: 'b', cols: 100, rows: 30 });
  assert.deepEqual(view, { id: 1, shell: 'Shell B', shellId: 'b', cwd: os.tmpdir() });
  assert.equal(spawned[0].file, '/bin/b');
  assert.deepEqual(spawned[0].size, [100, 30]);
  assert.equal(spawned[0].options.env.TERM, 'xterm-256color');
  assert.equal(spawned[0].options.env.PATH, '/bin');
});

test('an unknown shell is the default one, and a folder that is gone is the home folder', () => {
  const { terms, spawned } = host({ home: os.tmpdir() });
  const view = terms.create({ cwd: '/no/such/folder/here', shell: 'nope' });
  assert.equal(view.shellId, 'a');
  assert.equal(view.cwd, os.tmpdir());
  assert.deepEqual(spawned[0].size, [80, 24]);
});

test('output comes in batches, and the latest part is kept for a reload', async () => {
  const { terms, spawned, data } = host();
  const { id } = terms.create({});
  spawned[0].emitData('hel');
  spawned[0].emitData('lo');
  assert.equal(data.length, 0);
  await wait(30);
  assert.deepEqual(data, [[id, 'hello']]);
  spawned[0].emitData('x'.repeat(KEEP_CHARS));
  assert.equal(terms.list()[0].kept.length, KEEP_CHARS);
});

test('typing and resizing reach the shell; a closed terminal is told and forgotten', async () => {
  const { terms, spawned, data, exits } = host();
  const { id } = terms.create({});
  terms.write(id, 'ls\r');
  terms.resize(id, 120, 40);
  assert.deepEqual(spawned[0].written, ['ls\r']);
  assert.deepEqual(spawned[0].size, [120, 40]);
  spawned[0].emitData('bye');
  terms.kill(id);
  assert.deepEqual(data, [[id, 'bye']], 'what was printed before the exit is sent first');
  assert.deepEqual(exits, [[id, 1]]);
  assert.deepEqual(terms.list(), []);
  terms.write(id, 'ignored');
});

test('there is a limit on open terminals', () => {
  const { terms } = host();
  for (let i = 0; i < MAX_TERMINALS; i++) terms.create({});
  assert.throws(() => terms.create({}), /At most/);
  terms.killAll();
  assert.equal(terms.list().length, 0);
});

test('this computer has at least one shell', () => {
  const shells = listShells();
  assert.ok(shells.length >= 1);
  for (const shell of shells) assert.ok(shell.id && shell.name && shell.file);
});
