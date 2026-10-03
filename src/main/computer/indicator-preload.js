'use strict';
// The only bridge the computer-use pill gets: what to show, and its two buttons.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('indicator', {
  onState: (listener) => ipcRenderer.on('indicator:state', (_event, state) => listener(state || {})),
  stop: () => ipcRenderer.send('indicator:stop'),
  open: () => ipcRenderer.send('indicator:open'),
});
