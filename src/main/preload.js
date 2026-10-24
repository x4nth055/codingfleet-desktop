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
  sandboxSpecs: call('sandbox:specs'),
  sandboxSpecOptions: call('sandbox:specOptions'),
  sandboxSpec: call('sandbox:spec'),
  createSandboxSpec: call('sandbox:createSpec'),
  updateSandboxSpec: call('sandbox:updateSpec'),
  deleteSandboxSpec: call('sandbox:deleteSpec'),
  validateSandboxSpec: call('sandbox:validateSpec'),
  buildSandboxSpec: call('sandbox:buildSpec'),
  sandboxConfig: call('sandbox:config'),
  updateSandboxConfig: call('sandbox:updateConfig'),
  sandboxes: call('sandbox:list'),
  stopSandbox: call('sandbox:stop'),
  snapshotSandbox: call('sandbox:snapshot'),
  snapshots: call('sandbox:snapshots'),
  updateSnapshot: call('sandbox:updateSnapshot'),
  deleteSnapshot: call('sandbox:deleteSnapshot'),
  transcribe: call('audio:transcribe'),
  setTheme: call('theme:set'),
  pickFolder: call('dialog:pickFolder'),
  gitStatus: call('git:status'),
  gitDiff: call('git:diff'),
  githubStatus: call('github:status'),
  githubPulls: call('github:pulls'),
  githubInstall: call('github:install'),
  githubSignIn: call('github:signIn'),
  githubCancelSignIn: call('github:cancelSignIn'),
  githubSignOut: call('github:signOut'),
  githubOpenDevice: call('github:openDevice'),
  onGithubProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('github:progress', wrapped);
    return () => ipcRenderer.removeListener('github:progress', wrapped);
  },
  openFolder: call('shell:openFolder'),
  startRun: call('run:start'),
  recoverRuns: call('run:recover'),
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
  updateStatus: call('update:status'),
  checkForUpdate: call('update:check'),
  downloadUpdate: call('update:download'),
  installUpdate: call('update:install'),
  onUpdate: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('update:status', wrapped);
    return () => ipcRenderer.removeListener('update:status', wrapped);
  },
  sendCrashReport: call('diagnostics:send'),
  dismissCrash: call('diagnostics:dismiss'),
  openLogs: call('diagnostics:openLogs'),
  // Errors in the window, for the app's log. Fire and forget.
  logError: (message) => ipcRenderer.send('log:renderer', { message: String(message || '').slice(0, 4000) }),
  backgroundJobs: call('background:list'),
  stopBackground: call('background:stop'),
  backgroundTail: call('background:tail'),
  moveToBackground: call('background:move'),
  browserLayout: (layout) => ipcRenderer.send('browser:layout', layout),
  browserNavigate: call('browser:navigate'),
  browserCommand: call('browser:command'),
  browserPreset: call('browser:preset'),
  browserState: call('browser:state'),
  browserClear: call('browser:clear'),
  onBrowser: (listener) => {
    const channels = ['browser:state', 'browser:reveal', 'browser:shortcut'];
    const wrapped = channels.map((channel) => [channel, (_event, payload) => listener(channel, payload)]);
    for (const [channel, fn] of wrapped) ipcRenderer.on(channel, fn);
    return () => { for (const [channel, fn] of wrapped) ipcRenderer.removeListener(channel, fn); };
  },
  terminalShells: call('terminal:shells'),
  createTerminal: call('terminal:create'),
  terminals: call('terminal:list'),
  killTerminal: call('terminal:kill'),
  writeTerminal: (id, data) => ipcRenderer.send('terminal:write', { id, data }),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  onTerminalData: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('terminal:data', wrapped);
    return () => ipcRenderer.removeListener('terminal:data', wrapped);
  },
  onTerminalExit: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('terminal:exit', wrapped);
    return () => ipcRenderer.removeListener('terminal:exit', wrapped);
  },
  folders: call('files:folders'),
  fileIndex: call('files:index'),
  saveText: call('files:saveText'),
  onBackground: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('background:changed', wrapped);
    return () => ipcRenderer.removeListener('background:changed', wrapped);
  },
  // Codex, Claude Code and the other coding CLIs on this computer (Settings > Coding agents).
  codingAgents: call('codingAgents:get'),
  detectCodingAgents: call('codingAgents:detect'),
  setCodingAgent: call('codingAgents:set'),
  clearCodingAgentsLog: call('codingAgents:clearLog'),
  onCodingAgents: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('codingAgents:changed', wrapped);
    return () => ipcRenderer.removeListener('codingAgents:changed', wrapped);
  },
  // The path of a file dropped on the window (Electron no longer puts it on File).
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch { return ''; }
  },
  onOpenSession: (listener) => {
    const wrapped = (_event, sessionId) => listener(sessionId);
    ipcRenderer.on('app:openSession', wrapped);
    return () => ipcRenderer.removeListener('app:openSession', wrapped);
  },
  // A folder named when the app was started again: a new session there.
  onOpenFolder: (listener) => {
    const wrapped = (_event, dir) => listener(dir);
    ipcRenderer.on('app:openFolder', wrapped);
    return () => ipcRenderer.removeListener('app:openFolder', wrapped);
  },
  onRunEvent: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('run:event', wrapped);
    return () => ipcRenderer.removeListener('run:event', wrapped);
  },
  onGitChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('git:changed', wrapped);
    return () => ipcRenderer.removeListener('git:changed', wrapped);
  },
});
