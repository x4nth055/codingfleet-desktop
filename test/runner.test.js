'use strict';
// The run loop's side of a tool the app runs itself: take_screenshot never
// touches the filesystem tools, it goes to the handler the app registered,
// with the call it belongs to, and its output is posted back as the result.
const assert = require('node:assert/strict');
const test = require('node:test');

const api = require('../src/core/api');
const { Run } = require('../src/core/runner');

// A stream of server events, as an async iterator of { event, data }.
function events(list) {
  return (async function* stream() {
    for (const item of list) yield item;
  }());
}

function stubbedApi(stream) {
  const posted = [];
  const before = { startRun: api.startRun, runEvents: api.runEvents, toolResult: api.toolResult };
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
