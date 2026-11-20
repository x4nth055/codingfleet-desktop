'use strict';

// Following a run another client started (src/core/watch.js): what is passed
// on to the window, when it stops, and that it never gets in a Run's way.

const test = require('node:test');
const assert = require('node:assert/strict');

const { Watches, RETRIES } = require('../src/core/watch');

const transient = (message) => Object.assign(new Error(message), { transient: true });

function setup({ streams, owned = () => false }) {
  const seen = [];
  const asked = [];
  let call = 0;
  const api = {
    runEvents(runId, signal) {
      asked.push(runId);
      const script = streams[Math.min(call++, streams.length - 1)];
      return (async function* events() {
        for (const step of script) {
          if (signal.aborted) return;
          if (step instanceof Error) throw step;
          if (typeof step === 'function') { await step(signal); continue; }
          yield step;
        }
      })();
    },
  };
  const watches = new Watches({
    api, owned,
    emit: (sessionId, runId, event, data) => seen.push([sessionId, runId, event, data]),
    wait: async () => {},
  });
  return { watches, seen, asked, names: () => seen.map((row) => row[2]) };
}

const ev = (event, data = {}) => ({ event, data });

test('a run is passed on event by event and closed when it ends', async () => {
  const { watches, seen, names } = setup({ streams: [[
    ev('run.started', { run_id: 'r1' }), ev('text.delta', { text: 'Hi' }),
    ev('tool.call', { id: 'c1', name: 'run_command', executor: 'client' }),
    ev('tool.result', { id: 'c1', ok: true }), ev('run.ended', { reason: 'completed' }),
  ]] });
  assert.equal(watches.start('s1', 'r1'), true);
  assert.equal(watches.watching('s1'), 'r1');
  await watches.active.get('s1').done;
  assert.deepEqual(names(), ['run.started', 'text.delta', 'tool.call', 'tool.result', 'run.ended', 'watch.closed']);
  assert.deepEqual(seen.at(-1), ['s1', 'r1', 'watch.closed', { ended: true, error: null }]);
  assert.equal(watches.watching('s1'), null);
});

test('never beside a run of this app', async () => {
  let mine = true;
  const { watches, names } = setup({ streams: [[ev('text.delta'), ev('run.ended')]], owned: () => mine });
  assert.equal(watches.start('s1', 'r1'), false);
  assert.equal(watches.watching('s1'), null);
  assert.deepEqual(names(), []);
  mine = false;
  assert.equal(watches.start('s1', 'r1'), true);
});

test('a watch a run of this app takes over reads nothing more', async () => {
  let mine = false;
  const { watches, names, asked } = setup({
    streams: [[ev('text.delta'), transient('connection lost')], [ev('text.delta'), ev('run.ended')]],
    owned: () => mine,
  });
  watches.start('s1', 'r1');
  const done = watches.active.get('s1').done;
  mine = true;
  await done;
  assert.deepEqual(asked, ['r1']);
  assert.deepEqual(names(), ['text.delta', 'watch.closed']);
});

test('asking for the same run twice follows it once; another run replaces it', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { watches, asked, seen } = setup({ streams: [
    [ev('text.delta', { text: 'a' }), () => held, ev('run.ended')],
    [ev('text.delta', { text: 'b' }), ev('run.ended')],
  ] });
  assert.equal(watches.start('s1', 'r1'), true);
  assert.equal(watches.start('s1', 'r1'), true);
  assert.deepEqual(asked, ['r1']);
  const first = watches.active.get('s1').done;
  assert.equal(watches.start('s1', 'r2'), true);
  release();
  await first;
  await watches.active.get('s1')?.done;
  assert.deepEqual(asked, ['r1', 'r2']);
  // The replaced watch says nothing after it was replaced: no closing event for r1.
  assert.equal(seen.filter((row) => row[1] === 'r1' && row[2] === 'watch.closed').length, 0);
  assert.deepEqual(seen.at(-1), ['s1', 'r2', 'watch.closed', { ended: true, error: null }]);
});

test('a dropped connection is read again from the start, and the window is told first', async () => {
  const { watches, names, asked } = setup({ streams: [
    [ev('text.delta', { text: 'Hel' }), transient('connection lost')],
    [ev('text.delta', { text: 'Hello' }), ev('run.ended')],
  ] });
  watches.start('s1', 'r1');
  await watches.active.get('s1').done;
  assert.deepEqual(asked, ['r1', 'r1']);
  assert.deepEqual(names(), ['text.delta', 'watch.reconnecting', 'text.delta', 'run.ended', 'watch.closed']);
});

test('a stream that closes with no end is read again', async () => {
  const { watches, names } = setup({ streams: [[ev('text.delta')], [ev('run.ended')]] });
  watches.start('s1', 'r1');
  await watches.active.get('s1').done;
  assert.deepEqual(names(), ['text.delta', 'watch.reconnecting', 'run.ended', 'watch.closed']);
});

test('a run that can no longer be read closes the watch with the reason', async () => {
  const gone = Object.assign(new Error('That run is no longer the latest of its session.'), { status: 409 });
  const { watches, seen, asked } = setup({ streams: [[ev('text.delta'), gone]] });
  watches.start('s1', 'r1');
  await watches.active.get('s1').done;
  assert.deepEqual(asked, ['r1']);
  assert.deepEqual(seen.at(-1), ['s1', 'r1', 'watch.closed',
    { ended: false, error: 'That run is no longer the latest of its session.' }]);
});

test('it gives up after a few tries rather than asking for ever', async () => {
  const { watches, asked, seen } = setup({ streams: [[transient('offline')]] });
  watches.start('s1', 'r1');
  await watches.active.get('s1').done;
  assert.equal(asked.length, RETRIES + 1);
  assert.equal(seen.at(-1)[2], 'watch.closed');
  assert.equal(seen.at(-1)[3].ended, false);
});

test('stopping is silent, and stops the reading', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { watches, names } = setup({ streams: [[ev('text.delta'), () => held, ev('text.delta'), ev('run.ended')]] });
  watches.start('s1', 'r1');
  const done = watches.active.get('s1').done;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(watches.stop('s1'), true);
  assert.equal(watches.stop('s1'), false);
  release();
  await done;
  assert.deepEqual(names(), ['text.delta']);
  assert.equal(watches.watching('s1'), null);
});

test('stopAll ends every watch', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const { watches } = setup({ streams: [[() => held]] });
  watches.start('s1', 'r1');
  watches.start('s2', 'r2');
  const all = [watches.active.get('s1').done, watches.active.get('s2').done];
  watches.stopAll();
  release();
  await Promise.all(all);
  assert.equal(watches.active.size, 0);
});

test('nothing to follow without a session and a run', () => {
  const { watches } = setup({ streams: [[]] });
  assert.equal(watches.start('', 'r1'), false);
  assert.equal(watches.start('s1', ''), false);
});
