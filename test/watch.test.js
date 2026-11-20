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
    // A promise of the stream, as the real one is (api.js openStream).
    async runEvents(runId, signal) {
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

// ── Against the real API client, over HTTP ─────────────────────────────────
// The stand-in above once answered with the stream itself where the real
// client answers with a promise of it, and every watch failed before its
// first event while its connection stayed open. These read a real stream.

const http = require('node:http');
const api = require('../src/core/api');

const frame = (event, data) => 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';

async function withServer(onEvents, body) {
  const saved = api.snapshot();
  const state = { opened: 0, open: 0 };
  const server = http.createServer((req, res) => {
    state.opened += 1;
    state.open += 1;
    res.on('close', () => { state.open -= 1; });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    onEvents(req, res, state);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api.configure({ apiBase: 'http://127.0.0.1:' + server.address().port + '/v1', apiKey: 'test' });
  try {
    await body(state);
  } finally {
    api.configure(saved);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const until = async (check, ms = 10000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test('over real HTTP a run is one connection, read to its end', { timeout: 30000 }, async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/v1/runs/R1/events');
    res.write(frame('run.started', { run_id: 'R1' }) + frame('text.delta', { text: 'Hi' }));
    setTimeout(() => res.end(frame('tool.call', { id: 'c1', name: 'run_command' })
      + frame('run.ended', { reason: 'completed' })), 30);
  }, async (state) => {
    const seen = [];
    const watches = new Watches({ api, emit: (s, r, event, data) => seen.push([event, data]) });
    assert.equal(watches.start('S1', 'R1'), true);
    // Asked for again while it is read, as the window does on every look.
    assert.equal(watches.start('S1', 'R1'), true);
    await watches.active.get('S1').done;
    assert.deepEqual(seen.map((row) => row[0]), ['run.started', 'text.delta', 'tool.call', 'run.ended', 'watch.closed']);
    assert.deepEqual(seen.at(-1)[1], { ended: true, error: null });
    assert.equal(state.opened, 1);
    await until(() => state.open === 0);
  });
});

test('over real HTTP a watch that fails leaves no connection open', { timeout: 30000 }, async () => {
  await withServer((req, res) => {
    // A run that goes on: the stream stays open after its first event.
    res.write(frame('text.delta', { text: 'working' }));
  }, async (state) => {
    const seen = [];
    const watches = new Watches({ api, emit: (s, r, event) => {
      seen.push(event);
      if (event === 'text.delta') throw new Error('the window is gone');
    } });
    watches.start('S1', 'R1');
    await watches.active.get('S1').done;
    assert.deepEqual(seen, ['text.delta', 'watch.closed']);
    assert.equal(state.opened, 1);
    await until(() => state.open === 0);
  });
});

test('over real HTTP stopping a watch closes its connection', { timeout: 30000 }, async () => {
  await withServer((req, res) => {
    res.write(frame('text.delta', { text: 'working' }));
  }, async (state) => {
    const seen = [];
    const watches = new Watches({ api, emit: (s, r, event) => seen.push(event) });
    watches.start('S1', 'R1');
    const done = watches.active.get('S1').done;
    await until(() => seen.length === 1);
    assert.equal(state.open, 1);
    watches.stop('S1');
    await done;
    await until(() => state.open === 0);
    assert.deepEqual(seen, ['text.delta']);
  });
});

test('over real HTTP a run the server refuses is asked for once', { timeout: 30000 }, async () => {
  const saved = api.snapshot();
  let asked = 0;
  const server = http.createServer((req, res) => {
    asked += 1;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'No such run.' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api.configure({ apiBase: 'http://127.0.0.1:' + server.address().port + '/v1', apiKey: 'test' });
  try {
    const seen = [];
    const watches = new Watches({ api, emit: (s, r, event, data) => seen.push([event, data]), wait: async () => {} });
    watches.start('S1', 'R1');
    await watches.active.get('S1').done;
    assert.equal(asked, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], 'watch.closed');
    assert.equal(seen[0][1].ended, false);
    assert.ok(seen[0][1].error);
  } finally {
    api.configure(saved);
    await new Promise((resolve) => server.close(resolve));
  }
});
