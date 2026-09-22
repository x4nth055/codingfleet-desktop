'use strict';
const { contextBridge } = require('electron');

// Uncommitted changes in the folder a session works in: what the composer says
// above the prompt, and the diff a file row unfolds.
const SUMMARY = {
  repo: { root: 'C:/workspace/a-long-project-folder-name', name: 'a-long-project-folder-name', branch: 'feature/a-fairly-long-branch-name' },
  files: [
    { path: 'src/renderer/app.js', added: 480, removed: 12, status: 'modified', binary: false },
    { path: 'src/main/git.js', added: 51, removed: 0, status: 'untracked', binary: false },
    { path: 'assets/logo-final-final.png', added: 0, removed: 0, status: 'modified', binary: true },
  ],
  added: 531,
  removed: 12,
  count: 3,
  truncated: false,
};

contextBridge.exposeInMainWorld('cf', {
  init: async () => ({ ok: true, data: {
    platform: 'win32', version: 'test',
    settings: { hasKey: false, apiBase: 'https://codingfleet.com/v1' },
    state: { sessions: {}, permissionMode: 'auto' },
  } }),
  onRunEvent: () => {}, onOpenSession: () => {}, onGitChanged: () => {},
  setState: async () => ({ ok: true }),
  // A session's saved history, as the app reads it when it opens or refreshes
  // one. Its answer is the one test/transcript.cjs has this window draw itself,
  // so the reload has something to keep instead of the server's flat copy.
  messages: async () => ({ ok: true, data: { compactions: [], messages: [
    { role: 'user', text: 'Rework the sidebar.', created_at: '2026-09-22T10:00:00Z' },
    { role: 'assistant', text: 'Drawing it as it happened.', created_at: '2026-09-22T10:11:55Z', tools: [] },
  ] } }),
  gitStatus: async () => ({ ok: true, data: SUMMARY }),
  gitDiff: async () => ({ ok: true, data: {
    path: 'src/renderer/app.js',
    added: 2,
    removed: 1,
    truncated: false,
    binary: false,
    hunks: [{ lines: [
      { t: ' ', text: 'function renderComposer() {', old: 1, new: 1 },
      { t: '-', text: '  updateSendButton();', old: 2, new: null },
      { t: '+', text: '  updateSendButton();', old: null, new: 2 },
      { t: '+', text: '  ensureGit();', old: null, new: 3 },
    ] }],
  } }),
});
