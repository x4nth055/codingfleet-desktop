'use strict';
// How the server places a finished turn's tool calls, read from the live API.
//
//   npx electron scripts/probe-tool-places.cjs                     # recent sessions
//   PROBE_SESSION=<id> npx electron scripts/probe-tool-places.cjs   # one session, every turn
//
// Uses the key the app already has encrypted in its own profile, so it reads
// nothing else and prints no secret. A turn whose `placed` count is short of
// its `tools` count is one the client can only show as one group at the top.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_API_BASE } = require('../src/core/config');

app.setPath('userData', path.join(process.env.APPDATA, 'CodingFleet'));

app.whenReady().then(async () => {
  const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'credentials.json'), 'utf8'));
  const key = saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.key, 'base64')) : saved.key;
  const base = saved.apiBase || DEFAULT_API_BASE;
  const get = async (p) => {
    const res = await fetch(base + p, {
      headers: { Authorization: `Bearer ${key}`, 'X-CodingFleet-Client': 'desktop/0.2.0' },
    });
    if (!res.ok) throw new Error(`${p} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const at = (tool) => (Number.isInteger(tool.text_offset) ? tool.text_offset : '-');
  const detail = (message) => {
    const tools = message.tools || [];
    const placed = tools.filter((t) => Number.isInteger(t.text_offset)).length;
    const where = {};
    for (const tool of tools) where[at(tool)] = (where[at(tool)] || 0) + 1;
    return { tools, placed, where };
  };

  const only = process.env.PROBE_SESSION;
  const sessions = only ? [{ id: only, title: only }]
    : (await get('/sessions?limit=15')).sessions;
  for (const session of sessions) {
    const data = await get(`/sessions/${session.id}/messages`);
    const turns = (data.messages || []).filter((m) => m.role === 'assistant' && (m.tools || []).length);
    if (!turns.length) continue;
    console.log(`\n${session.id} ${(session.title || '').slice(0, 40)}`);
    for (const message of turns) {
      const { tools, placed, where } = detail(message);
      const short = placed < tools.length ? `  <-- ${tools.length - placed} unplaced` : '';
      console.log(`   ${String(message.created_at).slice(11, 19)} tools=${tools.length} placed=${placed}`
        + ` text=${(message.text || '').length}${short}`);
      if (only) {
        console.log('      places: ' + JSON.stringify(where));
        console.log('      order : ' + tools.map((t) => `${t.name}@${at(t)}`).join(' '));
      }
    }
  }
  app.quit();
}).catch((err) => { console.error('PROBE FAILED', err.message); app.quit(); });
