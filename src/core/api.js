'use strict';
// Client for the CodingFleet Agent API. No Electron in here: the CLI uses it too.
const { DEFAULT_API_BASE, ENV_API_BASE, ENV_API_KEY } = require('./config');

const normalizeBase = (base) => String(base || '').trim().replace(/\/+$/, '');

// Set at runtime (Settings, the CLI's config); the environment is the default.
const credentials = {
  base: normalizeBase(ENV_API_BASE) || DEFAULT_API_BASE,
  key: ENV_API_KEY || '',
};

// `client` names the app on every request ("desktop/0.1.0"): the server prices
// the desktop app's runs like the web chat's.
function configure({ apiBase, apiKey, client } = {}) {
  if (apiBase !== undefined) credentials.base = normalizeBase(apiBase) || DEFAULT_API_BASE;
  if (apiKey !== undefined) credentials.key = String(apiKey || '').trim();
  if (client !== undefined) credentials.client = String(client || '');
}

// Includes the key. For the process that owns it, never for a window.
const snapshot = () => ({ apiBase: credentials.base, apiKey: credentials.key });

class ApiError extends Error {
  constructor(status, payload, fallback) {
    const err = (payload && payload.error) || {};
    super(err.message || fallback || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = err.code || null;
    this.details = err;
    // Worth trying again later: no connection, or the server is down or busy.
    this.transient = status === 0 || status === 429 || status >= 500;
  }
}

function headers() {
  if (!credentials.key) {
    throw new ApiError(401, { error: { message: 'Add your CodingFleet API key in Settings.', code: 'missing_token' } });
  }
  return { ...authHeaders(), 'Content-Type': 'application/json' };
}

// For requests with a body of their own (multipart) or none.
function authHeaders() {
  if (!credentials.key) {
    throw new ApiError(401, { error: { message: 'Add your CodingFleet API key in Settings.', code: 'missing_token' } });
  }
  const out = { Authorization: `Bearer ${credentials.key}` };
  if (credentials.client) out['X-CodingFleet-Client'] = credentials.client;
  return out;
}

function unreachable(err) {
  const reason = (err.cause && (err.cause.code || err.cause.message)) || err.message;
  return new ApiError(0, null, `Cannot reach ${credentials.base} (${reason}).`);
}

async function fail(res) {
  let text;
  try { text = await res.text(); } catch (err) { throw unreachable(err); }
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* not JSON */ }
  return new ApiError(res.status, payload, plainError(res.status, text));
}

// A proxy's error page is HTML meant for a browser: never show it as a message.
function plainError(status, text) {
  if (status === 502 || status === 503 || status === 504) {
    return 'CodingFleet is not responding right now. The app tries again on its own.';
  }
  if (status === 429) return 'Too many requests. Wait a moment, then try again.';
  const body = String(text || '').trim();
  if (!body || body.startsWith('<')) return `The server answered with an error (HTTP ${status}).`;
  return body.slice(0, 200);
}

async function request(method, path, body, signal, timeoutMs) {
  const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : null;
  const init = { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeout ? (signal ? AbortSignal.any([signal, timeout]) : timeout) : signal };
  let res;
  try {
    res = await fetch(credentials.base + path, init);
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw unreachable(err);
  }
  if (!res.ok) throw await fail(res);
  let text;
  try { text = await res.text(); } catch (err) {
    if (signal?.aborted) throw signal.reason;
    throw unreachable(err);
  }
  return text ? JSON.parse(text) : null;
}

function parseFrame(raw) {
  let event = 'message';
  const data = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return null;
  const text = data.join('\n');
  try {
    return { event, data: JSON.parse(text) };
  } catch {
    return { event, data: text };
  }
}

// Server-sent events, one { event, data } at a time. Frames are rebuilt from
// the byte stream, since a transport can split one anywhere.
async function* readEvents(body, onActivity = () => {}) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    onActivity();
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const frame = parseFrame(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      if (frame) yield frame;
    }
  }
  const tail = parseFrame(buffer);
  if (tail) yield tail;
}

async function openStream(method, path, body, signal) {
  // A half-open socket can otherwise wait forever. Server keepalives arrive
  // every 20 seconds even while a tool or approval takes hours.
  const watchdog = new AbortController();
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => watchdog.abort(), 75000);
    timer.unref?.();
  };
  const init = { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, watchdog.signal]) : watchdog.signal };
  let res;
  try {
    touch();
    res = await fetch(credentials.base + path, init);
    if (!res.ok) throw await fail(res);
  } catch (err) {
    clearTimeout(timer);
    if (signal?.aborted) throw signal.reason;
    if (err instanceof ApiError) throw err;
    throw unreachable(err);
  }
  return (async function* () {
    try {
      yield* readEvents(res.body, touch);
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      throw unreachable(err);
    } finally {
      clearTimeout(timer);
      watchdog.abort();
    }
  }());
}

// Browser sign-in. These two calls carry no key: they are how one is obtained.
async function unauthenticated(method, path, body) {
  let res;
  try {
    res = await fetch(credentials.base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw unreachable(err);
  }
  if (!res.ok) throw await fail(res);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// One file, as multipart form data. `data` is a Buffer or Uint8Array.
async function upload(data, filename, contentType, sessionId) {
  const form = new FormData();
  // With a sandbox session's id the file goes into that session's sandbox.
  if (sessionId) form.append('session_id', sessionId);
  form.append('file', new Blob([data], { type: contentType || 'application/octet-stream' }), filename);
  let res;
  try {
    res = await fetch(`${credentials.base}/files`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
  } catch (err) {
    throw unreachable(err);
  }
  if (!res.ok) throw await fail(res);
  return res.json();
}

// A voice recording, as multipart form data: its text.
async function transcribe(data, contentType) {
  const form = new FormData();
  const type = contentType || 'audio/webm';
  // The service reads the format from the name, so it must match the type.
  const ext = [['ogg', 'ogg'], ['wav', 'wav'], ['mpeg', 'mp3'], ['mp3', 'mp3'], ['mp4', 'm4a']]
    .find(([key]) => type.includes(key))?.[1] || 'webm';
  form.append('audio', new Blob([data], { type }), `voice.${ext}`);
  let res;
  try {
    res = await fetch(`${credentials.base}/audio/transcriptions`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });
  } catch (err) {
    throw unreachable(err);
  }
  if (!res.ok) throw await fail(res);
  return res.json();
}

// An uploaded image's bytes, for showing it again: { type, data }.
async function download(path) {
  let res;
  try {
    res = await fetch(credentials.base + path, { headers: authHeaders() });
  } catch (err) {
    throw unreachable(err);
  }
  if (!res.ok) throw await fail(res);
  return { type: (res.headers.get('content-type') || '').split(';')[0], data: Buffer.from(await res.arrayBuffer()) };
}

const id = encodeURIComponent;

module.exports = {
  get API_BASE() { return credentials.base; },
  DEFAULT_API_BASE,
  ApiError,
  configure,
  snapshot,
  readEvents,
  // Browser sign-in: start it, then poll until the person approves it there.
  startDeviceAuth: (name) => unauthenticated('POST', '/auth/device', { name }),
  pollDeviceAuth: (deviceCode) => unauthenticated('POST', '/auth/device/token', { device_code: deviceCode }),
  credits: () => request('GET', '/credits'),
  // include: 'provider' adds each model's provider and the web picker's order.
  models: ({ include } = {}) => request('GET', include ? `/models?include=${id(include)}` : '/models'),
  listSessions: (limit = 100) => request('GET', `/sessions?limit=${limit}`),
  getSession: (sessionId) => request('GET', `/sessions/${id(sessionId)}`),
  messages: (sessionId) => request('GET', `/sessions/${id(sessionId)}/messages`),
  agent: (sessionId, agentId) => request('GET', `/sessions/${id(sessionId)}/agents/${id(agentId)}`),
  createSession: (body) => request('POST', '/sessions', body),
  updateSession: (sessionId, body) => request('PATCH', `/sessions/${id(sessionId)}`, body),
  duplicateSession: (sessionId) => request('POST', `/sessions/${id(sessionId)}/duplicate`),
  deleteSession: (sessionId) => request('DELETE', `/sessions/${id(sessionId)}`),
  stopSandbox: (sessionId) => request('DELETE', `/sessions/${id(sessionId)}/sandbox`),
  compactSession: (sessionId) => request('POST', `/sessions/${id(sessionId)}/compact`),
  transcribe,
  getSettings: () => request('GET', '/settings'),
  billing: () => request('GET', '/billing'),
  // invoices (GET), cancel, resume, offer (GET or POST), portal: see the API docs.
  billingAction: (subscriptionId, action, method = 'POST', body) =>
    request(method, `/billing/subscriptions/${id(subscriptionId)}/${id(action)}`, method === 'GET' ? undefined : (body || {})),
  // Your own provider keys (BYOK). A key is sent, never read back.
  byokKeys: () => request('GET', '/settings/keys'),
  saveByokKey: (provider, apiKey) => request('PUT', `/settings/keys/${id(provider)}`, { api_key: apiKey }),
  deleteByokKey: (provider) => request('DELETE', `/settings/keys/${id(provider)}`),
  updateSettings: (body) => request('PATCH', '/settings', body),
  startRun: (sessionId, body, signal) => openStream('POST', `/sessions/${id(sessionId)}/runs`, body, signal),
  runEvents: (runId, signal) => openStream('GET', `/runs/${id(runId)}/events`, undefined, signal),
  heartbeat: (runId, signal) => request('POST', `/runs/${id(runId)}/heartbeat`, {}, signal, 30000),
  cancelRun: (runId) => request('POST', `/runs/${id(runId)}/cancel`, {}),
  steerRun: (runId, message, files) =>
    request('POST', `/runs/${id(runId)}/steer`, files && files.length ? { message, files } : { message }),
  uploadFile: upload,
  deleteFile: (fileId) => request('DELETE', `/files/${id(fileId)}`),
  fileContent: (fileId) => download(`/files/${id(fileId)}/content`),
  toolResult: (runId, callId, output, isError, signal) =>
    request('POST', `/runs/${id(runId)}/tool_results`, { call_id: callId, output, is_error: Boolean(isError) }, signal, 30000),
};
