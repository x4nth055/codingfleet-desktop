'use strict';
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('cf', {
  init: async () => ({ ok: true, data: {
    platform: 'win32', version: 'test',
    settings: { hasKey: false, apiBase: 'https://codingfleet.com/v1' },
    state: { sessions: {}, permissionMode: 'auto' },
  } }),
  onRunEvent: () => {}, onOpenSession: () => {},
  setState: async () => ({ ok: true }),
});
