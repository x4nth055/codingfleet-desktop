'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const api = require('../src/core/api');
const { Run } = require('../src/core/runner');

test('SSE preserves frames and UTF-8 when CRLF is split across chunks', async () => {
  const bytes = Buffer.from(': keepalive\r\n\r\nevent: text.delta\r\ndata: {"text":"café"}\r\n\r\n');
  const body = (async function* () { for (const byte of bytes) yield Buffer.from([byte]); })();
  const result = [];
  for await (const frame of api.readEvents(body)) result.push(frame);
  assert.deepEqual(result, [{ event: 'text.delta', data: { text: 'café' } }]);
});

test('real HTTP reconnects and lost result responses never execute a tool twice', { timeout: 10000 }, async () => {
  const saved = api.snapshot();
  let starts = 0;
  let reconnects = 0;
  let beats = 0;
  let uploads = 0;
  let executed = 0;
  let accepted = false;
  let live;
  let releaseTool;
  const toolReady = new Promise((resolve) => { releaseTool = resolve; });
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const replay = frame('run.started', { run_id: 'R' })
    + frame('tool.call', { id: 'C', name: 'local_slow', executor: 'client', arguments: {} });
  const server = http.createServer(async (req, res) => {
    if (req.url.endsWith('/heartbeat')) {
      beats++;
      res.end('{}');
    } else if (req.url.endsWith('/tool_results')) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      assert.equal(JSON.parse(raw).output, 'kept output');
      uploads++;
      if (uploads === 1) { res.writeHead(503); res.end('{}'); }
      else if (uploads === 2) { accepted = true; req.socket.destroy(); }
      else {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'call_not_pending' } }));
        live.end(frame('run.ended', { reason: 'completed' }));
      }
    } else {
      if (req.method === 'POST') starts++;
      else reconnects++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(replay);
      if (reconnects < 2) setImmediate(() => res.destroy());
      else { live = res; releaseTool(); }
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api.configure({ apiBase: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test' });
  const seen = [];
  try {
    const run = new Run({ sessionId: 'S', approve: () => 'allow', onEvent: (event) => seen.push(event),
      clientHandlers: new Map([['local_slow', async (_, { signal }) => {
        executed++;
        await toolReady;
        assert.equal(signal.aborted, false);
        return { output: 'kept output' };
      }]]) });
    run.retryDelay = async () => {};
    await run.start({ message: 'test' });
    assert.equal(starts, 1);
    assert.equal(reconnects, 2);
    assert.equal(executed, 1);
    assert.equal(accepted, true);
    assert.equal(uploads, 3);
    assert.ok(beats >= 1);
    assert.equal(run.ended.reason, 'completed');
    assert.equal(seen.includes('client.error'), false);
  } finally {
    api.configure(saved);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a silent half-open stream times out, but keepalive bytes reset the watchdog', async (t) => {
  const saved = api.snapshot();
  api.configure({ apiKey: 'test' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let controller;
  t.mock.method(global, 'fetch', async (_, { signal }) => ({
    ok: true,
    body: new ReadableStream({ start(c) {
      controller = c;
      signal.addEventListener('abort', () => c.error(signal.reason), { once: true });
    } }),
  }));
  try {
    const stream = await api.runEvents('R');
    const next = stream.next();
    t.mock.timers.tick(60000);
    controller.enqueue(Buffer.from(': keepalive\n\n'));
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(60000);
    controller.enqueue(Buffer.from('event: text.delta\ndata: {"text":"alive"}\n\n'));
    assert.equal((await next).value.data.text, 'alive');
    const stalled = stream.next();
    t.mock.timers.tick(75000);
    await assert.rejects(stalled, (err) => err.transient === true);
  } finally { api.configure(saved); }
});
