'use strict';
/* global cf, CF_SANDBOX */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Cloud sandboxes: the Settings tab (specs, the
// sandboxes running now, snapshots, and the account's sandbox settings), the
// spec editor, and the spec a new cloud session's sandbox is built from.

const SBX = CF_SANDBOX;
const sbx = {
  specs: null, pinned: null, specsError: '', specsLoading: null,
  // The server has no sandbox specs (an older one): the feature stays out of sight.
  unsupported: false,
  sandboxes: null, limits: null, sandboxesError: '',
  snapshots: null, snapshotsError: '',
  config: null, configError: '',
  openErrors: new Set(),   // spec ids whose build error is shown
  busy: new Set(),         // things being saved, so a button is not pressed twice
  pollTimer: null,
  building: new Map(),     // spec id -> build kind last seen, to say when a build ends
};

// A 404 with no error code is the server's own "no such page": the endpoint
// does not exist there. A 404 with a code (spec_not_found) is an answer.
const featureMissing = (err) => Boolean(err) && err.status === 404 && !err.code;

const specById = (id) => (sbx.specs || []).find((spec) => spec.id === id) || null;

function sessionName(id) {
  const session = S.sessions.find((s) => s.id === id);
  return (session && (session.title || local(id).label)) || 'A session';
}

// ── Loading ────────────────────────────────────────────────────────────────
function loadSpecs(force = false) {
  if (sbx.specsLoading) return sbx.specsLoading;
  if (sbx.specs && !force) return Promise.resolve(sbx.specs);
  if (typeof cf.sandboxSpecs !== 'function' || !S.settings.hasKey) return Promise.resolve(null);
  sbx.specsLoading = (async () => {
    try {
      const data = await call(cf.sandboxSpecs);
      sbx.specs = data.specs || [];
      sbx.pinned = data.pinned || null;
      sbx.specsError = '';
      sbx.unsupported = false;
      noteBuildEnds();
      forgetMissingDraftSpec();
    } catch (err) {
      if (featureMissing(err)) sbx.unsupported = true;
      else sbx.specsError = err.message;
    } finally {
      sbx.specsLoading = null;
    }
    scheduleBuildPoll();
    sandboxDataChanged();
    return sbx.specs;
  })();
  return sbx.specsLoading;
}

async function loadSandboxes(refresh = false) {
  try {
    const data = await call(cf.sandboxes, refresh);
    sbx.sandboxes = data.sandboxes || [];
    sbx.limits = data.limits || null;
    sbx.sandboxesError = '';
  } catch (err) {
    if (featureMissing(err)) sbx.unsupported = true;
    else sbx.sandboxesError = err.message;
  }
  sandboxDataChanged();
}

async function loadSnapshots() {
  try {
    sbx.snapshots = (await call(cf.snapshots)).snapshots || [];
    sbx.snapshotsError = '';
  } catch (err) {
    if (featureMissing(err)) sbx.unsupported = true;
    else sbx.snapshotsError = err.message;
  }
  sandboxDataChanged();
}

async function loadSandboxConfig() {
  try {
    sbx.config = await call(cf.sandboxConfig);
    sbx.configError = '';
  } catch (err) {
    if (featureMissing(err)) sbx.unsupported = true;
    else sbx.configError = err.message;
  }
  sandboxDataChanged();
}

// What shows sandbox data draws it again: the Settings tab, the composer's
// button, and the folder menu when it is open.
function sandboxDataChanged() {
  if (!$('settings').hidden && settingsTab === 'sandboxes') renderSandboxesPane();
  if (!$('folderMenu').hidden) openFolderMenu();
  renderComposer();
}

// While a spec builds, its state is read again every few seconds.
function scheduleBuildPoll() {
  clearTimeout(sbx.pollTimer);
  if (!SBX.anyBuilding(sbx.specs)) return;
  sbx.pollTimer = setTimeout(() => loadSpecs(true), 3000);
}

// A build that ended since the last look is said in the tab's status line.
function noteBuildEnds() {
  const pane = $('sandboxesPane');
  for (const spec of sbx.specs || []) {
    const kind = SBX.buildState(spec).kind;
    const before = sbx.building.get(spec.id);
    if (before === 'building' && kind === 'built') paneStatus(pane, `"${spec.name}" is built. Its next sandbox starts without a build.`, 'ok');
    if (before === 'building' && kind === 'failed') paneStatus(pane, `The build of "${spec.name}" failed. Open its error below.`, 'error');
    sbx.building.set(spec.id, kind);
  }
}

// ── The spec a new cloud session uses ─────────────────────────────────────
// Kept on this computer: the next new cloud session uses it again.
function draftSpecId() {
  if (!('draftSpec' in S)) S.draftSpec = (S.init && S.init.state && S.init.state.sandboxSpec) || null;
  return S.draftSpec;
}

// The spec a new cloud session is sent with: none on a server without specs,
// which would refuse the field.
function chosenSpecId() {
  return sbx.unsupported ? null : draftSpecId();
}

function setDraftSpec(id) {
  S.draftSpec = id || null;
  if (S.init && S.init.state) S.init.state.sandboxSpec = S.draftSpec;
  cf.setState({ sandboxSpec: S.draftSpec });
}

// A spec deleted elsewhere (on another computer, through the API) is dropped
// from the choice rather than sent and refused.
function forgetMissingDraftSpec() {
  const id = draftSpecId();
  if (id && sbx.specs && !specById(id)) setDraftSpec(null);
}

// The composer's button for a cloud session: "Cloud sandbox", or the spec.
function cloudButtonLabel(session) {
  const specId = session ? session.sandbox_spec : chosenSpecId();
  if (specId && !sbx.specs && !sbx.specsLoading && !sbx.unsupported) loadSpecs();
  return SBX.cloudLabel(specId, sbx.specs);
}

function cloudButtonTitle(session) {
  const spec = specById(session ? session.sandbox_spec : draftSpecId());
  return spec ? `Tools run on CodingFleet's servers, in a sandbox built from "${spec.name}" (${spec.summary})`
    : "Tools run on CodingFleet's servers";
}

// Before a new cloud session is created on a spec: a spec whose last build
// failed would fail again, so the user is asked first.
async function specReadyToSend(specId) {
  const spec = specById(specId);
  if (!spec || SBX.buildState(spec).kind !== 'failed') return true;
  return confirmDialog({
    title: `The last build of "${spec.name}" failed`,
    text: 'The session builds it again when it first needs a sandbox, and the agent sees the error if it '
      + 'fails again. Fix the spec in Settings → Cloud sandboxes, or send anyway.',
    confirm: 'Send anyway',
  });
}

// The server refused the spec (deleted since): back to the account's default.
function specVanished() {
  setDraftSpec(null);
  loadSpecs(true);
}

// The cloud sandbox choices in the folder menu: the account's default, then
// each spec, then a way to manage them.
function cloudMenuItems(session, option) {
  const items = [];
  const sandbox = !session && S.draftSandbox;
  const chosen = draftSpecId();
  const pinned = specById(sbx.pinned);
  const choose = (specId) => () => {
    setDraftSpec(specId);
    S.draftSandbox = true;
    S.draftCwd = null;
    if (session) newSession();
    else renderMain();
  };
  // A server without specs offers none, whatever was loaded before.
  const specs = sbx.unsupported ? [] : (sbx.specs || []);
  if (!specs.length) {
    items.push(option('sparkle', 'Cloud sandbox', "Runs on CodingFleet's servers. Nothing here is read or changed.",
      sandbox, choose(null)));
    if (!sbx.unsupported && sbx.specs) {
      items.push(option('box', 'Set up a sandbox image…', 'Choose the image, tools and env vars of cloud sessions',
        false, () => openSandboxSettings(true)));
    }
    if (!sbx.specs && !sbx.specsLoading && !sbx.unsupported) loadSpecs();
    return items;
  }
  items.push(el('div', 'menu-group', 'Cloud sandbox'));
  items.push(option('sparkle', 'Cloud sandbox', pinned ? `Your default spec: ${pinned.name}`
    : "The standard image. Nothing here is read or changed.", sandbox && !chosen, choose(null)));
  for (const spec of specs) {
    const state = SBX.buildState(spec);
    const sub = `${spec.summary}${state.kind === 'none' ? '' : ` · ${state.label}`}`;
    const row = option('box', spec.name, sub, sandbox && chosen === spec.id, choose(spec.id));
    if (state.kind === 'failed') row.classList.add('sbx-menu-failed');
    items.push(row);
  }
  items.push(option('gear', 'Manage sandbox specs…', 'Images, builds, snapshots and settings', false,
    () => openSandboxSettings()));
  return items;
}

function openSandboxSettings(newSpec = false) {
  openSettings(false, 'sandboxes');
  if (newSpec) openSpecEditor();
}

// ── Small dialogs ──────────────────────────────────────────────────────────
// A dialog with a few text fields. Resolves {key: value} on the confirm
// button, or null.
function fieldsDialog({ title, text, fields, confirm = 'Save' }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay confirm-overlay');
    const modal = el('div', 'modal confirm-modal sbx-fields');
    modal.setAttribute('role', 'dialog');
    modal.append(el('h2', 'confirm-title', title));
    if (text) modal.append(el('p', 'confirm-text', text));
    const inputs = {};
    for (const field of fields) {
      const label = el('label', 'sbx-label', field.label);
      const input = el(field.multiline ? 'textarea' : 'input', 'sbx-input');
      if (field.multiline) input.rows = 3;
      input.value = field.value || '';
      input.placeholder = field.placeholder || '';
      if (field.max) input.maxLength = field.max;
      input.spellcheck = false;
      inputs[field.key] = input;
      modal.append(label, input);
    }
    const cancel = el('button', 'btn', 'Cancel');
    const ok = el('button', 'btn primary', confirm);
    const actions = el('div', 'modal-actions');
    actions.append(el('div', 'bar-spacer'), cancel, ok);
    modal.append(actions);
    overlay.append(modal);
    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const submit = () => close(Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()])));
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      } else if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
        event.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', submit);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(null); });
    document.body.append(overlay);
    setTimeout(() => (Object.values(inputs)[0] || ok).focus(), 0);
  });
}

// The server's words for these name the desktop app, and this is it.
function sbxWhy(err) {
  if (err.code === 'desktop_key_required') {
    return 'Sign in with your browser to do this. A key made for code cannot reach the web chat\'s sandboxes '
      + 'and snapshots, or the specs the web chat and this app build from.';
  }
  if (err.code === 'build_limit_reached') {
    return 'An account starts 30 builds a day at most. The spec is still built when a session first needs it.';
  }
  return err.message;
}

// One action at a time per thing: a second click while it saves does nothing.
async function once(key, pane, fn) {
  if (sbx.busy.has(key)) return;
  sbx.busy.add(key);
  try {
    await fn();
  } catch (err) {
    paneStatus(pane, sbxWhy(err), 'error');
  } finally {
    sbx.busy.delete(key);
  }
}

const sbxPill = (text, kind = '') => el('span', `sbx-pill ${kind}`.trim(), text);

function sectionHead(title, ...buttons) {
  const head = el('div', 'pane-section sbx-section');
  head.append(el('span', null, title));
  if (buttons.length) {
    const right = el('span', 'sbx-section-actions');
    right.append(...buttons);
    head.append(right);
  }
  return head;
}

// ── The Settings tab ───────────────────────────────────────────────────────
function renderSandboxesPane(first = false) {
  const pane = $('sandboxesPane');
  pane.replaceChildren(paneHead('Cloud sandboxes',
    'How the sandbox of a cloud session is built — the image, its tools and env vars — what runs now, and '
    + 'your snapshots. They belong to your CodingFleet account, like the Sandboxes page on codingfleet.com.'));
  if (first) {
    loadSpecs(true);
    loadSandboxes();
    loadSnapshots();
    loadSandboxConfig();
  }
  if (sbx.unsupported) {
    pane.append(el('div', 'pane-empty', 'This CodingFleet server does not offer sandbox specs yet.'));
    return;
  }
  const plan = S.credits && S.credits.plan;
  if (plan && plan.key === 'free') {
    const row = el('div', 'set-row warn static');
    const text = el('div', 'set-text');
    text.append(el('div', 'set-title', 'Cloud sandboxes need a paid plan'),
      el('div', 'set-desc', 'You can prepare specs now. To run cloud sessions, building and snapshots included, '
        + 'choose a plan on codingfleet.com; sessions in a folder on this computer work on every plan.'));
    row.append(text);
    pane.append(row);
  }
  renderSpecsSection(pane);
  renderSandboxesSection(pane);
  renderSnapshotsSection(pane);
  renderConfigSection(pane);
  const foot = el('div', 'pane-foot');
  const link = el('a', null, 'Open the Sandboxes page');
  link.href = `${originOf(S.settings.apiBase)}/sandboxes/`;
  foot.append(el('div', 'pane-status'), link);
  pane.append(foot);
  applyStatus(pane);
}

function renderSpecsSection(pane) {
  const add = el('button', 'btn small primary', 'New spec');
  add.addEventListener('click', () => openSpecEditor());
  pane.append(sectionHead('Sandbox specs', add));
  pane.append(el('div', 'sbx-note', 'Choose one for a new cloud session from the folder button under the message box.'));
  if (!sbx.specs) {
    pane.append(el('div', 'pane-empty', sbx.specsError || 'Loading…'));
    return;
  }
  if (!sbx.specs.length) {
    pane.append(el('div', 'sbx-empty', 'No specs yet. A spec says how a cloud session\'s sandbox is built: '
      + 'a Docker Hub image such as golang:1.23, your Dockerfile, or a snapshot, with env vars.'));
    return;
  }
  for (const spec of sbx.specs) pane.append(specRow(pane, spec));
}

function specRow(pane, spec) {
  const row = el('div', 'set-row stack sbx-row');
  row.dataset.spec = spec.id;
  const head = el('div', 'sbx-head');
  const text = el('div', 'set-text');
  const title = el('div', 'set-title sbx-title');
  title.append(el('span', 'sbx-name', spec.name));
  if (spec.pinned) title.append(sbxPill('Default', 'accent'));
  const state = SBX.buildState(spec);
  title.append(sbxPill(state.label, state.kind));
  text.append(title);
  const parts = [spec.summary];
  if (spec.env_var_names && spec.env_var_names.length) {
    parts.push(`${spec.env_var_names.length} env ${spec.env_var_names.length === 1 ? 'var' : 'vars'}`);
  }
  if (spec.sessions) parts.push(`used by ${spec.sessions} ${spec.sessions === 1 ? 'session' : 'sessions'}`);
  text.append(el('div', 'set-desc sbx-mono-line', parts.join(' · ')));
  if (spec.description) text.append(el('div', 'set-desc', spec.description));
  if (state.kind === 'building') text.append(el('div', 'set-desc sbx-building', `${state.detail}…`));

  const actions = el('div', 'sbx-actions');
  const building = state.kind === 'building';
  const build = el('button', 'btn small', building ? 'Building…' : state.kind === 'built' ? 'Rebuild' : 'Build');
  build.disabled = building;
  build.title = 'Build the image now, so the first sandbox does not wait for it';
  build.addEventListener('click', () => once(`build:${spec.id}`, pane, async () => {
    build.disabled = true;
    const updated = await call(cf.buildSandboxSpec, spec.id);
    replaceSpec(updated);
    paneStatus(pane, `Building "${spec.name}"…`);
    sbx.building.set(spec.id, 'building');
    scheduleBuildPoll();
    renderSandboxesPane();
  }));
  const edit = el('button', 'btn small', 'Edit');
  edit.disabled = building;
  edit.title = building ? 'Wait for the build to end' : 'Change this spec';
  edit.addEventListener('click', () => openSpecEditor({ spec }));
  const remove = el('button', 'icon-button danger');
  remove.title = 'Delete this spec';
  remove.innerHTML = ICON.trash;
  remove.addEventListener('click', () => deleteSpec(pane, spec));
  actions.append(build, edit, remove);
  head.append(text, actions);
  row.append(head);

  if (state.kind === 'failed') {
    const open = sbx.openErrors.has(spec.id);
    const toggle = el('button', 'sbx-link', open ? 'Hide the error' : 'Show the error');
    toggle.addEventListener('click', () => {
      if (open) sbx.openErrors.delete(spec.id);
      else sbx.openErrors.add(spec.id);
      renderSandboxesPane();
    });
    row.append(toggle);
    if (open) row.append(el('pre', 'sbx-error', state.detail));
  }
  return row;
}

function replaceSpec(updated) {
  if (!updated || !sbx.specs) return;
  const at = sbx.specs.findIndex((s) => s.id === updated.id);
  if (at === -1) sbx.specs.unshift(updated);
  else sbx.specs[at] = updated;
  if (updated.pinned) sbx.pinned = updated.id;
}

async function deleteSpec(pane, spec) {
  const users = S.sessions.filter((s) => s.sandbox_spec === spec.id);
  if (spec.sessions) {
    const named = users.slice(0, 3).map((s) => `"${sessionName(s.id)}"`).join(', ');
    await confirmDialog({
      title: `"${spec.name}" is in use`,
      text: `${spec.sessions} ${spec.sessions === 1 ? 'session builds its' : 'sessions build their'} sandbox from it`
        + `${named ? `, such as ${named}` : ''}. Delete those sessions first, or keep the spec.`,
      confirm: 'OK',
    });
    return;
  }
  const ok = await confirmDialog({
    title: `Delete "${spec.name}"?`,
    text: `Its recipe and env vars are deleted${spec.pinned ? ', and new sandboxes go back to the standard image' : ''}. `
      + 'Running sandboxes keep going. Sessions you make later cannot use it.',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await once(`delete:${spec.id}`, pane, async () => {
    try {
      await call(cf.deleteSandboxSpec, spec.id);
    } catch (err) {
      if (err.code === 'spec_in_use') {
        paneStatus(pane, 'Sessions build their sandboxes from this spec. Delete them first.', 'error');
        loadSpecs(true);
        return;
      }
      throw err;
    }
    sbx.specs = sbx.specs.filter((s) => s.id !== spec.id);
    if (sbx.pinned === spec.id) sbx.pinned = null;
    if (sbx.config && sbx.config.default_spec === spec.id) sbx.config.default_spec = null;
    forgetMissingDraftSpec();
    paneStatus(pane, `"${spec.name}" deleted.`, 'ok');
    sandboxDataChanged();
  });
}

function renderSandboxesSection(pane) {
  const refresh = el('button', 'btn small', 'Refresh');
  refresh.title = 'Ask each sandbox whether it still runs';
  refresh.addEventListener('click', () => once('sandboxes', pane, async () => {
    refresh.disabled = true;
    await loadSandboxes(true);
  }));
  pane.append(sectionHead('Running now', refresh));
  if (!sbx.sandboxes) {
    pane.append(el('div', 'pane-empty', sbx.sandboxesError || 'Loading…'));
    return;
  }
  const limit = SBX.limitLine(sbx.limits);
  if (limit) pane.append(el('div', 'sbx-note', limit));
  if (!sbx.sandboxes.length) {
    pane.append(el('div', 'sbx-empty', 'No sandbox is running. A cloud session starts one when it first runs a tool.'));
    return;
  }
  for (const sandbox of sbx.sandboxes) pane.append(sandboxRow(pane, sandbox));
}

function sandboxRow(pane, sandbox) {
  const row = el('div', 'set-row stack sbx-row');
  row.dataset.sandbox = sandbox.id;
  const head = el('div', 'sbx-head');
  const text = el('div', 'set-text');
  const title = el('div', 'set-title sbx-title');
  const forSession = sandbox.pool === 'api';
  title.append(el('span', 'sbx-name', sandbox.name || (forSession ? sessionName(sandbox.session_id) : 'Web chat sandbox')));
  title.append(sbxPill(forSession ? 'Session' : 'Web chat'));
  if (sandbox.busy) title.append(sbxPill('Busy', 'building'));
  if (sandbox.status === 'stopped') title.append(sbxPill('Stopped', 'failed'));
  text.append(title);
  const what = [];
  if (forSession) what.push(sessionName(sandbox.session_id));
  const spec = specById(sandbox.sandbox_spec);
  if (spec) what.push(`from "${spec.name}"`);
  else if (sandbox.image_ref) what.push(sandbox.image_ref);
  if (what.length) text.append(el('div', 'set-desc', what.join(' · ')));
  const line = SBX.sandboxLine(sandbox);
  if (line) text.append(el('div', 'set-desc', line));

  const actions = el('div', 'sbx-actions');
  if (forSession && S.sessions.some((s) => s.id === sandbox.session_id)) {
    const open = el('button', 'btn small', 'Open session');
    open.addEventListener('click', () => {
      closeSettings();
      selectSession(sandbox.session_id);
    });
    actions.append(open);
  }
  const snap = el('button', 'btn small', 'Save snapshot');
  snap.disabled = sandbox.status === 'stopped' || Boolean(sandbox.busy);
  snap.title = sandbox.busy ? 'A run is using it: save a snapshot between runs'
    : 'Save its files and everything installed in it, to start other sessions from';
  snap.addEventListener('click', () => snapshotSandbox(pane, sandbox));
  actions.append(snap);
  if (forSession) {
    const stop = el('button', 'btn small danger', 'Stop');
    stop.disabled = sandbox.status === 'stopped' || Boolean(sandbox.busy);
    stop.title = sandbox.busy ? 'A run is using it: stop the run first' : 'Stop it now. Its session starts it again when needed.';
    stop.addEventListener('click', () => stopSandbox(pane, sandbox));
    actions.append(stop);
  }
  head.append(text, actions);
  row.append(head);
  return row;
}

async function snapshotSandbox(pane, sandbox) {
  const values = await fieldsDialog({
    title: 'Save a snapshot',
    text: 'Saves the sandbox\'s files and everything installed in it. It keeps running. A saved snapshot is kept '
      + 'until you delete it, and a spec can start new sessions from it.',
    fields: [
      { key: 'name', label: 'Name', value: sandbox.name || '', placeholder: 'Go toolchain with dependencies', max: 80 },
      { key: 'description', label: 'Description (optional)', multiline: true, max: 2000 },
    ],
    confirm: 'Save snapshot',
  });
  if (!values) return;
  await once(`snapshot:${sandbox.id}`, pane, async () => {
    paneStatus(pane, 'Saving the snapshot… On a large sandbox this takes a minute.');
    const body = {};
    if (values.name) body.name = values.name;
    if (values.description) body.description = values.description;
    try {
      const snapshot = await call(cf.snapshotSandbox, { id: sandbox.id, body });
      paneStatus(pane, `Snapshot "${snapshot.name}" saved.`, 'ok');
    } catch (err) {
      const why = {
        plan_upgrade_required: 'Saving snapshots needs the Unlimited plan or higher.',
        run_in_progress: 'A run is using this sandbox. Save the snapshot when it ends.',
        sandbox_stopped: 'This sandbox is no longer running.',
        snapshot_limit_reached: 'You keep 50 saved snapshots. Delete one first.',
      }[err.code];
      paneStatus(pane, why || sbxWhy(err), 'error');
      if (err.code === 'sandbox_stopped') loadSandboxes();
      return;
    }
    await loadSnapshots();
  });
}

async function stopSandbox(pane, sandbox) {
  const ok = await confirmDialog({
    title: 'Stop this sandbox?',
    text: sandbox.snapshot_on_stop
      ? 'Its files are snapshotted first. The session\'s next run starts a sandbox again, with them.'
      : 'This session saves no snapshot: its files are lost. Its next run starts an empty sandbox.',
    confirm: 'Stop',
    danger: true,
  });
  if (!ok) return;
  await once(`stop:${sandbox.id}`, pane, async () => {
    paneStatus(pane, 'Stopping…');
    try {
      await call(cf.stopSandbox, sandbox.id);
    } catch (err) {
      paneStatus(pane, err.code === 'run_in_progress' ? 'A run is using it. Stop the run first.' : sbxWhy(err), 'error');
      loadSandboxes();
      return;
    }
    sbx.sandboxes = sbx.sandboxes.filter((s) => s.id !== sandbox.id);
    paneStatus(pane, 'Sandbox stopped.', 'ok');
    loadSandboxes();
    if (sandbox.snapshot_on_stop) loadSnapshots();
  });
}

function renderSnapshotsSection(pane) {
  pane.append(sectionHead('Snapshots'));
  if (!sbx.snapshots) {
    pane.append(el('div', 'pane-empty', sbx.snapshotsError || 'Loading…'));
    return;
  }
  if (!sbx.snapshots.length) {
    pane.append(el('div', 'sbx-empty', 'No snapshots. A stopped sandbox leaves one, and you can save one from a running sandbox above.'));
    return;
  }
  for (const snapshot of sbx.snapshots) pane.append(snapshotRow(pane, snapshot));
}

function snapshotRow(pane, snapshot) {
  const row = el('div', 'set-row stack sbx-row');
  row.dataset.snapshot = snapshot.id;
  const head = el('div', 'sbx-head');
  const text = el('div', 'set-text');
  const title = el('div', 'set-title sbx-title');
  title.append(el('span', 'sbx-name', snapshot.name));
  title.append(sbxPill(snapshot.manual ? 'Saved' : 'Automatic', snapshot.manual ? 'accent' : ''));
  if (snapshot.broken) title.append(sbxPill('Broken', 'failed'));
  text.append(title);
  const parts = [`${relTime(snapshot.created_at)} ago`.replace('now ago', 'just now')];
  parts.push(snapshot.pool === 'api' ? (snapshot.session_id ? sessionName(snapshot.session_id) : 'A deleted session') : 'Web chat');
  if (snapshot.sandbox_specs && snapshot.sandbox_specs.length) {
    parts.push(`image of ${snapshot.sandbox_specs.length} ${snapshot.sandbox_specs.length === 1 ? 'spec' : 'specs'}`);
  }
  text.append(el('div', 'set-desc', parts.join(' · ')));
  if (snapshot.description) text.append(el('div', 'set-desc', snapshot.description));
  const actions = el('div', 'sbx-actions');
  const use = el('button', 'btn small', 'New spec from it');
  use.disabled = snapshot.broken;
  use.title = snapshot.broken ? 'It failed to start a sandbox before' : 'Start cloud sessions from this snapshot';
  use.addEventListener('click', () => openSpecEditor({ preset: SBX.formFromSnapshot(snapshot) }));
  const rename = el('button', 'btn small', 'Rename');
  rename.addEventListener('click', () => renameSnapshot(pane, snapshot));
  const remove = el('button', 'icon-button danger');
  remove.title = 'Delete this snapshot';
  remove.innerHTML = ICON.trash;
  remove.addEventListener('click', () => deleteSnapshot(pane, snapshot));
  actions.append(use, rename, remove);
  head.append(text, actions);
  row.append(head);
  return row;
}

async function renameSnapshot(pane, snapshot) {
  const values = await fieldsDialog({
    title: 'Rename the snapshot',
    fields: [
      { key: 'name', label: 'Name', value: snapshot.name, max: 90 },
      { key: 'description', label: 'Description', value: snapshot.description, multiline: true, max: 2000 },
    ],
  });
  if (!values) return;
  if (!values.name) {
    paneStatus(pane, 'A snapshot needs a name.', 'error');
    return;
  }
  const body = {};
  if (values.name !== snapshot.name) body.name = values.name;
  if (values.description !== (snapshot.description || '')) body.description = values.description;
  if (!Object.keys(body).length) return;
  await once(`rename:${snapshot.id}`, pane, async () => {
    const updated = await call(cf.updateSnapshot, { id: snapshot.id, body });
    sbx.snapshots = sbx.snapshots.map((s) => (s.id === updated.id ? updated : s));
    paneStatus(pane, 'Renamed.', 'ok');
    renderSandboxesPane();
  });
}

async function deleteSnapshot(pane, snapshot) {
  if (snapshot.sandbox_specs && snapshot.sandbox_specs.length) {
    const names = snapshot.sandbox_specs.map((id) => (specById(id) ? `"${specById(id).name}"` : 'a spec')).join(', ');
    await confirmDialog({
      title: 'This snapshot is a spec\'s image',
      text: `${names} ${snapshot.sandbox_specs.length === 1 ? 'is' : 'are'} built from it. Change or delete `
        + `${snapshot.sandbox_specs.length === 1 ? 'that spec' : 'those specs'} first.`,
      confirm: 'OK',
    });
    return;
  }
  const ok = await confirmDialog({
    title: `Delete "${snapshot.name}"?`,
    text: snapshot.pool === 'api' && !snapshot.manual
      ? 'Its session\'s next sandbox then starts without these files. This cannot be undone.'
      : 'The snapshot is deleted for good. This cannot be undone.',
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await once(`snapdel:${snapshot.id}`, pane, async () => {
    try {
      await call(cf.deleteSnapshot, snapshot.id);
    } catch (err) {
      paneStatus(pane, err.code === 'snapshot_in_use' ? 'A spec is built from this snapshot. Change it first.' : sbxWhy(err), 'error');
      loadSnapshots();
      return;
    }
    sbx.snapshots = sbx.snapshots.filter((s) => s.id !== snapshot.id);
    paneStatus(pane, 'Snapshot deleted.', 'ok');
    renderSandboxesPane();
  });
}

// ── The account's sandbox settings ─────────────────────────────────────────
// They change the web chat's sandboxes too, so the server takes them only
// from a desktop key (browser sign-in), never from a key made for code.
function renderConfigSection(pane) {
  pane.append(sectionHead('For every sandbox'));
  const config = sbx.config;
  if (!config) {
    pane.append(el('div', 'pane-empty', sbx.configError || 'Loading…'));
    return;
  }
  const key = (S.credits && S.credits.key) || {};
  const locked = key.client !== 'desktop';
  if (locked) {
    pane.append(el('div', 'sbx-note warn', 'Signed in with a key made for code: these settings can be read but not '
      + 'changed here. Sign in with your browser to change them.'));
  }
  const save = (change, done) => once('config', pane, async () => {
    paneStatus(pane, 'Saving…');
    try {
      sbx.config = await call(cf.updateSandboxConfig, change);
    } catch (err) {
      paneStatus(pane, err.code === 'desktop_key_required' ? 'Sign in with your browser to change these settings.' : err.message, 'error');
      renderSandboxesPane();
      return;
    }
    if ('default_spec' in change) loadSpecs(true);
    paneStatus(pane, 'Saved.', 'ok');
    if (done) done();
    renderSandboxesPane();
  });

  const pinRow = el('div', `set-row${locked ? ' disabled' : ''}`);
  const pinText = el('div', 'set-text');
  pinText.append(el('div', 'set-title', 'Default spec'),
    el('div', 'set-desc', 'New sandboxes are built from it when their session does not name a spec: '
      + 'cloud sessions here and the web chat\'s sandbox.'));
  const select = el('select', 'set-select sbx-select');
  select.disabled = locked;
  select.append(new Option('None: the standard image', ''));
  for (const spec of sbx.specs || []) select.append(new Option(spec.name, spec.id));
  if (config.default_spec && !specById(config.default_spec)) select.append(new Option('A spec of the web chat', config.default_spec));
  select.value = config.default_spec || '';
  select.addEventListener('change', () => save({ default_spec: select.value || null }));
  pinRow.append(pinText, select);
  pane.append(pinRow);

  pane.append(switchRow({
    title: 'Start every web chat sandbox empty',
    desc: 'The web chat does not restore its last snapshot. A cloud session here still gets its own files back.',
    checked: config.always_fresh,
    disabled: locked,
    onChange: (on) => save({ always_fresh: on }),
  }));
  pane.append(switchRow({
    title: 'No network in new sandboxes',
    desc: 'Nothing in the sandbox can reach the internet: no package installs, no git clone, no open ports.',
    checked: config.block_network,
    disabled: locked,
    onChange: (on) => save({ block_network: on }),
  }));

  const windowRow = el('div', `set-row${locked ? ' disabled' : ''}`);
  const windowText = el('div', 'set-text');
  windowText.append(el('div', 'set-title', 'Snapshot window'),
    el('div', 'set-desc', 'How old the web chat\'s last snapshot may be, in hours, and still be restored: 1 to 720.'));
  const hours = el('input', 'set-number');
  hours.type = 'number';
  hours.min = '1';
  hours.max = '720';
  hours.step = '1';
  hours.disabled = locked;
  hours.value = String(config.snapshot_window_hours);
  hours.addEventListener('change', () => {
    const value = Math.round(Number(hours.value));
    if (!Number.isFinite(value) || value < 1 || value > 720) {
      paneStatus(pane, 'Enter a whole number of hours from 1 to 720.', 'error');
      hours.value = String(config.snapshot_window_hours);
      return;
    }
    if (value !== config.snapshot_window_hours) save({ snapshot_window_hours: value });
  });
  hours.addEventListener('keydown', (event) => { if (event.key === 'Enter') hours.blur(); });
  windowRow.append(windowText, hours);
  pane.append(windowRow);

  const envRow = el('div', `set-row stack${locked ? ' disabled' : ''}`);
  const envText = el('div', 'set-text');
  envText.append(el('div', 'set-title', 'Env vars for every sandbox'),
    el('div', 'set-desc', 'Set in every new sandbox. A spec\'s own env vars win over these. Values are stored '
      + 'encrypted and never shown again.'));
  envRow.append(envText);
  const list = el('div', 'sbx-env-list');
  for (const name of config.env_var_names || []) {
    const item = el('div', 'sbx-env-saved');
    item.append(el('code', null, name), el('span', 'sbx-env-hidden', 'value hidden'));
    const remove = el('button', 'icon-button danger');
    remove.title = `Remove ${name}`;
    remove.innerHTML = ICON.x;
    remove.disabled = locked;
    remove.addEventListener('click', () => save({ env_vars: { [name]: null } }));
    item.append(remove);
    list.append(item);
  }
  const add = el('div', 'sbx-env-add');
  const name = el('input', 'sbx-input mono');
  name.placeholder = 'NAME';
  name.spellcheck = false;
  const value = el('input', 'sbx-input');
  value.type = 'password';
  value.placeholder = 'value';
  const addButton = el('button', 'btn small', config.env_var_names && config.env_var_names.length ? 'Add or replace' : 'Add');
  for (const input of [name, value]) input.disabled = locked;
  addButton.disabled = locked;
  const submit = () => {
    const row = { ...SBX.envRow(name.value.trim()), value: value.value };
    const problem = SBX.checkEnv([row]) || (!row.name ? 'Give the variable a name.' : '');
    if (problem) {
      paneStatus(pane, problem, 'error');
      return;
    }
    save({ env_vars: { [row.name]: row.value } });
  };
  addButton.addEventListener('click', submit);
  value.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
  add.append(name, value, addButton);
  list.append(add);
  envRow.append(list);
  pane.append(envRow);
}

// ── The spec editor ────────────────────────────────────────────────────────
// A new spec, an edit of `spec`, or a new one filled from `preset` (a snapshot).
function openSpecEditor({ spec = null, preset = null } = {}) {
  if (document.getElementById('specEditor')) return;
  const form = spec ? SBX.formFromSpec(spec) : (preset || SBX.emptyForm());
  const initial = JSON.stringify(form);
  const pane = $('sandboxesPane');
  if (!sbx.snapshots) loadSnapshots();

  const overlay = el('div', 'overlay confirm-overlay');
  overlay.id = 'specEditor';
  const modal = el('div', 'modal sbx-editor');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', spec ? `Edit ${spec.name}` : 'New sandbox spec');
  const head = el('div', 'modal-head');
  const close = el('button', 'icon-button');
  close.title = 'Close';
  close.innerHTML = ICON.x;
  head.append(el('h2', null, spec ? `Edit "${spec.name}"` : 'New sandbox spec'), close);
  const body = el('div', 'sbx-editor-body');
  const status = el('div', 'modal-status');
  const cancel = el('button', 'btn', 'Cancel');
  const saveButton = el('button', 'btn', 'Save');
  const buildButton = el('button', 'btn primary', spec ? 'Save and rebuild' : 'Save and build');
  buildButton.title = 'Build the image now, so the first sandbox does not wait for it';
  const actions = el('div', 'modal-actions');
  actions.append(status, el('div', 'bar-spacer'), cancel, saveButton, buildButton);
  modal.append(head, body, actions);
  overlay.append(modal);

  const setStatus = (text, kind = 'info') => {
    status.textContent = text;
    status.className = `modal-status ${kind}`;
  };

  // The Dockerfile is checked by the server a moment after typing stops.
  let checkTimer = null;
  let checkSeq = 0;
  const dockerfileCheck = el('div', 'sbx-check');
  const checkDockerfile = async () => {
    clearTimeout(checkTimer);
    const seq = ++checkSeq;
    if (!form.dockerfile.trim()) {
      dockerfileCheck.textContent = '';
      return;
    }
    dockerfileCheck.textContent = 'Checking…';
    dockerfileCheck.className = 'sbx-check';
    try {
      const result = await call(cf.validateSandboxSpec, { image_source: 'dockerfile', dockerfile: form.dockerfile });
      if (seq !== checkSeq) return;
      if (result.valid) {
        const steps = result.dockerfile_steps || [];
        dockerfileCheck.textContent = `Looks buildable: ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`
          + ` (${steps.map((s) => s.keyword).join(', ')}). Only a build runs its commands.`;
        dockerfileCheck.className = 'sbx-check good';
      } else {
        dockerfileCheck.textContent = result.error;
        dockerfileCheck.className = 'sbx-check bad';
      }
    } catch (err) {
      if (seq !== checkSeq) return;
      dockerfileCheck.textContent = err.message;
      dockerfileCheck.className = 'sbx-check bad';
    }
  };

  const field = (label, input, hint) => {
    const wrap = el('div', 'sbx-field');
    wrap.append(el('label', 'sbx-label', label), input);
    if (hint) wrap.append(el('div', 'sbx-hint', hint));
    return wrap;
  };

  const draw = () => {
    body.replaceChildren();
    const name = el('input', 'sbx-input');
    name.value = form.name;
    name.maxLength = SBX.LIMITS.name;
    name.placeholder = 'Go 1.23 for the course';
    name.addEventListener('input', () => { form.name = name.value; });
    body.append(field('Name', name, 'Shown when you choose the spec for a session. Empty: its image.'));

    const description = el('textarea', 'sbx-input');
    description.rows = 2;
    description.maxLength = SBX.LIMITS.description;
    description.value = form.description;
    description.addEventListener('input', () => { form.description = description.value; });
    body.append(field('Description (optional)', description));

    const seg = el('div', 'seg sbx-seg');
    for (const source of SBX.SOURCES) {
      const button = el('button', `seg-btn${form.image_source === source.id ? ' active' : ''}`, source.short);
      button.type = 'button';
      button.dataset.source = source.id;
      button.addEventListener('click', () => {
        form.image_source = source.id;
        draw();
      });
      seg.append(button);
    }
    body.append(field('Image', seg, SBX.sourceOf(form.image_source).desc));

    if (form.image_source === 'dockerhub') {
      const image = el('input', 'sbx-input mono');
      image.value = form.registry_image;
      image.placeholder = 'golang:1.23';
      image.spellcheck = false;
      image.maxLength = SBX.LIMITS.registry;
      image.addEventListener('input', () => { form.registry_image = image.value; });
      body.append(field('Image name', image, 'A public image. Pin a version (golang:1.23, not golang) so every session gets the same one.'));
    } else if (form.image_source === 'dockerfile') {
      const text = el('textarea', 'sbx-input mono sbx-dockerfile');
      text.rows = 12;
      text.spellcheck = false;
      text.value = form.dockerfile;
      text.placeholder = 'FROM gcc:13\nRUN apt-get update && apt-get install -y valgrind gdb\n';
      text.addEventListener('input', () => {
        form.dockerfile = text.value;
        clearTimeout(checkTimer);
        checkTimer = setTimeout(checkDockerfile, 700);
      });
      text.addEventListener('keydown', (event) => {
        // Tab writes two spaces instead of leaving the field.
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          text.setRangeText('  ', text.selectionStart, text.selectionEnd, 'end');
          form.dockerfile = text.value;
        }
      });
      body.append(field('Dockerfile', text,
        'No build context: COPY and ADD of local files are refused. Fetch what you need with RUN (curl, git clone), '
        + 'or COPY --from another stage. An ENTRYPOINT must end in exec "$@".'));
      body.append(dockerfileCheck);
      if (form.dockerfile.trim() && !dockerfileCheck.textContent) checkDockerfile();
    } else if (form.image_source === 'snapshot') {
      const select = el('select', 'set-select sbx-input');
      const usable = (sbx.snapshots || []).filter((s) => !s.broken);
      select.append(new Option(sbx.snapshots ? (usable.length ? 'Choose a snapshot' : 'No snapshot to use yet') : 'Loading snapshots…', ''));
      for (const snapshot of usable) {
        select.append(new Option(`${snapshot.name} · ${snapshot.manual ? 'saved' : 'automatic'}`, snapshot.id));
      }
      if (form.snapshot && !usable.some((s) => s.id === form.snapshot)) {
        select.append(new Option(`${form.snapshot} (not in the list)`, form.snapshot));
      }
      select.value = form.snapshot || '';
      select.addEventListener('change', () => { form.snapshot = select.value; });
      body.append(field('Snapshot', select, 'Save a snapshot from a running sandbox in Settings → Cloud sandboxes → Running now.'));
      if (!sbx.snapshots) loadSnapshots().then(() => { if (document.getElementById('specEditor')) draw(); });
    }

    if (SBX.ESSENTIALS_SOURCES.includes(form.image_source)) {
      body.append(switchRow({
        title: "Install CodingFleet's tooling",
        desc: 'git, curl, Python 3, zip, ripgrep and build tools, with apt (or apk on Alpine). The agent\'s '
          + 'file and git tools need them; turn it off only if your image has them.',
        checked: form.install_essentials,
        onChange: (on) => { form.install_essentials = on; },
      }));
    }

    body.append(el('div', 'sbx-label sbx-env-title', 'Environment variables'));
    body.append(el('div', 'sbx-hint', 'Set in the sandbox when it starts, never written into the image. Values are '
      + 'stored encrypted and never shown again: leave a saved one empty to keep it.'));
    const envList = el('div', 'sbx-env-list');
    form.env.forEach((row) => {
      const line = el('div', `sbx-env-edit${row.removed ? ' removed' : ''}`);
      const name = el('input', 'sbx-input mono');
      name.value = row.name;
      name.placeholder = 'NAME';
      name.spellcheck = false;
      name.disabled = row.existing;
      name.addEventListener('input', () => { row.name = name.value; });
      const value = el('input', 'sbx-input');
      value.type = 'password';
      value.value = row.value;
      value.placeholder = row.existing ? 'saved, hidden — type to replace' : 'value';
      value.disabled = row.removed;
      value.addEventListener('input', () => { row.value = value.value; });
      const remove = el('button', 'icon-button danger');
      remove.type = 'button';
      remove.title = row.removed ? 'Keep it' : 'Remove';
      remove.innerHTML = row.removed ? ICON.refresh : ICON.x;
      remove.addEventListener('click', () => {
        if (row.existing) row.removed = !row.removed;
        else form.env.splice(form.env.indexOf(row), 1);
        draw();
      });
      line.append(name, value, remove);
      envList.append(line);
    });
    const addEnv = el('button', 'sbx-link', '+ Add a variable');
    addEnv.type = 'button';
    addEnv.addEventListener('click', () => {
      form.env.push(SBX.envRow());
      draw();
      const inputs = body.querySelectorAll('.sbx-env-edit input:not([disabled])');
      if (inputs.length >= 2) inputs[inputs.length - 2].focus();
    });
    envList.append(addEnv);
    body.append(envList);
  };

  const dirty = () => JSON.stringify(form) !== initial;
  const done = () => {
    clearTimeout(checkTimer);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const leave = async () => {
    if (dirty() && !(await confirmDialog({ title: 'Discard your changes?', text: 'The spec stays as it was.', confirm: 'Discard', danger: true }))) return;
    done();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && !document.querySelector('.confirm-overlay:not(#specEditor)')) {
      event.stopPropagation();
      leave();
    }
  };

  const save = async (build) => {
    const problem = SBX.checkForm(form);
    if (problem) {
      setStatus(problem, 'error');
      return;
    }
    const request = SBX.specBody(form, spec);
    if (spec && !Object.keys(request).length && !build) {
      done();
      return;
    }
    for (const button of [saveButton, buildButton]) button.disabled = true;
    setStatus('Saving…');
    let saved;
    try {
      saved = spec && !Object.keys(request).length ? spec
        : spec ? await call(cf.updateSandboxSpec, { id: spec.id, body: request })
          : await call(cf.createSandboxSpec, request);
    } catch (err) {
      for (const button of [saveButton, buildButton]) button.disabled = false;
      const why = {
        spec_limit_reached: 'You keep 50 specs, the most an account can. Delete one first.',
        build_in_progress: 'This spec is being built. Save when the build ends.',
        snapshot_not_found: 'That snapshot no longer exists. Choose another.',
        snapshot_broken: 'That snapshot failed to start a sandbox before. Choose another.',
      }[err.code];
      setStatus(why || sbxWhy(err), 'error');
      if (err.code === 'snapshot_not_found') loadSnapshots();
      return;
    }
    replaceSpec(saved);
    done();
    paneStatus(pane, spec ? `"${saved.name}" saved.` : `"${saved.name}" created.`, 'ok');
    if (build) {
      try {
        replaceSpec(await call(cf.buildSandboxSpec, saved.id));
        sbx.building.set(saved.id, 'building');
        paneStatus(pane, `Building "${saved.name}"…`);
      } catch (err) {
        paneStatus(pane, err.code === 'paid_plan_required' ? 'Saved. Building needs a paid plan.'
          : `Saved, but the build did not start: ${sbxWhy(err)}`, 'error');
      }
    }
    scheduleBuildPoll();
    sandboxDataChanged();
  };

  close.addEventListener('click', leave);
  cancel.addEventListener('click', leave);
  saveButton.addEventListener('click', () => save(false));
  buildButton.addEventListener('click', () => save(true));
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) leave(); });
  document.addEventListener('keydown', onKey, true);
  draw();
  document.body.append(overlay);
  setTimeout(() => { const first = body.querySelector('input'); if (first) first.focus(); }, 0);
}
