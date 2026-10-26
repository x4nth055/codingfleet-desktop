'use strict';
const { contextBridge } = require('electron');

// The browser pane's side of the main process: the layouts the window sends
// (test/browser-pane.cjs reads them back), and a page already open.
const layouts = [];

contextBridge.exposeInMainWorld('cf', {
  init: async () => ({ ok: true, data: {
    platform: 'win32', version: 'test',
    settings: { hasKey: false, apiBase: 'https://codingfleet.com/v1' },
    state: { sessions: {}, permissionMode: 'ask' },
  } }),
  onRunEvent: () => {}, onOpenSession: () => {}, onGitChanged: () => {},
  setState: async () => ({ ok: true }),
  onBrowser: () => {},
  browserLayout: (layout) => { layouts.push(layout); },
  browserState: async () => ({ ok: true, data: {
    url: 'http://localhost:5173/', title: 'Dev server', loading: false, canGoBack: false, canGoForward: false, preset: 'desktop',
  } }),
  layouts: async () => layouts.slice(),
});
