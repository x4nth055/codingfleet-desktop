'use strict';

// The window's side of following another client's run (src/renderer/app/06-watch.js),
// run here against stand-ins for the transcript it draws into.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../src/renderer/app/06-watch.js'), 'utf8');

function setup({ accepts = true } = {}) {
  const transcripts = new Map();
  const transcriptOf = (id) => {
    if (!transcripts.has(id)) transcripts.set(id, []);
    return transcripts.get(id);
  };
  const calls = { watch: [], unwatch: [], render: 0, check: 0 };
  const context = {
    S: {
      current: 's1', running: new Map(), remoteBusy: new Set(['s1']),
      loaded: new Set(['s1', 's2']), loading: new Set(), sessions: [{ id: 's1', title: 'Old' }],
    },
    cf: {
      watchRun: (arg) => { calls.watch.push(arg); return Promise.resolve(accepts); },
      unwatchRun: (id) => { calls.unwatch.push(id); return Promise.resolve(true); },
    },
    call: (fn, arg) => fn(arg),
    transcriptOf,
    closeLiveText: (id) => { for (const item of transcriptOf(id)) if (item.type === 'assistant') item.live = false; },
    addItem: (id, item) => transcriptOf(id).push(item),
    appendText: (id, text) => {
      const items = transcriptOf(id);
      const last = items[items.length - 1];
      if (last && last.type === 'assistant' && last.live) last.text += text;
      else items.push({ type: 'assistant', text, live: true });
    },
    findTool: (id, toolId) => transcriptOf(id).flatMap((i) => i.tools || []).find((t) => t.id === toolId) || null,
    addTool: (id, tool) => transcriptOf(id).push({ type: 'tools', tools: [tool] }),
    updateTool: (id, toolId, patch) => Object.assign(context.findTool(id, toolId), patch),
    renderTranscript: () => { calls.render += 1; },
    renderSidebar: () => {},
    renderTopbar: () => {},
    checkCurrentSession: () => { calls.check += 1; },
    document: { querySelector: () => null },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  transcriptOf('s1').push({ type: 'user', text: 'earlier' }, { type: 'assistant', text: 'earlier answer', live: false });
  return { context, calls, items: () => transcriptOf('s1'), S: context.S };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const send = (context, event, data = {}, runId = 'r1', sessionId = 's1') =>
  context.onWatchEvent({ sessionId, runId, event, data });

test('a run of another client is drawn as it goes, under the transcript', async () => {
  const { context, calls, items, S } = setup();
  context.startWatch('s1', 'r1');
  // (Made in the window's own realm: compared as text.)
  assert.equal(JSON.stringify(calls.watch), JSON.stringify([{ sessionId: 's1', runId: 'r1' }]));
  send(context, 'status', { kind: 'thinking', state: 'started' });
  assert.equal(context.remoteWorkingHint('s1'), 'Thinking…');
  send(context, 'text.delta', { text: 'Let me ' });
  send(context, 'text.delta', { text: 'look.' });
  assert.equal(context.remoteWorkingHint('s1'), 'Live');
  send(context, 'tool.call', { id: 'c1', name: 'run_command', arguments: { command: 'ls' }, executor: 'client' });
  send(context, 'tool.result', { id: 'c1', ok: true, output: 'app.py' });
  send(context, 'text.delta', { text: 'One file.' });
  assert.deepEqual(items().slice(2).map((i) => i.type), ['assistant', 'tools', 'assistant']);
  assert.equal(items()[2].text, 'Let me look.');
  const tool = items()[3].tools[0];
  // Shown, never run or offered a button: no "queued", no local, no cloud.
  assert.deepEqual([tool.status, tool.output, tool.watched, tool.local, tool.cloud], ['done', 'app.py', true, undefined, undefined]);
  // Never a run of this app.
  assert.equal(S.running.size, 0);
});

test('when it ends the session is read again, and that run is not followed twice', async () => {
  const { context, calls, items, S } = setup();
  context.startWatch('s1', 'r1');
  send(context, 'text.delta', { text: 'Done.' });
  send(context, 'run.ended', { reason: 'completed' });
  send(context, 'watch.closed', { ended: true });
  assert.equal(S.watching.size, 0);
  assert.equal(calls.check, 1);
  // What was drawn stays until the saved turn replaces it.
  assert.equal(items().at(-1).text, 'Done.');
  assert.equal(items().at(-1).live, false);
  // The server may still list the run for a moment.
  context.startWatch('s1', 'r1');
  assert.equal(calls.watch.length, 1);
  // The next run is followed.
  context.startWatch('s1', 'r2');
  assert.equal(calls.watch.length, 2);
});

test('a watch lost before the end takes back what it drew', async () => {
  const { context, items, S } = setup();
  context.startWatch('s1', 'r1');
  send(context, 'text.delta', { text: 'Half an ans' });
  send(context, 'watch.closed', { ended: false, error: 'offline' });
  assert.equal(items().length, 2);
  assert.equal(S.watched.has('s1'), false);
  context.startWatch('s1', 'r1');     // and can be followed again, from the start
  assert.equal(S.watching.get('s1').runId, 'r1');
});

test('a reconnect replays the run: what was drawn goes first', async () => {
  const { context, items } = setup();
  context.startWatch('s1', 'r1');
  send(context, 'text.delta', { text: 'Hel' });
  send(context, 'tool.call', { id: 'c1', name: 'fs_read', arguments: {} });
  send(context, 'watch.reconnecting');
  assert.equal(items().length, 2);
  send(context, 'text.delta', { text: 'Hello' });
  assert.deepEqual(items().slice(2).map((i) => i.text), ['Hello']);
});

test('a sub-agent\'s own steps and another run\'s events are not drawn', async () => {
  const { context, items } = setup();
  context.startWatch('s1', 'r1');
  send(context, 'tool.call', { id: 'a1', name: 'fs_read', agent_id: 'agent-1' });
  send(context, 'subagent.text', { text: 'x' });
  send(context, 'text.delta', { text: 'late' }, 'r0');
  send(context, 'text.delta', { text: 'elsewhere' }, 'r1', 's9');
  assert.equal(items().length, 2);
});

test('dropping a watch stops the reading and takes back what it drew', async () => {
  const { context, calls, items, S } = setup();
  context.startWatch('s1', 'r1');
  send(context, 'text.delta', { text: 'Half' });
  context.dropWatch('s1');
  assert.deepEqual(calls.unwatch, ['s1']);
  assert.equal(items().length, 2);
  assert.equal(S.watching.size, 0);
  send(context, 'text.delta', { text: 'late' });       // an event still on its way
  assert.equal(items().length, 2);
  context.dropWatch('s1');                               // nothing to drop: nothing happens
  assert.deepEqual(calls.unwatch, ['s1']);
});

test('only the session on screen is followed', async () => {
  const { context, calls, S } = setup();
  context.startWatch('s1', 'r1');
  S.current = 's2';
  context.dropWatchesExcept('s2');
  assert.deepEqual(calls.unwatch, ['s1']);
  assert.equal(S.watching.size, 0);
});

test('not beside a run of this app, and not before the history is in', async () => {
  const { context, calls, S } = setup();
  S.running.set('s1', { runId: 'mine' });
  context.startWatch('s1', 'r1');
  S.running.clear();
  S.loading.add('s1');
  context.startWatch('s1', 'r1');
  S.loading.clear();
  S.loaded.delete('s1');
  context.startWatch('s1', 'r1');
  assert.equal(calls.watch.length, 0);
  assert.equal(S.watching.size, 0);
});

test('a run the main process will not follow leaves the window as it was', async () => {
  const { context, items, S } = setup({ accepts: false });
  context.startWatch('s1', 'r1');
  send(context, 'text.delta', { text: 'x' });
  await flush();
  assert.equal(S.watching.size, 0);
  assert.equal(items().length, 2);
  assert.equal(context.remoteWorkingHint('s1'), 'This view updates when it finishes');
});

test('an app from before this could follow nothing: no call is made', async () => {
  const { context, calls, S } = setup();
  delete context.cf.watchRun;
  context.startWatch('s1', 'r1');
  assert.equal(calls.watch.length, 0);
  assert.equal(S.watching.size, 0);
});
