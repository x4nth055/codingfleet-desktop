'use strict';
// Real processes, in the shell the app uses, so these run on every OS CI has.
const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');

const { BackgroundJobs } = require('../src/core/background');
const tools = require('../src/core/tools');

const jobs = () => new BackgroundJobs({ shell: tools.SHELL, env: tools.commandEnv, kill: tools.killTree });
const node = (script) => `node -e "${script.replace(/"/g, '\\"')}"`;
// "Forever" in a test means a minute at most. On Windows a stopped job's node
// can outlive its shell, and one left running holds this file open, which
// held a CI runner for three hours.
const forever = (script) => node(`setTimeout(()=>process.exit(),60000);${script}`);

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
  const { output } = bg.start('S', forever('setInterval(()=>console.log(1),200)'), os.tmpdir());
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

test('the local address a dev server prints is found, colours and all', () => {
  const { localUrl } = require('../src/core/background');
  assert.equal(localUrl('\u001b[32m  ➜  Local:\u001b[0m   http://localhost:\u001b[1m5173\u001b[22m/'), 'http://localhost:5173/');
  assert.equal(localUrl('Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)'), 'http://localhost:8000');
  assert.equal(localUrl('listening at http://[::]:3000.'), 'http://localhost:3000');
  assert.equal(localUrl('first http://127.0.0.1:5000/ then http://localhost:5001/app'), 'http://localhost:5001/app');
  assert.equal(localUrl('docs at https://example.com/'), null);
  assert.equal(localUrl(''), null);
});

test('a job says where it listens, and its tail leaves the agent\'s reads alone', async () => {
  const bg = jobs();
  const seen = [];
  bg.onChange((_s, list) => seen.push(list[0].url));
  // The command ends by itself, and the test waits for it: stopping a job is
  // what can leave its node running on Windows, holding this file open.
  const { output } = bg.start('S', node("console.log('ready on http://localhost:4321/');setTimeout(()=>{},300)"), os.tmpdir());
  for (let i = 0; i < 100 && bg.list('S')[0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(bg.list('S')[0].status, 'exited');
  assert.equal(bg.list('S')[0].url, 'http://localhost:4321/');
  assert.ok(seen.includes('http://localhost:4321/'), 'the window is told');
  const tail = bg.tail('S', output.id);
  assert.match(tail.text, /ready on/);
  assert.equal(tail.url, 'http://localhost:4321/');
  assert.equal(bg.tail('T', output.id), null, 'another session sees nothing');
  // The agent still gets everything on its first read.
  const read = await bg.read('S', output.id);
  assert.match(read.output.output, /ready on/);
});

test('"Run in background" hands a waiting command to the jobs, and the agent gets what it printed so far', async () => {
  const bg = jobs();
  const callId = 'call-move-1';
  const waiting = tools.executeTool('run_command', {
    command: forever("console.log('booting');setTimeout(()=>console.log('ready'),600)"),
    timeout: 30,
  }, { cwd: os.tmpdir(), callId, adopt: (handoff) => bg.adopt('S', handoff) });
  // Let it print a line first, as a stuck command would have.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(tools.moveToBackground(callId), true);
  const { output } = await waiting;
  assert.equal(output.exit_code, null);
  assert.match(output.stdout, /booting/);
  assert.match(output.background.id, /^bg_[0-9a-f]{8}$/);
  assert.match(output.background.note, /The user moved this command to the background/);
  // The same call cannot move twice, and an unknown call never moves.
  assert.equal(tools.moveToBackground(callId), false);
  assert.equal(tools.moveToBackground('nope'), false);
  // What the agent already has is not read again; what comes next is.
  const next = await bg.read('S', output.background.id, 5);
  assert.doesNotMatch(next.output.output, /booting/);
  assert.match(next.output.output, /ready/);
  assert.equal(bg.list('S')[0].status, 'running');
  await bg.stop('S', output.background.id);
});

test('a command that finishes is waited for as before, and cannot be moved after', async () => {
  const bg = jobs();
  const res = await tools.executeTool('run_command', { command: node("console.log('done')") },
    { cwd: os.tmpdir(), callId: 'call-move-2', adopt: (handoff) => bg.adopt('S', handoff) });
  assert.equal(res.output.exit_code, 0);
  assert.equal(res.output.background, undefined);
  assert.equal(tools.moveToBackground('call-move-2'), false);
  assert.equal(bg.list('S').length, 0);
});
