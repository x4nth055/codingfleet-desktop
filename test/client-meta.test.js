'use strict';
// What a run tells CodingFleet about the app's settings: fixed words, flags
// and counts, never a path or a server's own name.
const assert = require('node:assert/strict');
const test = require('node:test');

const { clientMeta } = require('../src/core/client-meta');

const state = {
  permissionMode: 'ask', computerUse: true, autoUpdate: true,
  codingAgents: { codex: { access: 'allowed' }, aider: { access: 'off' } },
  codingAgentsDetected: { clis: [
    { id: 'codex', installed: true }, { id: 'claude', installed: true },
    { id: 'aider', installed: true }, { id: 'gemini', installed: false },
  ] },
};
const mcp = {
  remote: [
    { key: 'github', catalog: 'github', url: 'https://api.githubcopilot.com/mcp/', enabled: true },
    { key: 'acme', name: 'Acme internal', url: 'https://mcp.acme.internal/', enabled: true, token: 'secret' },
    { key: 'stripe', catalog: 'stripe', url: 'https://mcp.stripe.com', enabled: false },
  ],
  local: [{ name: 'fs', command: 'npx', enabled: true }, { name: 'db', command: 'node', enabled: false }],
};

test('a folder run says its settings, connectors and CLIs in fixed words', () => {
  const meta = clientMeta({ permissionMode: 'ask', platform: 'win32', shell: 'Git Bash', theme: 'dark', state, mcp,
    folder: { agentsMd: true, git: false }, terminals: 2 });
  assert.deepEqual(meta, {
    approval_mode: 'ask', platform: 'win32', shell: 'git_bash', theme: 'dark',
    browser: true, computer_use: true, auto_update: true,
    local_mcp: 1, mcp: ['github'], custom_mcp: 1, terminals: 2,
    clis: { codex: 'allowed', claude: 'ask', aider: 'off' },
    agents_md: true, git: false,
  });
});

test('nothing of a server, a folder or a key goes out', () => {
  const text = JSON.stringify(clientMeta({ permissionMode: 'auto', platform: 'linux', shell: 'bash', theme: 'light',
    state, mcp, folder: { agentsMd: false, git: true }, terminals: 0 }));
  for (const secret of ['acme', 'Acme', 'https://', 'secret', 'npx', 'fs']) assert.ok(!text.includes(secret), secret);
});

test('a cloud run has no folder to describe, and an unknown shell or platform is not guessed', () => {
  const meta = clientMeta({ permissionMode: 'auto', platform: 'freebsd', shell: 'nu', theme: 'hacker',
    state: { browser: false }, mcp: { remote: [], local: [] }, folder: null, terminals: 0 });
  assert.equal(meta.approval_mode, 'auto');
  assert.equal(meta.shell, 'other');
  assert.equal(meta.browser, false);
  assert.ok(!('platform' in meta));
  assert.ok(!('agents_md' in meta) && !('git' in meta));
  assert.deepEqual(meta.clis, {});
});
