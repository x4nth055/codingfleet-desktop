'use strict';
const { contextBridge } = require('electron');

// The window as test/session-memory.cjs runs it: no account, and a server
// whose every session has a long history, which counts how often it is read.
const asked = [];
const saved = [];

function history(id) {
  const messages = [];
  for (let t = 0; t < 40; t++) {
    messages.push({ role: 'user', text: `${id} served turn ${t}: what changed?`, created_at: new Date(Date.UTC(2026, 9, 1, 10, t)).toISOString() });
    messages.push({
      role: 'assistant',
      text: `In ${id}, turn ${t} changed the parser.\n\n\`\`\`js\nconst turn = ${t};\n\`\`\``,
      created_at: new Date(Date.UTC(2026, 9, 1, 10, t, 30)).toISOString(),
      tools: [{ name: 'fs_read', arguments: { path: 'src/a.js' }, ok: true, text_offset: 0 }],
      model: 'auto', usage: { credits: 0.5 },
    });
  }
  return { compactions: [], messages };
}

contextBridge.exposeInMainWorld('cf', {
  init: async () => ({ ok: true, data: {
    platform: 'win32', version: 'test',
    settings: { hasKey: false, apiBase: 'https://codingfleet.com/v1' },
    state: { sessions: {}, permissionMode: 'auto' },
  } }),
  onRunEvent: () => {}, onOpenSession: () => {}, onGitChanged: () => {},
  setState: async () => ({ ok: true }),
  messages: async (id) => { asked.push(id); return { ok: true, data: history(id) }; },
  asked: async () => [...asked],
  session: async (id) => ({ ok: true, data: { id, busy: false } }),
  gitStatus: async () => ({ ok: false, error: { message: 'Not a git repository.' } }),
  saveText: async ({ name, text }) => { saved.push({ name, text }); return { ok: true, data: `C:\\exports\\${name}` }; },
  saved: async () => [...saved],
});
