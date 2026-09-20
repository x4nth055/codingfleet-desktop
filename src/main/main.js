'use strict';
const {
  app, BrowserWindow, Menu, Notification, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, safeStorage, screen,
  session, shell,
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const api = require('../core/api');
const config = require('../core/config');
const tools = require('../core/tools');
const { LocalMcp } = require('../core/mcp');
const { Run } = require('../core/runner');

// Development flags: --open=<session id>, --screenshot=<file.png>,
// --shot-delay=<ms>, --shot-menu=models|permissions|settings,
// --shot-cwd=<dir>, --shot-prompt=<text>, --shot-permission=auto, --shot-expand,
// --shot-model=<model id> (not saved), --shot-menu=effort|folder|attach|agents|quota, --shot-scroll=top,
// --shot-attach=<path>[|<path>...] (attaches files on start).
const argv = process.argv.slice(1);
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(name.length + 3) : true;
};
const SCREENSHOT = flag('screenshot');
// Applies to this process only; never written to the saved state.
const PERMISSION_OVERRIDE = flag('shot-permission');

// ---------------------------------------------------------------------------
// Local state: the folder each session works in, and a few preferences.
// ---------------------------------------------------------------------------
let state = { sessions: {}, lastCwd: null, model: 'auto', permissionMode: 'ask' };
// Capabilities the user may add to new sessions, on top of the ones every
// session has (code execution, web access, sub-agents).
const OPTIONAL_CAPABILITIES = ['image_generation', 'memory'];
const optionalCapabilities = () => Object.fromEntries(
  OPTIONAL_CAPABILITIES.map((key) => [key, Boolean((state.capabilities || {})[key])]));
const statePath = () => path.join(app.getPath('userData'), 'state.json');

function loadState() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) };
  } catch { /* first start */ }
}

function saveState() {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Credentials: the API key is encrypted with the OS keystore (DPAPI on
// Windows) and never reaches the window, which only learns whether one is set.
// ---------------------------------------------------------------------------
const credentialsPath = () => path.join(app.getPath('userData'), 'credentials.json');

function loadCredentials() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  } catch { /* none saved */ }
  let key = '';
  if (saved.key) {
    try {
      key = saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.key, 'base64')) : saved.key;
    } catch {
      key = '';
    }
  }
  api.configure({
    apiBase: config.ENV_API_BASE || saved.apiBase || config.DEFAULT_API_BASE,
    apiKey: config.ENV_API_KEY || key,
    client: `desktop/${app.getVersion()}`,
  });
}

function storeCredentials(apiBase, apiKey) {
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = {
    apiBase: apiBase && apiBase !== config.DEFAULT_API_BASE ? apiBase : null,
    key: apiKey ? (encrypted ? safeStorage.encryptString(apiKey).toString('base64') : apiKey) : null,
    encrypted,
  };
  fs.mkdirSync(path.dirname(credentialsPath()), { recursive: true });
  fs.writeFileSync(credentialsPath(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// MCP integrations. Remote servers are sent with each run; local ones are
// started here and their tools declared as client tools. Tokens and
// environment values are secrets: stored encrypted, never sent to the window.
// ---------------------------------------------------------------------------
let mcp = { remote: [], local: [] };
const localMcp = new LocalMcp();
const mcpPath = () => path.join(app.getPath('userData'), 'mcp.json');
const MAX_REMOTE = 10;
const MAX_LOCAL = 20;

function loadMcp() {
  try {
    const saved = JSON.parse(fs.readFileSync(mcpPath(), 'utf8'));
    const text = saved.encrypted
      ? safeStorage.decryptString(Buffer.from(saved.data, 'base64'))
      : saved.data;
    const parsed = JSON.parse(text);
    mcp = { remote: parsed.remote || [], local: parsed.local || [] };
  } catch { /* none saved */ }
  localMcp.configure(mcp.local);
}

function saveMcp() {
  const encrypted = safeStorage.isEncryptionAvailable();
  const text = JSON.stringify(mcp);
  const data = encrypted ? safeStorage.encryptString(text).toString('base64') : text;
  fs.mkdirSync(path.dirname(mcpPath()), { recursive: true });
  fs.writeFileSync(mcpPath(), JSON.stringify({ encrypted, data }), { mode: 0o600 });
  localMcp.configure(mcp.local);
}

function mcpView() {
  return {
    remote: mcp.remote.map((r) => ({
      id: r.id, key: r.key, name: r.name, url: r.url, catalog: r.catalog || null,
      authHeader: r.authHeader || null, tools: r.tools || null, enabled: Boolean(r.enabled),
      hasToken: Boolean(r.token),
    })),
    local: mcp.local.map((l) => ({
      id: l.id, name: l.name, command: l.command, args: l.args || [], enabled: Boolean(l.enabled),
      envKeys: Object.keys(l.env || {}),
    })),
  };
}

const newId = () => require('crypto').randomBytes(6).toString('hex');
const serverKey = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

function saveRemote(input) {
  const entry = input || {};
  const url = String(entry.url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error('The server URL must start with https://.');
  const name = String(entry.name || '').trim().slice(0, 60) || new URL(url).hostname;
  let key = serverKey(entry.key || name) || 'server';
  if (key.startsWith('local')) key = `remote_${key}`.slice(0, 40);
  let existing = mcp.remote.find((r) => r.id === entry.id);
  if (!existing) {
    if (mcp.remote.length >= MAX_REMOTE * 3) throw new Error('That is too many servers.');
    existing = { id: newId() };
    mcp.remote.push(existing);
  }
  const clash = mcp.remote.find((r) => r !== existing && r.key === key);
  if (clash) key = `${key.slice(0, 33)}_${existing.id.slice(0, 6)}`;
  Object.assign(existing, {
    key, name, url,
    catalog: entry.catalog || existing.catalog || null,
    authHeader: entry.authHeader ? String(entry.authHeader).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100) : null,
    tools: Array.isArray(entry.tools) ? entry.tools.filter((t) => typeof t === 'string').slice(0, 200) : null,
    enabled: Boolean(entry.enabled),
  });
  if (typeof entry.token === 'string') existing.token = entry.token.trim().slice(0, 4000) || null;
  if (existing.enabled && mcp.remote.filter((r) => r.enabled).length > MAX_REMOTE) {
    existing.enabled = false;
    saveMcp();
    throw new Error(`At most ${MAX_REMOTE} remote servers can be on at once.`);
  }
  saveMcp();
  return mcpView();
}

function parseEnv(text) {
  const env = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) throw new Error(`"${trimmed.slice(0, 40)}" is not NAME=value.`);
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return env;
}

function saveLocal(input) {
  const entry = input || {};
  const command = String(entry.command || '').trim();
  if (!command) throw new Error('Enter the command that starts the server.');
  const name = String(entry.name || '').trim().slice(0, 40) || path.basename(command);
  let existing = mcp.local.find((l) => l.id === entry.id);
  if (!existing) {
    if (mcp.local.length >= MAX_LOCAL) throw new Error(`At most ${MAX_LOCAL} local servers.`);
    existing = { id: newId(), env: {} };
    mcp.local.push(existing);
  }
  Object.assign(existing, {
    name,
    command,
    args: Array.isArray(entry.args) ? entry.args.map(String).slice(0, 50) : [],
    enabled: Boolean(entry.enabled),
  });
  // An empty box keeps the saved values: the window never saw them.
  if (typeof entry.env === 'string' && entry.env.trim()) existing.env = parseEnv(entry.env);
  if (entry.clearEnv) existing.env = {};
  saveMcp();
  return mcpView();
}

// The run's remote servers, in the API's shape.
function remoteServersForRun() {
  const servers = {};
  for (const r of mcp.remote) {
    if (!r.enabled) continue;
    const server = { url: r.url };
    if (r.token) server.token = r.token;
    if (r.token && r.authHeader) server.auth_header = r.authHeader;
    if (r.tools && r.tools.length) server.tools = r.tools;
    servers[r.key] = server;
  }
  return servers;
}

function settingsView() {
  const { apiBase, apiKey } = api.snapshot();
  return {
    apiBase,
    defaultApiBase: config.DEFAULT_API_BASE,
    hasKey: Boolean(apiKey),
    keyHint: apiKey ? `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}` : null,
    fromEnv: Boolean(config.ENV_API_KEY || config.ENV_API_BASE),
  };
}

function systemMessage(cwd) {
  const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform;
  const shellNote = tools.SHELL.unix
    ? `${tools.SHELL.name}. Use Unix commands and forward slashes in paths.`
    : 'Windows PowerShell 5.1. Use PowerShell syntax, and ";" instead of "&&".';
  return [
    "You are CodingFleet's coding agent, working on the user's computer through the CodingFleet desktop app.",
    `Working directory: ${cwd}`,
    `Operating system: ${os}. Shell for run_command and execute_code: ${shellNote}`,
    'Read files before you change them. Keep your answers short.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let win = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// The window's own colors for each theme: the background shown before the
// page paints, and the title bar buttons drawn over the top right.
const THEMES = {
  dark: { background: '#0d0f12', symbols: '#9aa3ad' },
  light: { background: '#ffffff', symbols: '#5b6470' },
  hacker: { background: '#020604', symbols: '#4fdc7f' },
};
const themeOf = (name) => (THEMES[name] ? name : 'dark');

function paintWindow(name) {
  const theme = THEMES[themeOf(name)];
  win.setBackgroundColor(theme.background);
  if (process.platform !== 'darwin') {
    win.setTitleBarOverlay({ color: theme.background, symbolColor: theme.symbols, height: 44 });
  }
}

function createWindow() {
  // --theme=light shows a theme for one start without saving it (screenshots).
  const startTheme = themeOf(flag('theme') || state.theme);
  const theme = THEMES[startTheme];
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'CodingFleet',
    backgroundColor: theme.background,
    titleBarStyle: 'hidden',
    // Windows and Linux draw their buttons over the top right; macOS keeps its
    // own at the top left and needs no overlay.
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : { titleBarOverlay: { color: theme.background, symbolColor: theme.symbols, height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { theme: startTheme } });

  win.once('ready-to-show', () => {
    win.show();
    if (SCREENSHOT) {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.resolve(SCREENSHOT), image.toPNG());
        app.quit();
      }, Number(flag('shot-delay')) || 3500);
    }
  });

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
    }
  });
  // Links open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
}

// ---------------------------------------------------------------------------
// IPC. Every handler answers { ok, data } or { ok: false, error }: an Error
// thrown across IPC loses its status and code.
// ---------------------------------------------------------------------------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, arg) => {
    try {
      return { ok: true, data: await fn(arg) };
    } catch (err) {
      return {
        ok: false,
        error: {
          message: err.message, status: err.status ?? null, code: err.code || null,
          details: err.details || null, transient: Boolean(err.transient),
        },
      };
    }
  });
}

const runs = new Map();       // session id -> Run
let signIn = null;            // the browser sign-in waiting for approval, if any
const approvals = new Map();  // tool call id -> { resolve, sessionId, reason }

// "Allow all ... this session" is kept per session and per REASON, not per tool
// name: a person who allowed file changes means fs_write, fs_edit and a script
// that writes a file alike. It is saved with the session, so it still holds
// after the app restarts — the session is what they gave permission for.
function allowedReasons(sessionId) {
  return new Set((state.sessions[sessionId] || {}).allow || []);
}

function rememberAllow(sessionId, reason) {
  const local = state.sessions[sessionId] || {};
  const allow = new Set(local.allow || []);
  allow.add(reason);
  state.sessions[sessionId] = { ...local, allow: [...allow] };
  saveState();
}

// ---------------------------------------------------------------------------
// Notifications: a run that finished or waits for an approval, told to someone
// who is not looking at the window. Clicking one opens that session.
// ---------------------------------------------------------------------------
function notify(sessionId, body) {
  if (state.notifications === false || !win || win.isDestroyed()) return;
  if (win.isFocused() && !win.isMinimized()) return;
  win.flashFrame(true);
  if (!Notification.isSupported()) return;
  const label = (state.sessions[sessionId] || {}).label;
  const note = new Notification({ title: label ? `CodingFleet: ${label}` : 'CodingFleet', body });
  note.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    send('app:openSession', sessionId);
  });
  note.show();
}

// view_image on this computer: the image, made small enough for a tool result
// (the server takes up to 1,000,000 characters) and for vision input.
const VIEW_MAX_SIDE = 1568;
const VIEW_MAX_B64 = 900_000;
const VIEW_MAX_FILE = 30 * 1024 * 1024;

async function viewLocalImage(args, { cwd }) {
  const source = String(args.source || '').trim();
  if (!source) return { output: 'No file path was given.', is_error: true };
  const file = tools.resolvePath(cwd, source);
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return { output: `${source} does not exist.`, is_error: true };
  }
  if (!stat.isFile()) return { output: `${source} is not a file.`, is_error: true };
  if (stat.size > VIEW_MAX_FILE) return { output: `${source} is too large to view (over 30 MB).`, is_error: true };
  const bytes = await fs.promises.readFile(file);
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) {
    // A format this decoder does not read (GIF, WebP): sent as it is when it
    // is small enough; the server checks and converts it.
    const data = bytes.toString('base64');
    if (data.length > VIEW_MAX_B64) {
      return { output: `${source} is too large to send in this format. Save it as PNG or JPEG and view that.`, is_error: true };
    }
    return { output: { data }, is_error: false };
  }
  const { width, height } = image.getSize();
  let side = Math.min(VIEW_MAX_SIDE, Math.max(width, height));
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = side / Math.max(width, height);
    const sized = scale < 1
      ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' })
      : image;
    let data = sized.toPNG();
    for (const quality of [90, 75, 60]) {
      if (Math.ceil(data.length / 3) * 4 <= VIEW_MAX_B64) break;
      data = sized.toJPEG(quality);
    }
    if (Math.ceil(data.length / 3) * 4 <= VIEW_MAX_B64) {
      const { width: w, height: h } = sized.getSize();
      return { output: { data: data.toString('base64'), width: w, height: h }, is_error: false };
    }
    side = Math.round(side * 0.7);
  }
  return { output: `${source} could not be made small enough to send.`, is_error: true };
}

const CLIENT_HANDLERS = new Map([['view_image', viewLocalImage]]);

const FINISHED_TEXT = {
  completed: 'The agent finished.',
  budget: 'The agent stopped: the message reached its credit cap.',
  error: 'The run stopped with an error.',
};

function approve(sessionId, cwd, call, localTools) {
  const reason = localTools && localTools.has(call.name)
    ? 'uses a local MCP tool'
    : tools.approvalReason(call.name, call.arguments, cwd);
  if (!reason || (PERMISSION_OVERRIDE || state.permissionMode) === 'auto') return 'allow';
  if (allowedReasons(sessionId).has(reason)) return 'allow';
  return new Promise((resolve) => {
    approvals.set(call.id, { resolve, sessionId, reason });
    send('run:event', { sessionId, event: 'client.approval', data: { id: call.id, reason } });
    notify(sessionId, `Waiting for your approval: the agent ${reason}.`);
  });
}

// ---------------------------------------------------------------------------
// Attachments. The window hands over a path it was given (file picker, drag and
// drop) or bytes it made (camera, paste); this process reads, checks and
// uploads them with the key the window never sees. The server decides what is
// acceptable; these checks only save a pointless upload.
// ---------------------------------------------------------------------------
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.json': 'application/json', '.zip': 'application/zip',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
};
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

// Sharp enough for the chat's image cards on a high-density screen.
const PREVIEW_PX = 520;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function previewOf(image) {
  if (!image || image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const scale = Math.min(1, PREVIEW_PX / Math.max(width, height));
  return image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) })
    .toDataURL();
}

// Documents only the server can read (it extracts their text); everything
// else without NUL bytes near the start is text the agent reads from disk.
const SERVER_READ_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.zip', '.rtf',
]);

function looksLikeText(file, ext) {
  if (SERVER_READ_EXTS.has(ext) || IMAGE_EXTS.has(ext)) return false;
  try {
    const handle = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(8192);
      const read = fs.readSync(handle, head, 0, head.length, 0);
      return !head.subarray(0, read).includes(0);
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
}

function describePath(file, cwd) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a file.`);
  const ext = path.extname(file).toLowerCase();
  const image = IMAGE_EXTS.has(ext);
  const inside = Boolean(cwd) && tools.isInside(cwd, file);
  return {
    path: file,
    name: path.basename(file),
    size: stat.size,
    kind: image ? 'image' : 'file',
    // Text the agent can read where it is, with its own file tools.
    text: looksLikeText(file, ext),
    inside,
    relative: inside ? path.relative(cwd, file).replace(/\\/g, '/') : null,
    preview: image && stat.size <= MAX_UPLOAD_BYTES ? previewOf(nativeImage.createFromPath(file)) : null,
  };
}

const sessionIdOf = (value) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null);

// Images read back from the server, newest last, so a preview and then the
// full view of the same image download it once.
const imageCache = new Map();
const IMAGE_CACHE_SIZE = 12;

async function uploadedImage(fileId) {
  if (typeof fileId !== 'string' || !fileId || fileId.length > 200) throw new Error('No image.');
  let image = imageCache.get(fileId);
  if (!image) {
    image = await api.fileContent(fileId);
    if (!IMAGE_MIMES.has(image.type)) throw new Error('Not an image.');
    if (imageCache.size >= IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value);
  }
  imageCache.delete(fileId);
  imageCache.set(fileId, image);
  return image;
}

const dataUrl = (image) => `data:${image.type};base64,${image.data.toString('base64')}`;

async function uploadBytes(data, name, type, sessionId) {
  if (!data || !data.length) throw new Error(`${name} is empty.`);
  if (data.length > MAX_UPLOAD_BYTES) throw new Error(`${name} is larger than 20 MB.`);
  return api.uploadFile(data, name, type || MIME_BY_EXT[path.extname(name).toLowerCase()], sessionIdOf(sessionId));
}

function registerIpc() {
  handle('app:init', () => ({
    settings: settingsView(),
    shell: tools.SHELL.name,
    platform: process.platform,
    state: { ...state, permissionMode: PERMISSION_OVERRIDE || state.permissionMode },
    openSession: flag('open'),
    shotMenu: flag('shot-menu'),
    shotCwd: flag('shot-cwd'),
    shotPrompt: flag('shot-prompt'),
    shotExpand: Boolean(flag('shot-expand')),
    shotModel: flag('shot-model'),
    shotScroll: flag('shot-scroll'),
    shotAttach: flag('shot-attach'),
  }));

  handle('settings:save', async ({ apiKey, apiBase } = {}) => {
    const previous = api.snapshot();
    const nextKey = String(apiKey || '').trim() || previous.apiKey;
    const nextBase = String(apiBase || '').trim().replace(/\/+$/, '') || config.DEFAULT_API_BASE;
    if (!nextKey) throw new Error('Paste your API key.');
    if (!/^https?:\/\/\S+$/i.test(nextBase)) throw new Error('The API server must be an http:// or https:// address.');
    api.configure({ apiBase: nextBase, apiKey: nextKey });
    let credits;
    try {
      credits = await api.credits();
    } catch (err) {
      api.configure({ apiBase: previous.apiBase, apiKey: previous.apiKey });
      if (err.status === 401) throw new Error('That key was refused. Check it, or create a new one.');
      throw err;
    }
    storeCredentials(nextBase, nextKey);
    return { settings: settingsView(), credits };
  });

  // Browser sign-in. The app never sees the password: the browser proves who
  // the user is, they approve this computer there, and the server hands back a
  // key of its own for this app.
  handle('auth:signIn', async ({ apiBase } = {}) => {
    const base = String(apiBase || '').trim().replace(/\/+$/, '') || config.DEFAULT_API_BASE;
    if (!/^https?:\/\/\S+$/i.test(base)) throw new Error('The API server must be an http:// or https:// address.');
    const previous = api.snapshot();
    const attempt = { cancelled: false };
    signIn = attempt;
    api.configure({ apiBase: base });
    try {
      const start = await api.startDeviceAuth(`${os.hostname()} (desktop app)`);
      await shell.openExternal(start.verify_url);
      const every = Math.max(1000, (Number(start.interval) || 3) * 1000);
      const deadline = Date.now() + (Number(start.expires_in) || 600) * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, every));
        if (attempt.cancelled) throw new Error('Sign-in cancelled.');
        let answer;
        try {
          answer = await api.pollDeviceAuth(start.device_code);
        } catch (err) {
          // A dropped connection or a busy server: ask again on the next tick.
          if (err.status === 0 || err.status >= 500) continue;
          throw err;
        }
        if (answer.status === 'denied') throw new Error('The sign-in was declined in the browser.');
        if (answer.status === 'approved' && answer.api_key) {
          api.configure({ apiBase: base, apiKey: answer.api_key });
          storeCredentials(base, answer.api_key);
          return { settings: settingsView(), credits: await api.credits() };
        }
      }
      throw new Error('The sign-in request expired. Try again.');
    } catch (err) {
      api.configure({ apiBase: previous.apiBase, apiKey: previous.apiKey });
      throw err;
    } finally {
      if (signIn === attempt) signIn = null;
    }
  });

  handle('auth:cancel', () => {
    if (signIn) signIn.cancelled = true;
    return true;
  });

  handle('settings:removeKey', () => {
    const { apiBase } = api.snapshot();
    api.configure({ apiKey: '' });
    storeCredentials(apiBase, null);
    return settingsView();
  });

  handle('files:pick', async ({ cwd } = {}) => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
      defaultPath: state.lastCwd || app.getPath('home'),
    });
    if (result.canceled) return [];
    return result.filePaths.map((file) => describePath(file, typeof cwd === 'string' ? cwd : null));
  });

  handle('files:describe', ({ paths, cwd } = {}) => (Array.isArray(paths) ? paths : [])
    .filter((p) => typeof p === 'string' && p)
    .map((file) => describePath(file, typeof cwd === 'string' ? cwd : null)));

  handle('files:uploadPath', async ({ path: file, sessionId } = {}) => {
    if (typeof file !== 'string' || !file) throw new Error('No file to upload.');
    const info = describePath(file, null);
    if (info.size > MAX_UPLOAD_BYTES) throw new Error(`${info.name} is larger than 20 MB.`);
    return uploadBytes(await fs.promises.readFile(file), info.name, null, sessionId);
  });

  handle('files:uploadData', async ({ name, type, data, sessionId } = {}) => {
    const bytes = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(data || []);
    return uploadBytes(bytes, path.basename(String(name || 'attachment')), type, sessionId);
  });

  handle('files:delete', (fileId) => api.deleteFile(fileId));

  // An uploaded image again, for a reopened session: small for the card, or whole.
  handle('files:image', async ({ fileId, full } = {}) => {
    const image = await uploadedImage(fileId);
    if (full) return dataUrl(image);
    const small = (image.type === 'image/png' || image.type === 'image/jpeg')
      ? previewOf(nativeImage.createFromBuffer(image.data)) : null;
    return small || dataUrl(image);
  });

  // A picture of the screen the window is on, taken with the window out of the way.
  handle('files:screenshot', async () => {
    const display = screen.getDisplayMatching(win.getBounds());
    const scale = display.scaleFactor || 1;
    const size = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };
    win.hide();
    try {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
      if (!source || source.thumbnail.isEmpty()) throw new Error('The screen could not be captured.');
      const png = source.thumbnail.toPNG();
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      return { name: `screenshot-${stamp}.png`, type: 'image/png', data: png, preview: previewOf(source.thumbnail) };
    } finally {
      win.show();
      win.focus();
    }
  });

  // The window has no clipboard permission; copying goes through here.
  handle('clipboard:write', (text) => {
    clipboard.writeText(String(text ?? '').slice(0, 5_000_000));
    return true;
  });

  handle('api:credits', () => api.credits());
  handle('api:models', () => api.models({ include: 'provider,family' }));
  handle('api:sessions', () => api.listSessions(100));
  handle('api:messages', (sessionId) => api.messages(sessionId));
  handle('api:compactSession', (sessionId) => api.compactSession(sessionId));
  handle('billing:get', () => api.billing());
  handle('billing:action', ({ id, action, method, body } = {}) => {
    const allowed = { invoices: ['GET'], cancel: ['POST'], resume: ['POST'], offer: ['GET', 'POST'], portal: ['POST'] };
    const verb = String(method || 'POST').toUpperCase();
    if (!allowed[action] || !allowed[action].includes(verb)) throw new Error('Unknown billing action.');
    return api.billingAction(String(id || ''), action, verb, body);
  });
  handle('byok:list', () => api.byokKeys());
  handle('byok:save', ({ provider, apiKey } = {}) => api.saveByokKey(String(provider || ''), String(apiKey || '')));
  handle('byok:delete', (provider) => api.deleteByokKey(String(provider || '')));
  // A voice recording from the window's microphone, to text.
  handle('audio:transcribe', ({ data, type } = {}) => {
    if (!(data instanceof Uint8Array) || !data.length) throw new Error('Nothing was recorded.');
    if (data.length > 10 * 1024 * 1024) throw new Error('The recording is too long. Keep it under two minutes.');
    return api.transcribe(Buffer.from(data), String(type || 'audio/webm'));
  });
  handle('api:session', (sessionId) => api.getSession(sessionId));
  handle('api:agent', ({ sessionId, agentId }) => api.agent(sessionId, agentId));
  handle('api:renameSession', ({ sessionId, title }) => api.updateSession(sessionId, { title }));
  handle('api:pinSession', ({ sessionId, pinned }) => api.updateSession(sessionId, { pinned: Boolean(pinned) }));
  handle('api:duplicateSession', async (sessionId) => {
    const copy = await api.duplicateSession(sessionId);
    // The copy works where the original did.
    const local = state.sessions[sessionId] || {};
    state.sessions[copy.id] = {
      cwd: local.cwd || null, model: local.model, label: copy.title || local.label || '', createdAt: Date.now(),
    };
    saveState();
    return copy;
  });
  handle('api:deleteSession', async (sessionId) => {
    if (runs.has(sessionId)) throw new Error('Stop the run in this session first.');
    const result = await api.deleteSession(sessionId);
    delete state.sessions[sessionId];
    saveState();
    return result;
  });
  handle('api:getSettings', () => api.getSettings());
  handle('api:updateSettings', (body) => api.updateSettings(body));

  handle('mcp:get', () => mcpView());
  handle('mcp:saveRemote', (entry) => saveRemote(entry));
  handle('mcp:deleteRemote', (id) => {
    mcp.remote = mcp.remote.filter((r) => r.id !== id);
    saveMcp();
    return mcpView();
  });
  handle('mcp:saveLocal', (entry) => saveLocal(entry));
  handle('mcp:deleteLocal', (id) => {
    mcp.local = mcp.local.filter((l) => l.id !== id);
    saveMcp();
    return mcpView();
  });
  // Starts the enabled local servers and says what each offers, or why it failed.
  handle('mcp:localStatus', () => localMcp.status());

  handle('theme:set', (name) => {
    state.theme = themeOf(name);
    saveState();
    paintWindow(state.theme);
    return state.theme;
  });

  handle('state:set', (patch) => {
    for (const key of ['model', 'permissionMode', 'lastCwd', 'notifications']) {
      if (patch && key in patch) state[key] = patch[key];
    }
    if (patch && patch.capabilities && typeof patch.capabilities === 'object') {
      state.capabilities = Object.fromEntries(OPTIONAL_CAPABILITIES.map((key) => [
        key, key in patch.capabilities ? Boolean(patch.capabilities[key]) : optionalCapabilities()[key]]));
    }
    saveState();
    return state;
  });

  handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose the folder CodingFleet works in',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: state.lastCwd || app.getPath('home'),
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle('shell:openFolder', async (dir) => {
    if (typeof dir === 'string' && fs.existsSync(dir)) await shell.openPath(dir);
    return true;
  });

  // No folder means a cloud sandbox: the tools run on CodingFleet's servers
  // instead of this computer, and nothing here is read or changed.
  handle('session:create', async ({ cwd, model, label }) => {
    if (cwd && !fs.existsSync(cwd)) throw new Error('Choose a folder that exists.');
    const session = await api.createSession({
      executor: cwd ? 'client' : 'sandbox',
      model: model || 'auto',
      system_message: cwd ? systemMessage(cwd) : undefined,
      // parallel_agents: the agent may hand tasks to sub-agents. In a folder
      // session their coding tools run here too, through the same approvals.
      capabilities: { code_execution: true, web_access: true, parallel_agents: true, ...optionalCapabilities() },
    });
    state.sessions[session.id] = {
      cwd: cwd || null, label: String(label || '').slice(0, 80), createdAt: Date.now(),
    };
    if (cwd) state.lastCwd = cwd;
    saveState();
    return session;
  });

  handle('session:setModel', ({ sessionId, model }) => {
    if (!sessionId || !model) return false;
    state.sessions[sessionId] = { ...(state.sessions[sessionId] || {}), model };
    saveState();
    return true;
  });

  handle('session:setFolder', ({ sessionId, cwd }) => {
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Choose a folder that exists.');
    state.sessions[sessionId] = { ...(state.sessions[sessionId] || {}), cwd };
    saveState();
    return true;
  });

  handle('run:start', async ({ sessionId, message, model, executor, files }) => {
    if (runs.has(sessionId)) throw new Error('This session already has a run going.');
    const local = state.sessions[sessionId] || {};
    local.model = model || 'auto';
    state.sessions[sessionId] = local;
    saveState();
    if (executor === 'client' && !local.cwd) throw new Error('Choose the folder this session works in first.');
    if (local.cwd && !local.label) {
      local.label = String(message).slice(0, 80);
      saveState();
    }
    // Local MCP tools run on this computer, so only a folder session has them.
    let localTools = new Map();
    let declared = [];
    if (local.cwd) {
      try {
        ({ declared, routes: localTools } = await localMcp.toolsForRun());
      } catch (err) {
        send('run:event', { sessionId, event: 'client.error', data: { message: `Local MCP servers: ${err.message}` } });
      }
    }
    if (runs.has(sessionId)) throw new Error('This session already has a run going.');
    const run = new Run({
      sessionId,
      cwd: local.cwd,
      localTools,
      clientHandlers: CLIENT_HANDLERS,
      approve: (call) => approve(sessionId, local.cwd, call, localTools),
      onEvent: (event, data) => {
        send('run:event', { sessionId, event, data });
        // Stopped from here: no need to say so.
        if (event === 'client.finished' && FINISHED_TEXT[data.reason]) notify(sessionId, FINISHED_TEXT[data.reason]);
      },
    });
    runs.set(sessionId, run);
    const body = { message, model: model || 'auto' };
    if (Array.isArray(files) && files.length) body.files = files.filter((x) => typeof x === 'string');
    const servers = remoteServersForRun();
    if (Object.keys(servers).length) body.mcp_servers = servers;
    if (declared.length) body.client_tools = declared;
    run.start(body).finally(() => {
      runs.delete(sessionId);
      for (const [callId, waiting] of approvals) {
        if (waiting.sessionId === sessionId) approvals.delete(callId);
      }
    });
    return true;
  });

  handle('run:cancel', async (sessionId) => {
    const run = runs.get(sessionId);
    if (!run) throw new Error('No run is going in this session.');
    return run.cancel();
  });

  handle('run:steer', async ({ sessionId, message, files }) => {
    const run = runs.get(sessionId);
    if (!run) throw new Error('No run is going in this session.');
    return run.steer(message, Array.isArray(files) ? files.filter((x) => typeof x === 'string') : []);
  });

  handle('tool:decide', ({ callId, decision }) => {
    const waiting = approvals.get(callId);
    if (!waiting) return false;
    approvals.delete(callId);
    if (decision === 'allow-session') rememberAllow(waiting.sessionId, waiting.reason);
    waiting.resolve(decision === 'deny' ? 'deny' : 'allow');
    return true;
  });
}

// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock() && !SCREENSHOT) {
  app.quit();
} else {
  app.setAppUserModelId('com.codingfleet.desktop');
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    // The window needs no device or browser permission.
    // The app's own page may use the microphone, for voice input. Nothing
    // else: no camera, no screen, no location, no other page.
    const ownPage = (url) => String(url || '').startsWith('file://');
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      const audioOnly = permission === 'media' && details && Array.isArray(details.mediaTypes)
        && details.mediaTypes.length > 0 && details.mediaTypes.every((type) => type === 'audio');
      callback(audioOnly && ownPage(details.requestingUrl));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin, details) =>
      permission === 'media' && (details || {}).mediaType === 'audio' && ownPage(details.securityOrigin || origin));
    loadState();
    loadCredentials();
    loadMcp();
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => localMcp.stopAll());

  // A run left going when the app closes would wait on this computer for tool
  // results that never come, holding one of the account's run slots. Cancel
  // them first; give up after a few seconds rather than hang the quit.
  let cancelledOnQuit = false;
  app.on('before-quit', (event) => {
    if (cancelledOnQuit || !runs.size) return;
    cancelledOnQuit = true;
    event.preventDefault();
    const cancels = [...runs.values()].map((run) => run.cancel().catch(() => null));
    Promise.race([Promise.allSettled(cancels), new Promise((resolve) => setTimeout(resolve, 3000))])
      .finally(() => app.quit());
  });
}
