'use strict';
// The run loop's side of a tool the app runs itself: take_screenshot never
// touches the filesystem tools, it goes to the handler the app registered,
// with the call it belongs to, and its output is posted back as the result.
const assert = require('node:assert/strict');
const test = require('node:test');

const api = require('../src/core/api');
const { Run } = require('../src/core/runner');

test('recovered uncertain tool waits for an explicit retry decision', async () => {
  const before = { runEvents: api.runEvents, toolResult: api.toolResult, heartbeat: api.heartbeat };
  const sent = [];
  let executed = 0;
  let decisions = 0;
  try {
    api.heartbeat = async () => ({});
    api.runEvents = async () => (async function* () {
      yield { event: 'run.started', data: { run_id: 'run' } };
      yield { event: 'tool.call', data: { id: 'call', name: 'local', executor: 'client', arguments: {} } };
      await new Promise((resolve) => setTimeout(resolve, 15));
      yield { event: 'run.ended', data: { reason: 'completed' } };
    }());
    api.toolResult = async (_run, _call, output, isError) => { sent.push({ output, isError }); };
    const calls = { call: { state: 'executing' } };
    const journal = {
      call: (id) => calls[id], setCall: (id, patch) => { calls[id] = { ...calls[id], ...patch }; },
      setRunId: () => {}, setChange: () => {},
    };
    const run = new Run({ sessionId: 'session', recovery: { runId: 'run' }, journal,
      approve: () => 'allow', confirmRetry: () => { decisions++; return 'deny'; }, onEvent: () => {},
      clientHandlers: new Map([['local', async () => { executed++; return { output: 'ran', is_error: false }; }]]),
    });
    await run.start();
    assert.equal(decisions, 1);
    assert.equal(executed, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].isError, true);
    assert.match(sent[0].output, /outcome is unknown/);
    assert.equal(calls.call.state, 'delivered');
  } finally { Object.assign(api, before); }
});

test('a saved result is resent after restart without running the tool again', async () => {
  const before = { runEvents: api.runEvents, toolResult: api.toolResult, heartbeat: api.heartbeat };
  let executions = 0;
  const posted = [];
  try {
    api.heartbeat = async () => ({});
    api.runEvents = async () => (async function* () {
      yield { event: 'run.started', data: { run_id: 'run' } };
      yield { event: 'tool.call', data: { id: 'call', name: 'local', executor: 'client', arguments: {} } };
      await new Promise((resolve) => setTimeout(resolve, 15));
      yield { event: 'run.ended', data: { reason: 'completed' } };
    }());
    api.toolResult = async (_run, _call, output) => { posted.push(output); };
    const calls = { call: { state: 'result', output: 'finished earlier', is_error: false } };
    const run = new Run({ sessionId: 'session', recovery: { runId: 'run' },
      journal: { call: (id) => calls[id], setCall: (id, patch) => { calls[id] = { ...calls[id], ...patch }; }, setRunId: () => {} },
      approve: () => { throw new Error('should not ask'); }, onEvent: () => {},
      clientHandlers: new Map([['local', async () => { executions++; return { output: 'again' }; }]]),
    });
    await run.start();
    assert.equal(executions, 0);
    assert.deepEqual(posted, ['finished earlier']);
    assert.equal(calls.call.state, 'delivered');
  } finally { Object.assign(api, before); }
});

// A stream of server events, as an async iterator of { event, data }.
function events(list) {
  return (async function* stream() {
    for (const item of list) yield item;
  }());
}

function stubbedApi(stream) {
  const posted = [];
  const before = { startRun: api.startRun, runEvents: api.runEvents, toolResult: api.toolResult, heartbeat: api.heartbeat };
  api.heartbeat = async () => ({});
  api.startRun = async () => stream;
  api.runEvents = async () => events([]);
  api.toolResult = async (runId, callId, output, isError) => {
    posted.push({ runId, callId, output, isError });
  };
  return { posted, restore: () => Object.assign(api, before) };
}

test('a screenshot call reaches the app handler with its call, and the picture goes back', async () => {
  const stream = events([
    { event: 'run.started', data: { run_id: 'RUN1' } },
    { event: 'tool.call', data: { id: 'CALL1', name: 'take_screenshot', executor: 'client', arguments: { window: 'Chrome' } } },
    { event: 'run.ended', data: { reason: 'completed' } },
  ]);
  const { posted, restore } = stubbedApi(stream);
  const seen = [];
  const asked = [];
  try {
    const run = new Run({
      sessionId: 'S1',
      cwd: process.cwd(),
      approve: (call) => { asked.push(call.name); return 'allow'; },
      onEvent: () => {},
      clientHandlers: new Map([['take_screenshot', async (args, context) => {
        seen.push({ args, call: context.call, cwd: context.cwd });
        return { output: { data: 'QUJD', width: 800, height: 600 }, is_error: false };
      }]]),
    });
    await run.start({ message: 'what is on my screen?' });
  } finally {
    restore();
  }
  assert.deepEqual(asked, ['take_screenshot']);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].args, { window: 'Chrome' });
  assert.equal(seen[0].call.id, 'CALL1');
  assert.deepEqual(posted, [{
    runId: 'RUN1', callId: 'CALL1', output: { data: 'QUJD', width: 800, height: 600 }, isError: false,
  }]);
});

test('a screenshot the user denies is answered, and never taken', async () => {
  const stream = events([
    { event: 'run.started', data: { run_id: 'RUN2' } },
    { event: 'tool.call', data: { id: 'CALL2', name: 'take_screenshot', executor: 'client', arguments: {} } },
    { event: 'run.ended', data: { reason: 'completed' } },
  ]);
  const { posted, restore } = stubbedApi(stream);
  let taken = 0;
  try {
    const run = new Run({
      sessionId: 'S1',
      approve: () => 'deny',
      onEvent: () => {},
      clientHandlers: new Map([['take_screenshot', async () => { taken += 1; return { output: {}, is_error: false }; }]]),
    });
    await run.start({ message: 'look at my screen' });
  } finally {
    restore();
  }
  assert.equal(taken, 0);
  assert.equal(posted[0].isError, true);
  assert.match(String(posted[0].output), /declined/);
});

test('a tool the app has no handler for is left for the built-in tools', async () => {
  const stream = events([
    { event: 'run.started', data: { run_id: 'RUN3' } },
    { event: 'tool.call', data: { id: 'CALL3', name: 'take_screenshot', executor: 'client', arguments: {} } },
    { event: 'run.ended', data: { reason: 'completed' } },
  ]);
  const { posted, restore } = stubbedApi(stream);
  try {
    const run = new Run({ sessionId: 'S1', approve: () => 'allow', onEvent: () => {} });
    await run.start({ message: 'hi' });
  } finally {
    restore();
  }
  // No handler and not a filesystem tool: the call is not answered at all,
  // which is what an older app without screenshots does.
  assert.deepEqual(posted, []);
});

test('repeated broken streams reconnect without aborting a running tool or executing it twice', async () => {
  const call = { event: 'tool.call', data: { id: 'C', name: 'local_long', executor: 'client', arguments: {} } };
  const started = { event: 'run.started', data: { run_id: 'R' } };
  const stub = stubbedApi((async function* () {
    yield started;
    yield call;
    throw new api.ApiError(0, null, 'socket reset');
  })());
  let reconnects = 0;
  let executions = 0;
  let approvals = 0;
  let finishTool;
  const toolDone = new Promise((resolve) => { finishTool = resolve; });
  const seen = [];
  try {
    api.runEvents = async () => {
      reconnects++;
      if (reconnects < 3) throw new api.ApiError(503);
      return (async function* () {
        yield started;
        yield call;
        if (reconnects === 3) return; // Clean EOF without run.ended also reconnects.
        finishTool();
        while (!stub.posted.length) await new Promise((resolve) => setImmediate(resolve));
        yield { event: 'run.ended', data: { reason: 'completed' } };
      })();
    };
    const run = new Run({ sessionId: 'S', approve: () => { approvals++; return 'allow'; },
      onEvent: (event) => seen.push(event),
      clientHandlers: new Map([['local_long', async (_, { signal }) => {
        executions++;
        await toolDone;
        assert.equal(signal.aborted, false);
        return { output: 'done' };
      }]]) });
    run.retryDelay = async () => {};
    await run.start({ message: 'work' });
    assert.equal(run.ended.reason, 'completed');
    assert.equal(reconnects, 4);
    assert.equal(executions, 1);
    assert.equal(approvals, 1);
    assert.equal(stub.posted.length, 1);
    assert.equal(seen.filter((x) => x === 'client.reconnecting').length, 2);
    assert.equal(seen.includes('client.error'), false);
  } finally { stub.restore(); }
});

test('failed result uploads retain exactly the same output until accepted', async () => {
  const stub = stubbedApi(events([]));
  const uploads = [];
  let executions = 0;
  try {
    api.toolResult = async (...args) => {
      uploads.push(args.slice(0, 4));
      if (uploads.length < 4) throw new api.ApiError(0, null, 'connect timeout');
    };
    const run = new Run({ sessionId: 'S', approve: () => 'allow', onEvent: () => {},
      clientHandlers: new Map([['local_once', async () => {
        executions++;
        return { output: { stdout: 'valuable result' }, is_error: false };
      }]]) });
    run.runId = 'R';
    run.retryDelay = async () => {};
    await run.handle({ id: 'C', name: 'local_once' });
    assert.equal(executions, 1);
    assert.equal(uploads.length, 4);
    assert.ok(uploads.every((x) => JSON.stringify(x) === JSON.stringify(uploads[0])));
  } finally { stub.restore(); }
});

test('a permanent upload rejection is surfaced once without retrying the tool', async () => {
  const stub = stubbedApi(events([]));
  const seen = [];
  let uploads = 0;
  try {
    api.toolResult = async () => { uploads++; throw new api.ApiError(401); };
    const run = new Run({ sessionId: 'S', approve: () => 'deny', onEvent: (event) => seen.push(event) });
    await run.handle({ id: 'C', name: 'fs_write' });
    assert.equal(uploads, 1);
    assert.equal(seen.filter((x) => x === 'client.error').length, 1);
  } finally { stub.restore(); }
});

test('an oversized result is answered with a concise tool error so heartbeats cannot leave it stuck', async () => {
  const stub = stubbedApi(events([]));
  const uploads = [];
  try {
    api.toolResult = async (...args) => {
      uploads.push(args.slice(0, 4));
      if (uploads.length === 1) throw new api.ApiError(413);
    };
    const run = new Run({ sessionId: 'S', approve: () => 'deny', onEvent: () => {} });
    await run.handle({ id: 'C', name: 'fs_read' });
    assert.equal(uploads.length, 2);
    assert.match(uploads[1][2], /output could not be returned/);
    assert.equal(uploads[1][3], true);
    assert.equal(run.controller.signal.aborted, false);
  } finally { stub.restore(); }
});

test('an uncertain start is never posted twice and a permanent reconnect refusal terminates', async () => {
  for (const started of [false, true]) {
    const stub = stubbedApi((async function* () {
      if (started) yield { event: 'run.started', data: { run_id: 'R' } };
      throw new api.ApiError(0);
    })());
    let retries = 0;
    const seen = [];
    try {
      api.runEvents = async () => { retries++; throw new api.ApiError(401); };
      const run = new Run({ sessionId: 'S', approve: () => 'allow', onEvent: (event) => seen.push(event) });
      run.retryDelay = async () => {};
      await run.start({ message: 'hello' });
      assert.equal(retries, started ? 1 : 0);
      assert.equal(seen.filter((x) => x === 'client.finished').length, 1);
      assert.equal(run.controller.signal.aborted, true);
    } finally { stub.restore(); }
  }
});

test('aborting a reconnect backoff releases the run promptly', async () => {
  const stub = stubbedApi(events([{ event: 'run.started', data: { run_id: 'R' } }]));
  const run = new Run({ sessionId: 'S', approve: () => 'allow', onEvent: () => {} });
  try {
    const job = run.start({ message: 'hi' });
    setImmediate(() => run.controller.abort());
    await job;
    assert.equal(run.controller.signal.aborted, true);
  } finally { stub.restore(); }
});

// A sub-agent's call to this computer is asked about like the main agent's:
// the person's answer decides whether it runs, and either way its result goes
// back under the sub-agent's call id.
test('a sub-agent call on this computer waits for the person and follows the answer', async () => {
  let bothPosted;
  const posted = new Promise((resolve) => { bothPosted = resolve; });
  const stub = stubbedApi((async function* () {
    yield { event: 'run.started', data: { run_id: 'R' } };
    yield { event: 'subagent.started', data: { agent_id: 'A', role: 'Worker', call_id: 'SPAWN' } };
    yield { event: 'tool.call', data: { id: 'OK', agent_id: 'A', name: 'local', executor: 'client', arguments: { n: 1 } } };
    yield { event: 'tool.call', data: { id: 'NO', agent_id: 'A', name: 'local', executor: 'client', arguments: { n: 2 } } };
    // The server holds the run open until the sub-agent's results come back.
    await posted;
    yield { event: 'run.ended', data: { reason: 'completed' } };
  })());
  const asked = [];
  const ran = [];
  const seen = [];
  const answers = { OK: 'allow', NO: 'deny' };
  try {
    const realPost = api.toolResult;
    api.toolResult = async (...args) => {
      await realPost(...args);
      if (stub.posted.length === 2) bothPosted();
    };
    const run = new Run({
      sessionId: 'S',
      // The person answers a moment later, as from the approval bar.
      approve: (call) => {
        asked.push({ id: call.id, agent: call.agent_id });
        return new Promise((resolve) => setTimeout(() => resolve(answers[call.id]), 10));
      },
      onEvent: (event, data) => seen.push([event, data.id]),
      clientHandlers: new Map([['local', async (args) => { ran.push(args.n); return { output: `ran ${args.n}`, is_error: false }; }]]),
    });
    await run.start({ message: 'delegate it' });
  } finally { stub.restore(); }
  assert.deepEqual(asked, [{ id: 'OK', agent: 'A' }, { id: 'NO', agent: 'A' }]);
  assert.deepEqual(ran, [1], 'only the allowed call ran');
  const byCall = Object.fromEntries(stub.posted.map((p) => [p.callId, p]));
  assert.deepEqual(byCall.OK, { runId: 'R', callId: 'OK', output: 'ran 1', isError: false });
  assert.equal(byCall.NO.isError, true);
  assert.match(byCall.NO.output, /declined/);
  // The window hears of the call before it is asked about it, so the bar has a row to sit on.
  const at = (event, id) => seen.findIndex(([e, i]) => e === event && i === id);
  assert.ok(at('tool.call', 'NO') >= 0 && at('tool.call', 'NO') < at('client.tool_denied', 'NO'));
  assert.ok(at('client.tool_running', 'OK') > at('tool.call', 'OK'));
  assert.equal(at('client.tool_running', 'NO'), -1);
});

test('a binary file the run wrote is handed to undo, which then says it cannot put it back', () => {
  const run = new Run({ sessionId: 'session', cwd: '/work', approve: () => 'allow', onEvent: () => {} });
  run.changes.set('/work/logo.png', { before: { exists: true, text: null }, after: { exists: true, text: null } });
  run.changes.set('/work/same.txt', { before: { exists: true, text: 'a' }, after: { exists: true, text: 'a' } });
  assert.deepEqual(run.restorePoints().map((entry) => entry.path), ['/work/logo.png']);
});
