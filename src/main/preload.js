'use strict';
// The only bridge between the window and the main process. The page gets these
// calls and nothing else: no Node, no filesystem, no network, and never the key.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('cf', {
  init: call('app:init'),
  saveSettings: call('settings:save'),
  removeKey: call('settings:removeKey'),
  signIn: call('auth:signIn'),
  cancelSignIn: call('auth:cancel'),
  credits: call('api:credits'),
  models: call('api:models'),
  sessions: call('api:sessions'),
  messages: call('api:messages'),
  session: call('api:session'),
  agent: call('api:agent'),
  renameSession: call('api:renameSession'),
  pinSession: call('api:pinSession'),
  duplicateSession: call('api:duplicateSession'),
  deleteSession: call('api:deleteSession'),
  getSettings: call('api:getSettings'),
  updateSettings: call('api:updateSettings'),
  mcpGet: call('mcp:get'),
  mcpSaveRemote: call('mcp:saveRemote'),
  mcpDeleteRemote: call('mcp:deleteRemote'),
  mcpSaveLocal: call('mcp:saveLocal'),
  mcpDeleteLocal: call('mcp:deleteLocal'),
  mcpLocalStatus: call('mcp:localStatus'),
  createSession: call('session:create'),
  setFolder: call('session:setFolder'),
  setSessionModel: call('session:setModel'),
  setState: call('state:set'),
  compactSession: call('api:compactSession'),
  billing: call('billing:get'),
  billingAction: call('billing:action'),
  byokList: call('byok:list'),
  byokSave: call('byok:save'),
  byokDelete: call('byok:delete'),
  transcribe: call('audio:transcribe'),
  setTheme: call('theme:set'),
  pickFolder: call('dialog:pickFolder'),
  openFolder: call('shell:openFolder'),
  startRun: call('run:start'),
  cancelRun: call('run:cancel'),
  steerRun: call('run:steer'),
  undoRun: call('run:undo'),
  decide: call('tool:decide'),
  pickFiles: call('files:pick'),
  describeFiles: call('files:describe'),
  uploadPath: call('files:uploadPath'),
  uploadData: call('files:uploadData'),
  deleteFile: call('files:delete'),
  image: call('files:image'),
  localImage: call('files:localImage'),
  copyText: call('clipboard:write'),
  screenshot: call('files:screenshot'),
  screenTargets: call('files:screenTargets'),
  // The path of a file dropped on the window (Electron no longer puts it on File).
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
  onOpenSession: (listener) => {
    const wrapped = (_event, sessionId) => listener(sessionId);
    ipcRenderer.on('app:openSession', wrapped);
    return () => ipcRenderer.removeListener('app:openSession', wrapped);
  },
  onRunEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('run:event', wrapped);
    return () => ipcRenderer.removeListener('run:event', wrapped);
  },
});
