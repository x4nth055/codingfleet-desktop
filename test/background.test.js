'use strict';
// Real processes, in the shell the app uses, so these run on every OS CI has.
const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');

const { BackgroundJobs } = require('../src/core/background');
const tools = require('../src/core/tools');

const jobs = () => new BackgroundJobs({ shell: tools.SHELL, env: tools.commandEnv, kill: tools.killTree });
const node = (script) => `node -e "${script.replace(/"/g, '\\"')}"`;

test('a background command answers at once, and its output is read as it comes', async () => {
  const bg = jobs();
  const started = Date.now();
  const res = bg.start('S', node("let n=0;const t=setInterval(()=>{console.log('tick '+(++n));if(n===3){clearInterval(t)}},150)"), os.tmpdir());
  assert.equal(res.is_error, false);
  assert.match(res.output.id, /^bg_[0-9a-f]{8}$/);
  assert.ok(Date.now() - started < 1500, 'start must not wait for the command');

  const first = await bg.read('S', res.output.id, 5);
  assert.match(first.output.output, /tick 1/);
  // Waits for the rest, then says it exited, and never repeats what was read.
  let seen = first.output.output;
  let last = first;
  for (let i = 0; i < 10 && last.output.status === 'running'; i++) {
    last = await bg.read('S', res.output.id, 2);
    seen += last.output.output;
  }
  assert.equal(last.output.status, 'exited');
  assert.equal(last.output.exit_code, 0);
  assert.equal((seen.match(/tick 1/g) || []).length, 1);
  assert.match(seen, /tick 3/);
});

test('stop ends a command that would run forever', async () => {
  const bg = jobs();
  const { output } = bg.start('S', node('setInterval(()=>console.log(1),200)'), os.tmpdir());
  const stopped = await bg.stop('S', output.id);
  assert.equal(stopped.output.status, 'stopped');
  assert.equal(bg.list('S')[0].status, 'exited');
});

test('another session cannot read or stop a job, and an unknown id is an error', async () => {
  const bg = jobs();
  const { output } = bg.start('A', node('setTimeout(()=>{},5000)'), os.tmpdir());
  assert.equal((await bg.read('B', output.id)).is_error, true);
  assert.equal((await bg.stop('B', output.id)).is_error, true);
  assert.equal((await bg.read('A', 'bg_nope')).is_error, true);
  bg.stopAll();
});

test('a session cannot start servers without end', async () => {
  const bg = jobs();
  for (let i = 0; i < 8; i++) assert.equal(bg.start('S', node('setTimeout(()=>{},20000)'), os.tmpdir()).is_error, false);
  const refused = bg.start('S', node('1'), os.tmpdir());
  assert.equal(refused.is_error, true);
  assert.match(refused.output, /already running/);
  // Another session is not affected.
  assert.equal(bg.start('T', node('1'), os.tmpdir()).is_error, false);
  bg.stopAll();
});

test('the window is told when jobs start and end', async () => {
  const bg = jobs();
  const seen = [];
  bg.onChange((sessionId, list) => seen.push([sessionId, list.map((j) => j.status).join()]));
  const { output } = bg.start('S', node('1'), os.tmpdir());
  for (let i = 0; i < 50 && bg.list('S')[0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen[0], ['S', 'running']);
  assert.deepEqual(seen.at(-1), ['S', 'exited']);
  assert.equal(bg.list('S')[0].id, output.id);
});

test('commands do not see the key this app signs in with', () => {
  const before = process.env.CODINGFLEET_API_KEY;
  process.env.CODINGFLEET_API_KEY = 'cf_sk_secret';
  try {
    assert.equal(tools.commandEnv().CODINGFLEET_API_KEY, undefined);
    assert.equal(tools.commandEnv().PATH || tools.commandEnv().Path, process.env.PATH || process.env.Path);
  } finally {
    if (before === undefined) delete process.env.CODINGFLEET_API_KEY;
    else process.env.CODINGFLEET_API_KEY = before;
  }
});
