'use strict';
// Where a message sent while the agent works (a steer) sits in the answer:
// at the place the answer had reached when it was sent, as a prompt does in
// the flow. The web chat and the phone app place steers by the same rules.
// No DOM and no state: the window loads this before its own scripts, the
// tests require it.
(function (root) {
  const FENCE = /^ {0,3}(```|~~~)/;

  /**
   * The place a steer goes in an answer's text: the first place at or after
   * `offset` that does not cut a paragraph or a code block. That is the end of
   * the text, or a place directly before or after a blank line ("\n\n"); and
   * one inside a fenced code block moves past the line that closes the block
   * (to the end of the text, when nothing closes it).
   */
  function snapSteerOffset(text, offset) {
    const t = String(text == null ? '' : text);
    const n = Number(offset);
    let at = Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), t.length) : 0;
    // The start of the text splits nothing (the web chat and the phone agree).
    if (at === 0) return 0;
    while (at < t.length && !t.startsWith('\n\n', at) && !(at >= 2 && t.slice(at - 2, at) === '\n\n')) at += 1;
    if (at >= t.length) return t.length;
    // The fence lines that begin before this place: an odd count is an open block.
    let fences = 0;
    let lineStart = 0;
    while (lineStart < at) {
      const end = t.indexOf('\n', lineStart);
      const line = t.slice(lineStart, end < 0 ? t.length : end);
      if (FENCE.test(line)) fences += 1;
      if (end < 0) break;
      lineStart = end + 1;
    }
    if (fences % 2 === 0) return at;
    // Past the next fence line (the first that begins here or later), which
    // closes the block.
    const newline = t.indexOf('\n', at);
    let from = t[at - 1] === '\n' ? at : newline < 0 ? t.length : newline + 1;
    while (from < t.length) {
      const end = t.indexOf('\n', from);
      const line = t.slice(from, end < 0 ? t.length : end);
      if (FENCE.test(line)) return end < 0 ? t.length : end;
      if (end < 0) break;
      from = end + 1;
    }
    return t.length;
  }

  const isCount = (value) => Number.isInteger(value) && value >= 0;

  /** A place the server gave for a steer, or null when it gave none. */
  function validPlace(place) {
    return place && isCount(place.text_offset) && isCount(place.after_tools) ? place : null;
  }

  /**
   * An answer cut into what is drawn, in order: its text between the tools
   * (`{ type: 'text', text }`), its tools (`{ type: 'tool', index }`) and the
   * steers sent while it was written (`{ type: 'steer', index, at, after }`).
   * A tool sits at its `text_offset`; one with none, where the text has got
   * to. A steer sits at its snapped `text_offset`, after the first
   * `after_tools` tools and before the rest. It never goes past the place of
   * the first tool after it, where the text is cut already. A steer with no
   * place (`null`, an older turn) comes first, marked `top`.
   * @param {string} text
   * @param {{ text_offset?: number }[]} tools
   * @param {({ text_offset: number, after_tools: number } | null)[]} places
   */
  function answerPieces(text, tools, places) {
    const t = String(text == null ? '' : text);
    const list = tools || [];
    const offsetOf = (tool) => (tool && Number.isInteger(tool.text_offset)
      ? Math.min(Math.max(tool.text_offset, 0), t.length) : null);
    const pieces = [];
    const placed = [];
    (places || []).forEach((raw, index) => {
      const place = validPlace(raw);
      if (!place) {
        pieces.push({ type: 'steer', index, top: true });
        return;
      }
      const after = Math.min(place.after_tools, list.length);
      const offset = Math.min(place.text_offset, t.length);
      let at = snapSteerOffset(t, offset);
      const next = after < list.length ? offsetOf(list[after]) : null;
      if (next != null && next >= offset) at = Math.min(at, next);
      placed.push({ index, at, after });
    });
    placed.sort((a, b) => a.after - b.after || a.index - b.index);

    let cursor = 0;
    const textTo = (upTo) => {
      if (upTo <= cursor) return;
      const chunk = t.slice(cursor, upTo).trim();
      cursor = upTo;
      if (chunk) pieces.push({ type: 'text', text: chunk });
    };
    let s = 0;
    const steersBefore = (toolIndex) => {
      while (s < placed.length && placed[s].after <= toolIndex) {
        const steer = placed[s++];
        textTo(steer.at);
        pieces.push({ type: 'steer', index: steer.index, at: Math.max(steer.at, cursor), after: steer.after });
      }
    };
    list.forEach((tool, index) => {
      steersBefore(index);
      const at = offsetOf(tool);
      textTo(at == null ? cursor : at);
      pieces.push({ type: 'tool', index });
    });
    steersBefore(Infinity);
    textTo(t.length);
    return pieces;
  }

  // ── A live answer ─────────────────────────────────────────────────────────
  // A run drawn as it goes (`flow`: a run of this app, or one followed from
  // another client) counts the text and the tool calls it has drawn. A steer
  // sent now is placed by those counts; one drawn already is held when the run
  // is replayed from its start, and put back once the replay reaches its place.

  /** Where a steer sent now sits in the live answer. */
  function livePlace(flow) {
    return { text: (flow && flow.textSeen) || 0, tools: (flow && flow.toolsSeen) || 0 };
  }

  /** The answer starts over: the steers among `items` wait for their place again. */
  function holdSteers(flow, items) {
    if (!flow) return;
    const steers = (items || []).filter((item) => item && item.type === 'user' && item.steer);
    const held = [...(flow.heldSteers || []), ...steers];
    const key = (item) => item.place || { text: 0, tools: 0 };
    flow.heldSteers = held.map((item, i) => ({ item, i }))
      .sort((a, b) => (key(a.item).tools - key(b.item).tools) || (key(a.item).text - key(b.item).text) || a.i - b.i)
      .map((entry) => entry.item);
    flow.textSeen = 0;
    flow.toolsSeen = 0;
  }

  const isDue = (flow, item) => {
    const place = item.place || {};
    return (flow.toolsSeen || 0) >= (place.tools || 0) && (flow.textSeen || 0) >= (place.text || 0);
  };

  /** Puts back (`put`) each held steer whose place the answer has reached. */
  function releaseSteers(flow, put) {
    const held = flow && flow.heldSteers;
    while (held && held.length && isDue(flow, held[0])) put(held.shift());
  }

  /** Every held steer, now: the run is over. */
  function flushSteers(flow, put) {
    const held = flow && flow.heldSteers;
    while (held && held.length) put(held.shift());
  }

  /** More text of the answer: written (`write`), cut where a held steer goes back. */
  function feedText(flow, text, write, put) {
    let rest = String(text == null ? '' : text);
    if (!flow) {
      if (rest) write(rest);
      return;
    }
    const held = flow.heldSteers;
    while (rest && held && held.length) {
      const place = held[0].place || {};
      if ((flow.toolsSeen || 0) < (place.tools || 0)) break;
      const need = (place.text || 0) - (flow.textSeen || 0);
      if (need >= rest.length) break;
      if (need > 0) {
        write(rest.slice(0, need));
        flow.textSeen = (flow.textSeen || 0) + need;
        rest = rest.slice(need);
      }
      releaseSteers(flow, put);
    }
    if (rest) {
      write(rest);
      flow.textSeen = (flow.textSeen || 0) + rest.length;
    }
    releaseSteers(flow, put);
  }

  /** One more tool call drawn in the answer. */
  function feedTool(flow, put) {
    if (!flow) return;
    flow.toolsSeen = (flow.toolsSeen || 0) + 1;
    releaseSteers(flow, put);
  }

  const api = {
    snapSteerOffset, validPlace, answerPieces, livePlace, holdSteers, releaseSteers, flushSteers, feedText, feedTool,
  };
  root.CF_STEER = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
