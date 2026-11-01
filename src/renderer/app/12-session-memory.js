'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. The sessions the window keeps in memory.
//
// The LIVE_SESSIONS sessions opened last are kept as they are, ready to draw.
// Any other session the window has read is packed (lib/transcript-pack.js):
// its transcript, sub-agents and own last turn, compressed, and no longer in
// S.transcripts. Opening it again unpacks it, from memory, with no request to
// the server; so does an event of a run in it. A session with a run going, one
// loading, or one that could not be loaded is never packed.
const LIVE_SESSIONS = 5;
const TRIM_DELAY_MS = 1500;
const MAX_OPENED = 500;

const opened = [];           // session ids, the one opened last first
const packed = new Map();    // session id -> { bytes, chars, firstPrompt }
const packing = new Set();   // sessions being packed right now
const unpacking = new Map(); // session id -> the promise of its state
const heldEvents = new Map(); // session id -> run events that came while it was packed
let trimTimer = 0;

const isPacked = (id) => packed.has(id);

// The session on screen is the one opened last.
function noteOpened(id) {
  if (!id) return;
  const at = opened.indexOf(id);
  if (at !== 0) {
    if (at > 0) opened.splice(at, 1);
    opened.unshift(id);
    if (opened.length > MAX_OPENED) opened.length = MAX_OPENED;
  }
  scheduleTrim();
}

function scheduleTrim() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(trimSessions, TRIM_DELAY_MS);
}

const keptLive = (id) => id === S.current || opened.slice(0, LIVE_SESSIONS).includes(id);

function packable(id) {
  return !keptLive(id) && S.transcripts.has(id) && S.loaded.has(id) && !S.loading.has(id)
    && !S.running.has(id) && !S.remoteBusy.has(id) && !loadFailures.has(id)
    && !packing.has(id) && !unpacking.has(id) && !heldEvents.has(id);
}

async function trimSessions() {
  for (const id of [...S.transcripts.keys()]) {
    if (packable(id)) await packSession(id);
  }
}

function firstPrompt(items) {
  const first = items.find((item) => item.type === 'user');
  return first ? String(first.text || '').slice(0, 80) : '';
}

async function packSession(id) {
  const items = S.transcripts.get(id);
  const agents = S.agents.get(id) || null;
  const own = ownTurns.get(id) || null;
  const length = items.length;
  packing.add(id);
  let result;
  try {
    result = await CF_TRANSCRIPT_PACK.pack({ items, agents, own });
  } catch (err) {
    // Kept as it is: a session that cannot be packed still works.
    console.warn(`Session ${id} stays in memory: ${err.message}`);
    return;
  } finally {
    packing.delete(id);
  }
  // Anything that touched the session meanwhile wins: it is kept as it is.
  if (!packable(id) || S.transcripts.get(id) !== items || items.length !== length
    || (S.agents.get(id) || null) !== agents || (ownTurns.get(id) || null) !== own) return;
  packed.set(id, { ...result, firstPrompt: firstPrompt(items) });
  forgetNodes(id, { agents: true });
  S.transcripts.delete(id);
  S.loaded.delete(id);
  S.agents.delete(id);
  ownTurns.delete(id);
}

// A packed session's state, read back; the pack stays until restoreSession
// takes it. Null when it cannot be read, and the pack is dropped: the session
// is then read from the server, as one never opened is.
function readPacked(id) {
  if (unpacking.has(id)) return unpacking.get(id);
  const entry = packed.get(id);
  if (!entry) return Promise.resolve(null);
  const job = CF_TRANSCRIPT_PACK.unpack(entry).catch((err) => {
    console.warn(`Session ${id} could not be unpacked: ${err.message}`);
    if (packed.get(id) === entry) packed.delete(id);
    return null;
  }).finally(() => unpacking.delete(id));
  unpacking.set(id, job);
  return job;
}

// Puts a packed session back in memory. Items that came for it while it was
// packed (`pending`) go after its own, as they do after history read from the
// server. True when it was restored.
async function restoreSession(id) {
  const entry = packed.get(id);
  if (!entry) return false;
  const state = await readPacked(id);
  if (!state || packed.get(id) !== entry) return false;
  packed.delete(id);
  const pending = (S.transcripts.get(id) || []).filter((item) => item.type !== 'load-error');
  S.transcripts.set(id, [...state.items, ...pending]);
  if (state.agents) {
    const now = S.agents.get(id);
    if (!now) {
      S.agents.set(id, state.agents);
    } else {
      for (const [agentId, agent] of state.agents) {
        if (!now.has(agentId)) now.set(agentId, agent);
      }
    }
  }
  if (state.own && !ownTurns.has(id)) ownTurns.set(id, state.own);
  S.loaded.add(id);
  return true;
}

// A run event for a packed session: held, the session unpacked, then the
// events played in the order they came, as for a session in memory.
function holdRunEvent(payload) {
  const id = payload.sessionId;
  if (!packed.has(id) && !heldEvents.has(id)) return false;
  let queue = heldEvents.get(id);
  if (!queue) {
    queue = [];
    heldEvents.set(id, queue);
    restoreSession(id).finally(() => {
      heldEvents.delete(id);
      for (const held of queue) onRunEvent(held);
      if (S.current === id) renderMain();
    });
  }
  queue.push(payload);
  return true;
}

// The items of a session for reading (an export): from memory, unpacked from
// it, or null when the server has to be asked.
async function sessionItems(id) {
  if (S.loaded.has(id) && !loadFailures.has(id)) return transcriptOf(id);
  if (!packed.has(id)) return null;
  const state = await readPacked(id);
  return state ? state.items : null;
}

const packedPrompt = (id) => (packed.get(id) || {}).firstPrompt || '';

function dropPacked(id) {
  packed.delete(id);
  const at = opened.indexOf(id);
  if (at >= 0) opened.splice(at, 1);
}

function forgetAllSessions() {
  packed.clear();
  opened.length = 0;
  heldEvents.clear();
}

// For a look from the developer tools, and the tests: what is kept, and how.
function sessionMemory() {
  let bytes = 0;
  let chars = 0;
  for (const entry of packed.values()) {
    bytes += entry.bytes.byteLength;
    chars += entry.chars;
  }
  return {
    live: [...S.transcripts.keys()].filter((id) => S.loaded.has(id)),
    packed: [...packed.keys()],
    packedBytes: bytes,
    packedChars: chars,
    opened: opened.slice(0, LIVE_SESSIONS),
  };
}
