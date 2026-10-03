'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. What the window knows (S), loading it from the API, and keeping it fresh.

// ── State ──────────────────────────────────────────────────────────────────
const S = {
  init: null,
  settings: null,
  sessions: [],
  sessionsError: null,
  models: [],
  modelsError: null,
  credits: null,
  creditsError: null,
  current: null,            // selected session id; null is a new session
  transcripts: new Map(),   // session id -> items
  loaded: new Set(),        // sessions whose history is in `transcripts`
  loading: new Set(),
  running: new Map(),       // session id -> { runId, started, turnStart, usage, ended, model, stopping, stamped, files }
  draftCwd: null,
  draftSandbox: false,      // a new session that runs in the cloud, not here
  collapsed: new Set(),     // folder groups the user folded away
  seenAnswer: new Map(),    // session id -> last_message_at shown in the transcript
  remoteBusy: new Set(),    // sessions with a turn going in another client
  agents: new Map(),        // session id -> Map(agent id -> sub-agent)
  panel: { open: false, agentId: null },
  images: new Map(),        // uploaded file id -> preview data URL
  attachments: [],          // the composer's: { key, name, size, kind, preview, status, fileId, error }
  git: null,                // what is uncommitted in this session's folder
  gitFor: '',               // the session (or draft folder) `git` answers for
  gitOpen: new Set(),       // paths whose diff is unfolded in the changes list
  gitDiffs: new Map(),      // path -> the diff the main process gave for it
  model: 'auto',
  defaultModel: null,       // the account's default model, from its settings
  account: null,            // GET /v1/settings
  accountError: null,
  permission: 'ask',
  sending: false,
};

// A new session starts on the account's default model.
const newSessionModel = () => S.defaultModel || S.init.state.model || 'auto';

const local = (id) => (S.init && S.init.state.sessions[id]) || {};
const currentSession = () => S.sessions.find((s) => s.id === S.current) || null;

function transcriptOf(id) {
  if (!S.transcripts.has(id)) S.transcripts.set(id, []);
  return S.transcripts.get(id);
}

// Which sidebar folder a session belongs to.
function sessionGroup(session) {
  if (session.executor !== 'client') return 'Cloud sandbox';
  const cwd = local(session.id).cwd;
  return cwd ? baseName(cwd) : 'Another computer';
}

function sessionLabel(session) {
  if (!session) return 'New session';
  const firstUser = (S.transcripts.get(session.id) || []).find((i) => i.type === 'user');
  return session.title || local(session.id).label || (firstUser && firstUser.text.slice(0, 80)) || 'Untitled session';
}

const findModel = (id) => S.models.find((m) => m.id === id);

// Effort variants of one model (Low, Medium, High, ...) are one entry, as in
// the web picker. A server without ?include=family gives plain models.
function modelEntries() {
  const entries = [];
  const families = new Map();
  for (const model of S.models) {
    const family = model.family;
    if (family && family.id) {
      let entry = families.get(family.id);
      if (!entry) {
        entry = { id: family.id, name: family.name, provider: model.provider, variants: [], defaultId: family.default };
        families.set(family.id, entry);
        entries.push(entry);
      }
      entry.variants.push(model);
    } else {
      entries.push({ id: model.id, name: model.name, provider: model.provider, variants: [model], defaultId: model.id });
    }
  }
  const rank = (m) => (m.effort && m.effort.rank) || 0;
  for (const entry of families.values()) entry.variants.sort((a, b) => rank(a) - rank(b));
  return entries;
}

function entryOf(modelId) {
  return modelEntries().find((entry) => entry.variants.some((v) => v.id === modelId)) || null;
}

function modelName(id) {
  if (!id || id === 'auto') return 'Auto';
  const entry = entryOf(id);
  return entry ? entry.name : id;
}

// A model the server names by id or by its display name, as an id we list.
function resolveModel(value) {
  if (!value) return null;
  if (value === 'auto' || findModel(value)) return value;
  const byName = S.models.find((m) => m.name === value);
  return byName ? byName.id : null;
}

// The model a session last ran on. Staying on it keeps the provider's prompt
// cache warm, so selecting a session selects its model too.
function sessionModel(session) {
  if (!session) return null;
  return resolveModel(local(session.id).model) || resolveModel(session.last_model)
    || resolveModel(session.model);
}

function applySessionModel() {
  const picked = S.current ? sessionModel(currentSession()) : null;
  S.model = picked || newSessionModel();
  renderComposer();
}

// The name a person knows: "DeepSeek V4.1 Flash", not "deepseek-flash".
function modelLabel(id) {
  if (!id) return '';
  if (id === 'auto') return 'Auto';
  const exact = findModel(id);
  if (exact) return exact.name;
  const entry = entryOf(id);
  return entry ? entry.name : id;
}

function providerLogo(provider, className = 'plogo') {
  if (!provider) return null;
  const box = el('span', className);
  if (provider.logo_url) {
    const img = el('img');
    img.alt = '';
    img.src = provider.logo_url;
    img.addEventListener('error', () => {
      img.remove();
      box.textContent = provider.name.slice(0, 1).toUpperCase();
      box.classList.add('letter');
    });
    box.append(img);
  } else {
    box.textContent = provider.name.slice(0, 1).toUpperCase();
    box.classList.add('letter');
  }
  return box;
}

// ── Data ───────────────────────────────────────────────────────────────────
async function loadSessions({ quiet = false } = {}) {
  let changed = true;
  try {
    const data = await call(cf.sessions);
    const next = data.sessions || [];
    changed = JSON.stringify(next) !== JSON.stringify(S.sessions);
    S.sessions = next;
    S.sessionsError = null;
  } catch (err) {
    if (quiet) return;
    S.sessionsError = err.message;
  }
  if (!changed && quiet) return;
  for (const session of S.sessions) noticeNewAnswers(session);
  renderSidebar();
  renderAccount();
  if (S.current) renderTopbar();
}

// ── Live refresh ───────────────────────────────────────────────────────────
// A session can move on without this app: a turn sent from the web chat, or
// from this app on another computer. Its newest answer's time comes with the
// session list, and the open session is also asked whether a turn is going.
function noticeNewAnswers(session) {
  const at = session.last_message_at || null;
  const seen = S.seenAnswer.get(session.id);
  if (!S.loaded.has(session.id) || S.running.has(session.id)) {
    if (S.loaded.has(session.id)) S.seenAnswer.set(session.id, at);
    return;
  }
  if (seen === undefined) {
    S.seenAnswer.set(session.id, at);
    return;
  }
  if (at && at !== seen) {
    S.seenAnswer.set(session.id, at);
    reloadTranscript(session.id);
  }
}

async function reloadTranscript(id) {
  if (S.loading.has(id)) return;
  S.loading.add(id);
  const box = $('transcript');
  const wasAtBottom = nearBottom();
  const offset = box.scrollTop;
  let data;
  try {
    data = await call(cf.messages, id);
    if (S.running.has(id)) return; // this app started a run meanwhile
    S.transcripts.set(id, rebuiltTranscript(id, data));
  } catch {
    return; // keep what is shown; the next tick tries again
  } finally {
    S.loading.delete(id);
  }
  if (S.current !== id) return data;
  renderTranscript();
  if (!wasAtBottom) box.scrollTop = offset;
  updateScrollButton();
  return data;
}

// Whether a turn is going in the open session somewhere else.
async function checkCurrentSession() {
  const id = S.current;
  if (!id || S.running.has(id)) return;
  let detail;
  try {
    detail = await call(cf.session, id);
  } catch {
    return;
  }
  if (S.current !== id) return;
  const busy = Boolean(detail.busy);
  const was = S.remoteBusy.has(id);
  if (busy === was) {
    const session = currentSession();
    if (session) noticeNewAnswers({ ...session, last_message_at: detail.last_message_at });
    return;
  }
  if (busy) S.remoteBusy.add(id);
  else S.remoteBusy.delete(id);
  renderTopbar();
  renderTranscript();
  if (!busy) {
    await reloadTranscript(id);
    S.seenAnswer.set(id, detail.last_message_at || null);
    loadCredits();
  }
}

let liveTimer = 0;
function scheduleLiveRefresh() {
  clearTimeout(liveTimer);
  // Quick while the window is in use or another client is working; slow in
  // the background, where nobody is looking.
  const busy = S.current && S.remoteBusy.has(S.current);
  const delay = busy ? 3000 : document.hasFocus() ? 6000 : 30000;
  liveTimer = setTimeout(async () => {
    if (S.settings && S.settings.hasKey) {
      await Promise.allSettled([loadSessions({ quiet: true }), checkCurrentSession(), ensureModels(), call(cf.recoverRuns)]);
    }
    scheduleLiveRefresh();
  }, delay);
}

// Balances change from anywhere: a run here, a turn in the web chat, a
// purchase on the website. So they are read again every 30 seconds, when the
// window comes back into focus, and after every run.
const CREDITS_REFRESH_MS = 30_000;
let creditsLoadedAt = 0;

let keyWarned = false;

async function loadCredits({ quiet = false } = {}) {
  let next;
  try {
    next = await call(cf.credits);
  } catch (err) {
    // A background refresh that fails keeps the numbers already shown.
    if (quiet && S.credits) return;
    S.creditsError = err.status === 401 ? 'The API key was refused.' : err.message;
    renderAccount();
    return;
  }
  creditsLoadedAt = Date.now();
  const changed = JSON.stringify(next) !== JSON.stringify(S.credits);
  S.credits = next;
  S.creditsError = null;
  if (paysWithThisKey() && !keyWarned) {
    keyWarned = true;
    showBanner(`This app uses a key made for code, so your ${S.credits.plan.name || ''} plan's Unlimited `
      + 'models cost credits here. Sign in with your browser to get a desktop key.',
    [{ label: 'Fix it', run: () => { openSettings(false); fixKeyType(); } }]);
  }
  // Redrawing an unchanged card would drop the hover on its details.
  if (changed || !quiet) renderAccount();
}

// The model list is asked for again every few minutes, so a model added on the
// server shows up without a restart. A start without a connection used to
// leave the picker empty for good, so an empty list is also asked for again:
// when the picker opens, when the network comes back, and on every live refresh.
const MODELS_REFRESH_MS = 5 * 60_000;
let modelsLoading = null;
let modelsLoadedAt = 0;
function ensureModels() {
  if (!S.settings || !S.settings.hasKey) return Promise.resolve();
  if (S.models.length && Date.now() - modelsLoadedAt < MODELS_REFRESH_MS) return Promise.resolve();
  return loadModels({ quiet: S.models.length > 0 });
}

async function loadModels({ quiet = false } = {}) {
  if (modelsLoading) return modelsLoading;
  modelsLoading = loadModelsOnce(quiet).finally(() => { modelsLoading = null; });
  return modelsLoading;
}

async function loadModelsOnce(quiet) {
  const before = quiet ? JSON.stringify(S.models) : null;
  try {
    S.models = (await call(cf.models)).models || [];
    S.modelsError = null;
    modelsLoadedAt = Date.now();
  } catch (err) {
    // A refresh that fails keeps the list on screen.
    if (quiet) return;
    S.modelsError = err.status === 0
      ? 'No connection. The models will load when you are back online.'
      : err.message;
  }
  // Redrawing an unchanged picker would drop its scroll and selection.
  if (quiet && JSON.stringify(S.models) === before) return;
  if (!$('modelMenu').hidden) renderModelList($('modelSearch').value);
  if (!$('settings').hidden && settingsTab === 'preferences' && !document.querySelector('.pref-menu:not([hidden])')) {
    renderPreferencesPane();
  }
  if (S.current) applySessionModel();
  renderComposer();
}

const loadAll = () => Promise.allSettled([loadSessions(), loadModels(), loadCredits(), loadAccountSettings()]);

async function loadAccountSettings() {
  try {
    const wasPrivate = Boolean(S.account && S.account.privacy.private_sessions);
    S.account = await call(cf.getSettings);
    S.accountError = null;
    if (S.account.privacy.private_sessions && !wasPrivate) notePrivateMode();
  } catch (err) {
    S.accountError = err.status === 0 ? 'No connection. Your settings will load when you are back online.' : err.message;
  }
  applyDefaultModel();
}

// Private session mode is set on the website, and this app cannot run with it on.
function notePrivateMode() {
  if (!(S.account && S.account.privacy.private_sessions)) return;
  showBanner('Private session mode is on in your CodingFleet account, so this app cannot send messages. '
    + 'Turn it off on your account page to use the app.', [{
    label: 'Open account page',
    run: () => window.open(`${originOf(S.settings.apiBase)}/account/`),
  }]);
}

function applyDefaultModel() {
  const chosen = S.account && S.account.preferences.default_model;
  S.defaultModel = chosen || (S.account ? 'auto' : null);
  if (!S.current && !S.sending) {
    S.model = newSessionModel();
    renderComposer();
  }
}
