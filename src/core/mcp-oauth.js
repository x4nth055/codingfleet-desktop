'use strict';
// OAuth sign-in to a remote MCP server. The app never holds the tokens: it
// asks CodingFleet to start a sign-in, opens the page in the user's browser,
// and waits. CodingFleet keeps the tokens and uses them when a run names the
// server with auth "oauth". No Electron in here: the CLI can use it too.

// The page to open must be on the API's own site: the address comes from a
// server answer, and it goes to the system browser.
function authorizeUrlFor(answer, apiBase) {
  let page;
  let base;
  try {
    page = new URL(String((answer && answer.authorize_url) || ''));
    base = new URL(String(apiBase || ''));
  } catch {
    throw new Error('The server gave no sign-in page.');
  }
  if (!/^https?:$/.test(page.protocol) || page.origin !== base.origin) {
    throw new Error('The server gave a sign-in page that is not on CodingFleet.');
  }
  return page.href;
}

const delay = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

// Ask how the sign-in went until it is done: { status: 'connected' | 'failed'
// | 'cancelled', error }. A request that fails for a moment (no connection)
// is tried again; the wait ends when the sign-in's time is up.
async function waitForSignIn(api, started, { signal, sleep = delay, now = Date.now } = {}) {
  const every = Math.max(1000, (Number(started.interval) || 2) * 1000);
  const deadline = now() + (Number(started.expires_in) || 900) * 1000;
  while (now() < deadline) {
    await sleep(every, signal);
    if (signal && signal.aborted) return { status: 'cancelled', error: null };
    let flow;
    try {
      flow = await api.mcpOAuthFlow(started.flow_id);
    } catch (err) {
      if (err && err.transient) continue;
      return { status: 'failed', error: (err && err.message) || 'The sign-in could not be read.' };
    }
    if (flow.status === 'connected') return { status: 'connected', error: null };
    if (flow.status === 'failed') return { status: 'failed', error: flow.error || 'The sign-in did not finish.' };
  }
  return { status: 'failed', error: 'The sign-in took too long. Start it again.' };
}

// Which of the saved servers the account is signed in to: Map url -> 'connected'
// | 'reauth' | 'none'. `connections` is GET /mcp_servers/oauth.
function signInStates(servers, connections) {
  const known = new Map();
  for (const row of connections || []) {
    known.set(canonical(row.url), row.needs_reauth ? 'reauth' : 'connected');
  }
  const out = new Map();
  for (const server of servers || []) {
    if (server.oauth) out.set(server.id, known.get(canonical(server.url)) || 'none');
  }
  return out;
}

// As the server keys a sign-in: lowercase scheme and host, no fragment, the
// rest as it was typed.
function canonical(url) {
  const text = String(url || '').trim().replace(/#.*$/, '');
  const parts = /^([a-z][a-z0-9+.-]*):\/\/([^/?]*)(.*)$/i.exec(text);
  return parts ? `${parts[1].toLowerCase()}://${parts[2].toLowerCase()}${parts[3]}` : text;
}

module.exports = { authorizeUrlFor, waitForSignIn, signInStates, canonical };
