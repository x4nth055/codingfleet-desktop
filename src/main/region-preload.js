'use strict';
// The only bridge the region overlay gets: a frozen picture of one screen, and
// the rectangle the user drew on it.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('region', {
  onImage: (listener) => ipcRenderer.on('region:image', (_event, data) => listener(data || {})),
  done: (rect) => ipcRenderer.send('region:done', rect),
  cancel: () => ipcRenderer.send('region:cancel'),
});
