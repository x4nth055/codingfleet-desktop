'use strict';
// A session the window has read but is not showing, packed: its transcript,
// its sub-agents and the turn the window drew itself, as gzip-compressed JSON
// bytes. Unpacking gives back the same objects (a tool's link to its group, a
// set, the drawn turn's items being the transcript's own), without the nodes
// they were drawn as. Read back from memory, it needs no request to the server.
// No DOM and no state: the window loads this before its own scripts, the tests
// require it.
(function (root) {
  // A set, in JSON. The key cannot come from a model's or a tool's JSON.
  const SET = '\u0000cf-set';

  // What an item was drawn as (item.node, item.navButton): not data.
  const isNode = (value) => typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
  // A tool's link back to its group, which holds it.
  const isGroup = (key, value) => key === 'group' && value.type === 'tools' && Array.isArray(value.tools);

  // By value, never by name alone: a tool's arguments can have a "node" or a
  // "group" of their own.
  function replacer(key, value) {
    if (!value || typeof value !== 'object') return value;
    if (isNode(value) || isGroup(key, value)) return undefined;
    if (value instanceof Set) return { [SET]: [...value] };
    return value;
  }

  function reviver(_key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value[SET])) {
      return new Set(value[SET]);
    }
    return value;
  }

  // Each tool knows the group it is in: dropped when packed, given back here.
  function relink(items) {
    for (const item of items || []) {
      if (item && item.type === 'tools' && Array.isArray(item.tools)) {
        for (const tool of item.tools) tool.group = item;
      }
    }
    return items;
  }

  /**
   * The plain form of a session's state.
   * @param {{ items: object[], agents?: Map, own?: { text: string, items: object[] } }} state
   */
  function toJson({ items, agents, own }) {
    const list = items || [];
    let ownTurn = null;
    if (own) {
      // The drawn turn is the transcript's own items: kept as their places in
      // it, so they are still the same objects once unpacked.
      const at = own.items.map((item) => list.indexOf(item));
      ownTurn = at.every((i) => i >= 0) ? { text: own.text, at } : { text: own.text, items: own.items };
    }
    return JSON.stringify({
      v: 1,
      items: list,
      agents: agents ? [...agents.values()] : null,
      own: ownTurn,
    }, replacer);
  }

  function fromJson(text) {
    const data = JSON.parse(text, reviver);
    if (!data || data.v !== 1 || !Array.isArray(data.items)) throw new Error('Not a packed session.');
    const items = relink(data.items);
    let agents = null;
    if (Array.isArray(data.agents)) {
      agents = new Map();
      for (const agent of data.agents) {
        relink(agent.items);
        agent.loading = false;
        agents.set(agent.id, agent);
      }
    }
    let own = null;
    if (data.own) {
      own = Array.isArray(data.own.at)
        ? { text: data.own.text, items: data.own.at.map((i) => items[i]) }
        : { text: data.own.text, items: relink(data.own.items || []) };
    }
    return { items, agents, own };
  }

  async function bytesOf(stream) {
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Packs a session's state. Throws when it cannot be written as JSON, and the
   * session then stays as it is.
   * @returns {Promise<{ bytes: Uint8Array, chars: number }>}
   */
  async function pack(state) {
    const json = toJson(state);
    const bytes = await bytesOf(new Response(json).body.pipeThrough(new CompressionStream('gzip')));
    return { bytes, chars: json.length };
  }

  /** The state `pack` was given, as new objects. */
  async function unpack({ bytes }) {
    const text = await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).text();
    return fromJson(text);
  }

  const api = { pack, unpack, toJson, fromJson };
  root.CF_TRANSCRIPT_PACK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
