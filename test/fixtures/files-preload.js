'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The window as test/file-links.cjs runs it: no account, and the calls answered
// by that script with the real linked-files.js and clipboard.js.
const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('cf', {
  init: async () => ({ ok: true, data: {
    platform: 'win32', version: 'test',
    settings: { hasKey: false, apiBase: 'https://codingfleet.com/v1' },
    state: { sessions: {}, permissionMode: 'auto' },
  } }),
  onRunEvent: () => {}, onOpenSession: () => {}, onGitChanged: () => {},
  setState: async () => ({ ok: true }),
  fileInfo: invoke('files:info'),
  readTextFile: invoke('files:readText'),
  openFile: invoke('files:open'),
  revealFile: invoke('files:reveal'),
  browseFile: invoke('files:browse'),
  localImage: invoke('files:localImage'),
  localImageInfo: invoke('files:localImageInfo'),
  copyText: invoke('clipboard:write'),
  copyImage: invoke('clipboard:writeImage'),
  browserNavigate: invoke('browser:navigate'),
});
