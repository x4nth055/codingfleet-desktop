'use strict';
// A session packed out of the window's way and read back: the same data, the
// same links between its objects, none of the nodes it was drawn as.
const assert = require('node:assert/strict');
const test = require('node:test');

const pack = require('../src/renderer/lib/transcript-pack');

// Something drawn, as the window keeps it on an item: not data.
const fakeNode = () => ({ nodeType: 1, nodeName: 'DIV', mdBlocks: [{ nodes: ['…'] }] });

function session() {
  const group = { type: 'tools', sessionId: 's1', tools: [], open: true, history: true };
  group.tools.push(
    { id: 'c1', group, name: 'run_command', arguments: { command: 'npm test' }, status: 'done',
      output: { stdout: 'ok\n'.repeat(500), stderr: '', exit_code: 0 } },
    // A tool whose own arguments have a node and a group: theirs, kept.
    { id: 'c2', group, name: 'local_k8s_scale', arguments: { node: 'worker-1', group: { type: 'pool', size: 3 } },
      status: 'failed', output: 'error: no such pool', image: 'data:image/jpeg;base64,AAAA', imageTitle: 'The page' },
  );
  const items = [
    { type: 'note', text: 'Following AGENTS.md from this folder.' },
    { type: 'user', text: 'Fix the bug — and the tests ✓', at: '2026-10-30T10:00:00Z', checkpointId: 'cp1',
      files: [{ name: 'shot.png', kind: 'image', fileId: 'f1', preview: null }] },
    { type: 'stamp', at: '2026-10-30T10:00:05Z' },
    group,
    { type: 'assistant', text: 'Done. ```js\nconst a = 1;\n```', live: false, scheduled: false },
    { type: 'files', sessionId: 's1', files: [{ path: 'a.js', added: 3, removed: 1, hunks: [] }], open: new Set([0, 2]), runId: 'r1' },
    { type: 'computer', sessionId: 's1', steps: [{ verb: 'Click', what: 'OK', failed: false, image: null }], open: false },
    { type: 'footer', model: 'auto', usage: { credits: 1.5, context_tokens: 12000 } },
    { type: 'user', text: 'and the docs', steer: true },
  ];
  for (const item of items) item.node = fakeNode();
  items[1].navButton = fakeNode();
  const agentGroup = { type: 'tools', sessionId: 's1', agentId: 'a1', tools: [], open: false };
  agentGroup.tools.push({ id: 'c3', group: agentGroup, name: 'fs_read', arguments: { path: 'a.js' }, status: 'done' });
  const agents = new Map([['a1', {
    id: 'a1', sessionId: 's1', role: 'Reviewer', task: 'Review a.js', status: 'done', loaded: true, loading: true,
    items: [{ type: 'assistant', text: 'Looks fine.', node: fakeNode() }, agentGroup], credits: 0.4, summary: 'ok',
  }]]);
  const own = { text: 'Done.', items: items.slice(3) };
  return { items, agents, own };
}

// The data alone: what a JSON copy holds, nodes and back links aside.
const dataOf = (value) => JSON.parse(JSON.stringify(value, (key, v) => {
  if (v && typeof v === 'object' && typeof v.nodeType === 'number') return undefined;
  if (key === 'group' && v && v.type === 'tools') return undefined;
  if (v instanceof Set) return [...v];
  if (v instanceof Map) return [...v];
  return v;
}));

test('a packed session reads back as the same data, compressed in between', async () => {
  const before = session();
  const packed = await pack.pack(before);
  assert.ok(packed.bytes instanceof Uint8Array);
  assert.ok(packed.bytes.byteLength < packed.chars / 4, `compressed: ${packed.bytes.byteLength} bytes for ${packed.chars} characters`);
  const after = await pack.unpack(packed);
  assert.deepEqual(dataOf(after.items), dataOf(before.items));
  assert.deepEqual(dataOf([...after.agents.values()]), dataOf([...before.agents.values()].map((a) => ({ ...a, loading: false }))));
  assert.equal(after.own.text, 'Done.');
});

test('its objects are linked as they were, without the nodes they were drawn as', async () => {
  const after = await pack.unpack(await pack.pack(session()));
  const group = after.items[3];
  assert.ok(group.tools.every((tool) => tool.group === group), 'each tool knows its group');
  assert.deepEqual(group.tools[1].arguments, { node: 'worker-1', group: { type: 'pool', size: 3 } });
  assert.ok(after.items[5].open instanceof Set);
  assert.deepEqual([...after.items[5].open], [0, 2]);
  assert.ok(after.items.every((item) => !('node' in item) && !('navButton' in item)));
  // The turn the window drew is the transcript's own items, not copies.
  assert.equal(after.own.items.length, 6);
  after.own.items.forEach((item, i) => assert.equal(item, after.items[3 + i]));
  const agent = after.agents.get('a1');
  assert.equal(agent.loading, false);
  assert.equal(agent.items[1].tools[0].group, agent.items[1]);
  assert.ok(!('node' in agent.items[0]));
  assert.equal(after.items[1].text, 'Fix the bug — and the tests ✓');
});

test('a drawn turn that is not in the transcript any more is kept whole', async () => {
  const state = session();
  state.own = { text: 'Older.', items: [{ type: 'assistant', text: 'From a turn since rebuilt.' }] };
  const after = await pack.unpack(await pack.pack(state));
  assert.deepEqual(after.own, { text: 'Older.', items: [{ type: 'assistant', text: 'From a turn since rebuilt.' }] });
});

test('a session without sub-agents or a drawn turn packs too', async () => {
  const after = await pack.unpack(await pack.pack({ items: [{ type: 'user', text: 'hi' }] }));
  assert.deepEqual(after, { items: [{ type: 'user', text: 'hi' }], agents: null, own: null });
});

test('anything that is not a packed session is refused', async () => {
  assert.throws(() => pack.fromJson('{"items": []}'), /Not a packed session/);
  assert.throws(() => pack.fromJson('[]'), /Not a packed session/);
  await assert.rejects(pack.unpack({ bytes: new Uint8Array([1, 2, 3]) }));
  // An object that cannot be written as JSON: the session stays as it is.
  const loop = { type: 'note' };
  loop.self = loop;
  await assert.rejects(pack.pack({ items: [loop] }));
});
