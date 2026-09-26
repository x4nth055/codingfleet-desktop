'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. The settings window: account, privacy and preferences.

// ── Settings ───────────────────────────────────────────────────────────────
let settingsRequired = false;

function openSettings(required = false, tab = 'account') {
  closeMenus();
  settingsRequired = required;
  const settings = S.settings;
  $('settings').hidden = false;
  // Without a key there is only the account to set up.
  $('settingsTabs').hidden = required || !settings.hasKey;
  localChecked = false;
  billingData = null; // billing changes on the website too: read it again
  invoicesOpen.clear();
  for (const pane of document.querySelectorAll('.settings-pane')) pane.statusNote = null;
  showSettingsTab(required || !settings.hasKey ? 'account' : tab);
  $('settingsClose').hidden = required;
  $('settingsCancel').hidden = required;
  $('settingsIntro').textContent = required
    ? 'Paste your CodingFleet API key to start.'
    : settings.hasKey ? '' : 'Your API key, and the server this app talks to.';
  $('settingsIntro').hidden = !required && settings.hasKey;
  renderSignedIn(!required && settings.hasKey);
  const input = $('keyInput');
  input.value = '';
  input.type = 'password';
  $('keyShow').textContent = 'Show';
  input.placeholder = settings.hasKey ? `Saved: ${settings.keyHint}` : 'cf_sk_…';
  const link = $('keyLink');
  link.href = `${originOf(settings.apiBase)}/agent-api/`;
  link.textContent = `${originOf(settings.apiBase).replace(/^https?:\/\//, '')}/agent-api`;
  // Signed in: the card says so and has Sign out; the key field is for switching.
  $('keyRemove').hidden = true;
  setSettingsStatus(settings.fromEnv
    ? 'An environment variable sets the key or the server. It overrides these settings when the app starts.'
    : '', 'info');
  $('settingsSave').disabled = false;
  setTimeout(() => input.focus(), 0);
}

function closeSettings() {
  if (settingsRequired && !S.settings.hasKey) return;
  $('settings').hidden = true;
}

function setSettingsStatus(text, kind = 'info') {
  const status = $('settingsStatus');
  status.textContent = text;
  status.className = `modal-status ${kind}`;
}

function resetAccountView() {
  S.transcripts.clear();
  S.loaded.clear();
  S.sessions = [];
  S.credits = null;
  S.current = null;
}

// The account the app works as has changed: forget what the old one loaded.
async function applyNewAccount(data) {
  resetAccountView();
  S.settings = data.settings;
  S.credits = data.credits;
  settingsRequired = false;
  $('settings').hidden = true;
  renderAccount();
  renderSidebar();
  renderMain();
  // A first sign-in is also the first start that can ask about updates.
  askAboutUpdates();
  await loadAll();
}

// Sign in through the browser: no key is typed, and the password never comes
// near this app. The main process waits for the approval on codingfleet.com.
async function signInWithBrowser() {
  const button = $('browserSignIn');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Waiting for your browser…';
  setSettingsStatus('Approve this app in the browser, then come back.', 'info');
  const res = await cf.signIn({});
  button.disabled = false;
  button.textContent = label;
  if (!res.ok) {
    setSettingsStatus(res.error.message, 'error');
    return;
  }
  await applyNewAccount(res.data);
}

async function saveSettings() {
  const save = $('settingsSave');
  save.disabled = true;
  setSettingsStatus('Checking the key…', 'info');
  const res = await cf.saveSettings({ apiKey: $('keyInput').value });
  save.disabled = false;
  if (!res.ok) {
    setSettingsStatus(res.error.message, 'error');
    return;
  }
  resetAccountView();
  S.settings = res.data.settings;
  S.credits = res.data.credits;
  settingsRequired = false;
  $('settings').hidden = true;
  renderAccount();
  renderSidebar();
  renderMain();
  await loadAll();
}

// Who this app is signed in as, and a way to switch or sign out. Shown instead
// of the sign-in form when a key is saved.
function renderSignedIn(show) {
  const card = $('signedIn');
  $('signInBlock').hidden = show;
  card.hidden = !show;
  if (!show) return;
  const credits = S.credits || {};
  const account = credits.account || {};
  const key = credits.key || {};
  const plan = credits.plan;
  card.replaceChildren();
  const badge = el('span', 'signed-in-badge');
  badge.innerHTML = ICON.check;
  const text = el('div', 'signed-in-text');
  const title = el('div', 'signed-in-title');
  title.append(el('span', null, 'Signed in'));
  if (plan) title.append(el('span', 'pill signed-in-plan', `${plan.name} plan`));
  text.append(title);
  const who = account.email || account.username;
  text.append(el('div', 'signed-in-who', who
    ? `as ${account.username && account.email ? `${account.username} (${account.email})` : who}`
    : S.creditsError ? 'Could not reach your account just now.' : 'Loading your account…'));
  const keyName = key.name ? `${key.name} · ` : '';
  const kind = key.client === 'desktop' ? ' · Desktop app key' : key.client === 'api' ? ' · Key for code' : '';
  text.append(el('div', 'signed-in-key', `Key: ${keyName}${key.hint || S.settings.keyHint || ''}${kind}`
    + (S.settings.apiBase !== S.settings.defaultApiBase ? ` · ${S.settings.apiBase}` : '')));
  if (S.settings.keyProtected === false && !S.settings.fromEnv) {
    const warn = el('div', 'signed-in-warn');
    warn.append(el('strong', null, 'Your key is saved without encryption. '),
      el('span', null, 'This computer has no keyring (GNOME Keyring or KWallet) for the app to lock it '
        + 'with, so anyone who can read your files can read the key. Install and unlock one, then sign '
        + 'in again, or revoke this key when you stop using the app.'));
    text.append(warn);
  }
  if (paysWithThisKey()) {
    const warn = el('div', 'signed-in-warn');
    warn.append(el('strong', null, 'Unlimited models cost credits with this key. '),
      el('span', null, `It was made for code, and the server prices a key, not the app. Sign in with `
        + `your browser: the app gets a desktop key, and your ${plan.name} plan's Unlimited models cost `
        + 'no credits here again.'));
    const fix = el('button', 'btn primary small', 'Sign in with your browser');
    fix.addEventListener('click', fixKeyType);
    warn.append(fix);
    text.append(warn);
  }
  const actions = el('div', 'signed-in-actions');
  const other = el('button', 'btn', 'Use another account');
  other.addEventListener('click', () => {
    $('signInBlock').hidden = false;
    other.hidden = true;
    $('keyInput').focus();
  });
  const out = el('button', 'btn danger', 'Sign out');
  out.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Sign out of CodingFleet?',
      text: 'The key is removed from this computer. Your sessions stay in your account; sign in again to see them.',
      confirm: 'Sign out',
      danger: true,
    });
    if (ok) removeKey();
  });
  actions.append(other, out);
  card.append(badge, text, actions);
  if (!credits.account && !S.creditsError) loadCredits().then(() => { if (!card.hidden) renderSignedIn(true); });
}

// A new sign-in replaces the key on this computer with a desktop key. The old
// key stays on the account until revoked on codingfleet.com/agent-api.
function fixKeyType() {
  $('signInBlock').hidden = false;
  signInWithBrowser();
}

async function removeKey() {
  const res = await cf.removeKey();
  if (!res.ok) {
    setSettingsStatus(res.error.message, 'error');
    return;
  }
  resetAccountView();
  S.settings = res.data;
  S.models = [];
  renderAccount();
  renderSidebar();
  renderMain();
  openSettings(true);
}

// ── Settings tabs ──────────────────────────────────────────────────────────
let settingsTab = 'account';

function showSettingsTab(tab) {
  settingsTab = tab;
  for (const button of document.querySelectorAll('#settingsTabs [data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const pane of document.querySelectorAll('.settings-pane')) pane.hidden = pane.dataset.pane !== tab;
  if (tab === 'privacy') renderPrivacyPane();
  if (tab === 'preferences') renderPreferencesPane();
  if (tab === 'mcp') renderMcpPane();
  if (tab === 'keys') renderKeysPane();
  if (tab === 'billing') renderBillingPane();
}

// A pane's last message is kept on the pane, so it survives the pane's redraw.
function paneStatus(pane, text, kind = 'info') {
  pane.statusNote = { text, kind, at: Date.now() };
  applyStatus(pane);
}

function applyStatus(pane) {
  const status = pane.querySelector('.pane-status');
  if (!status) return;
  const note = pane.statusNote;
  const age = note ? Date.now() - note.at : 0;
  const fresh = note && (note.kind !== 'ok' || age < 2200);
  status.textContent = fresh ? note.text : '';
  status.className = `pane-status ${fresh ? note.kind : ''}`;
  clearTimeout(pane.statusTimer);
  if (fresh && note.kind === 'ok') pane.statusTimer = setTimeout(() => applyStatus(pane), 2300 - age);
}

function switchRow({ title, desc, checked, disabled = false, sub = false, warn = false, onChange }) {
  const row = el('label', `set-row${sub ? ' sub' : ''}${disabled ? ' disabled' : ''}${warn ? ' warn' : ''}`);
  const text = el('div', 'set-text');
  text.append(el('div', 'set-title', title));
  if (desc) text.append(el('div', 'set-desc', desc));
  const toggle = el('span', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked, input));
  toggle.append(input, el('span', 'switch-track'));
  row.append(text, toggle);
  return row;
}

function paneHead(title, intro) {
  const head = el('div', 'pane-head');
  head.append(el('h3', null, title));
  if (intro) head.append(el('p', null, intro));
  return head;
}

function accountPane(id, title, intro) {
  const pane = $(id);
  pane.replaceChildren(paneHead(title, intro));
  if (!S.account) {
    pane.append(el('div', 'pane-empty', S.accountError || 'Loading your settings…'));
    if (!S.accountError) loadAccountSettings().then(() => showSettingsTab(settingsTab));
    return null;
  }
  return pane;
}

async function saveAccountSettings(pane, change, { reloadModels = false } = {}) {
  paneStatus(pane, 'Saving…');
  try {
    S.account = await call(cf.updateSettings, change);
    paneStatus(pane, 'Saved', 'ok');
    if (reloadModels) {
      S.models = [];
      await loadModels();
    }
    applyDefaultModel();
  } catch (err) {
    paneStatus(pane, err.message, 'error');
  }
  showSettingsTab(settingsTab);
}

function renderPrivacyPane() {
  const pane = accountPane('privacyPane', 'Data privacy',
    'How your prompts are routed and stored. These settings belong to your CodingFleet account: they are the '
    + 'same as on codingfleet.com, and they apply to every run, from any app.');
  if (!pane) return;
  const privacy = S.account.privacy;
  const save = (change, options) => saveAccountSettings(pane, { privacy: change }, options);
  pane.append(switchRow({
    title: 'Privacy-focused models',
    desc: 'Only models that do not use your data for training, through providers that do not collect prompts. '
      + 'Other models are hidden from the picker.',
    checked: privacy.privacy_models,
    onChange: (on) => save({ privacy_models: on }, { reloadModels: true }),
  }));
  pane.append(switchRow({
    title: 'Enforce zero data retention',
    desc: 'Only providers that keep nothing: your prompts and answers are never stored by them. '
      + 'Your sessions are still saved to your CodingFleet account.',
    checked: privacy.zero_data_retention,
    disabled: !privacy.privacy_models,
    sub: true,
    onChange: (on) => save({ zero_data_retention: on }, { reloadModels: true }),
  }));
  if (privacy.data_region_available) {
    const row = el('div', `set-row sub${privacy.privacy_models ? '' : ' disabled'}`);
    const text = el('div', 'set-text');
    text.append(el('div', 'set-title', 'Data residency'),
      el('div', 'set-desc', 'Requests are served only inside the region you choose. The United States region is set on your account page.'));
    const seg = el('div', 'seg');
    for (const [value, label] of [['', 'Global'], ['eu', 'EU'], ['us', 'US']]) {
      const button = el('button', `seg-btn${privacy.data_region === value ? ' active' : ''}`, label);
      button.disabled = !privacy.privacy_models || (value === 'us' && privacy.data_region !== 'us');
      button.addEventListener('click', () => save({ data_region: value }));
      seg.append(button);
    }
    row.append(text, seg);
    pane.append(row);
  }
  if (privacy.private_sessions) {
    const row = el('div', 'set-row warn static');
    const text = el('div', 'set-text');
    text.append(el('div', 'set-title', 'Private session mode is on'),
      el('div', 'set-desc', 'It is set on your account page. While it is on, nothing new is stored on CodingFleet, '
        + 'so this app cannot send messages: a session is its stored history. Turn it off on the account page to '
        + 'use the app.'));
    row.append(text);
    pane.append(row);
  }
  const foot = el('div', 'pane-foot');
  const link = el('a', null, 'Open your account page');
  link.href = `${originOf(S.settings.apiBase)}/account/`;
  foot.append(el('div', 'pane-status'), link);
  pane.append(foot);
  applyStatus(pane);
}

// ── Themes ─────────────────────────────────────────────────────────────────
const THEMES = [
  { id: 'dark', name: 'Dark', desc: 'Easy on the eyes' },
  { id: 'light', name: 'Light', desc: 'For bright rooms' },
  { id: 'hacker', name: 'Hacker', desc: 'Green on black terminal' },
];

function currentTheme() {
  return document.documentElement.dataset.theme || 'dark';
}

function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = 'dark';
  document.documentElement.dataset.theme = id;
  const link = $('hljsTheme');
  if (link && link.dataset[id]) link.href = link.dataset[id];
  if (S.init && S.init.state) S.init.state.theme = id;
  return cf.setTheme(id);
}

function themeSection() {
  const wrap = el('div', 'theme-section');
  wrap.append(el('div', 'pane-section first', 'Appearance'));
  const grid = el('div', 'theme-grid');
  for (const theme of THEMES) {
    const card = el('button', `theme-card${currentTheme() === theme.id ? ' active' : ''}`);
    card.type = 'button';
    card.dataset.preview = theme.id;
    const preview = el('span', 'theme-preview');
    const side = el('span', 'tp-side');
    side.append(el('span', 'tp-dot'), el('span', 'tp-line'), el('span', 'tp-line short'));
    const body = el('span', 'tp-body');
    body.append(el('span', 'tp-line wide'), el('span', 'tp-line'), el('span', 'tp-bubble'), el('span', 'tp-input'));
    preview.append(side, body);
    const label = el('span', 'theme-label');
    label.append(el('span', 'theme-name', theme.name), el('span', 'theme-desc', theme.desc));
    card.append(preview, label);
    card.addEventListener('click', () => {
      applyTheme(theme.id);
      for (const other of grid.children) other.classList.toggle('active', other === card);
    });
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

function renderPreferencesPane() {
  const pane = accountPane('prefsPane', 'Preferences',
    'How the app looks, your defaults for new sessions, and how much one message may spend.');
  // The theme is kept on this computer, so it shows even before the account loads.
  $('prefsPane').insertBefore(themeSection(), $('prefsPane').children[1] || null);
  if (!pane) return;
  pane.append(el('div', 'pane-section', 'New sessions'));
  const prefs = S.account.preferences;
  const save = (change, options) => saveAccountSettings(pane, { preferences: change }, options);

  const modelRow = el('div', 'set-row stack');
  const modelText = el('div', 'set-text');
  modelText.append(el('div', 'set-title', 'Default AI model'),
    el('div', 'set-desc', 'New sessions start on this model. You can still pick another one for each session.'));
  const current = prefs.default_model || 'auto';
  const choose = (id) => {
    closeMenus();
    S.init.state.model = id;
    cf.setState({ model: id });
    save({ default_model: id });
  };
  const field = el('div', 'pref-model');
  const modelButton = el('button', 'bar-button pref-toggle');
  modelButton.replaceChildren(...modelButtonParts(current));
  modelButton.title = 'Default model';
  const menu = el('div', 'menu model-menu pref-menu');
  menu.hidden = true;
  const search = el('input');
  search.placeholder = 'Search models or providers';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const list = el('div', 'menu-list');
  menu.append(search, list);
  const picker = { list, selected: current, choose };
  search.addEventListener('input', () => renderModelList(search.value, picker));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = list.querySelector('.menu-item');
      if (first) first.click();
    }
  });
  modelButton.addEventListener('click', () => {
    const open = !menu.hidden;
    closeMenus();
    if (open) return;
    ensureModels().then(() => { if (!menu.hidden) renderModelList(search.value, picker); });
    menu.hidden = false;
    search.value = '';
    renderModelList('', picker);
    search.focus();
    const selected = list.querySelector('.menu-item.selected');
    if (selected) selected.scrollIntoView({ block: 'center' });
  });
  field.append(modelButton, menu);

  const effortParts = effortButtonParts(current);
  if (effortParts) {
    const effortButton = el('button', 'bar-button pref-toggle');
    effortButton.replaceChildren(...effortParts);
    effortButton.title = 'Thinking effort';
    const effortMenu = el('div', 'menu effort-menu pref-menu');
    effortMenu.hidden = true;
    const effortList = el('div', 'menu-list');
    effortMenu.append(effortList);
    effortButton.addEventListener('click', () => {
      const open = !effortMenu.hidden;
      closeMenus();
      if (open) return;
      fillEffortList(effortList, current, choose);
      effortMenu.style.left = `${effortButton.offsetLeft}px`;
      effortMenu.hidden = false;
    });
    field.append(effortButton, effortMenu);
  }
  modelRow.append(modelText, field);
  if (!S.models.length) modelRow.append(el('div', 'set-desc', S.modelsError || 'Loading models…'));
  pane.append(modelRow);

  pane.append(switchRow({
    title: 'Show legacy models',
    desc: 'List older models in the picker. They may have reduced support.',
    checked: prefs.show_legacy_models,
    onChange: (on) => save({ show_legacy_models: on }, { reloadModels: true }),
  }));

  // Kept on this computer; they apply to sessions created from now on.
  const caps = S.init.state.capabilities || {};
  const setCapability = (key, on) => {
    S.init.state.capabilities = { ...caps, [key]: on };
    caps[key] = on;
    cf.setState({ capabilities: { [key]: on } });
    paneStatus(pane, 'Saved. New sessions use this.', 'ok');
  };
  pane.append(switchRow({
    title: 'Image generation',
    desc: 'The agent can create images from a description. Each image costs credits. '
      + 'Applies to new sessions.',
    checked: caps.image_generation,
    onChange: (on) => setCapability('image_generation', on),
  }));
  pane.append(switchRow({
    title: 'Memory',
    desc: 'The agent can read and update your CodingFleet memory: what it knows about you and your work, '
      + 'shared with the web chat. Applies to new sessions.',
    checked: caps.memory,
    onChange: (on) => setCapability('memory', on),
  }));

  pane.append(el('div', 'pane-section', 'This computer'));
  pane.append(switchRow({
    title: 'Notifications',
    desc: 'Tell me when a run finishes or waits for my approval while I am in another window.',
    checked: S.init.state.notifications !== false,
    onChange: (on) => {
      S.init.state.notifications = on;
      cf.setState({ notifications: on });
      paneStatus(pane, 'Saved.', 'ok');
    },
  }));
  pane.append(switchRow({
    title: 'Keep the computer awake while the agent works',
    desc: 'Stops Windows from putting the computer to sleep on its own during a run, so you can walk '
      + 'away. The screen still turns off. Closing the lid or choosing Sleep still sleeps it.',
    checked: S.init.state.keepAwake !== false,
    onChange: (on) => {
      S.init.state.keepAwake = on;
      cf.setState({ keepAwake: on });
      paneStatus(pane, 'Saved.', 'ok');
    },
  }));

  pane.append(el('div', 'pane-section', 'Updates'));
  const updateRow = el('div', 'set-row');
  const updateText2 = el('div', 'set-text');
  updateText2.append(el('div', 'set-title', 'Version'), el('div', 'set-desc'));
  updateText2.querySelector('.set-desc').id = 'updateLine';
  updateRow.append(updateText2, el('button', 'btn small', 'Check now'));
  pane.append(updateRow);
  renderUpdateRow(updateRow);
  if (!updateState && typeof cf.updateStatus === 'function') {
    call(cf.updateStatus).then((status) => { updateState = status; renderUpdateRow(updateRow); }).catch(() => {});
  }
  pane.append(switchRow({
    title: 'Update automatically',
    desc: 'Check for new versions and download them in the background; they install when you restart '
      + 'the app, never on their own. Off: the app never contacts the update server unless you press Check now.',
    checked: S.init.state.autoUpdate === true,
    onChange: (on) => {
      S.init.state.autoUpdate = on;
      cf.setState({ autoUpdate: on });
      paneStatus(pane, 'Saved.', 'ok');
    },
  }));

  pane.append(el('div', 'pane-section', 'Diagnostics'));
  const logs = el('div', 'set-row');
  const logsText = el('div', 'set-text');
  logsText.append(el('div', 'set-title', 'Log and crash reports'),
    el('div', 'set-desc', 'The app keeps a log of what it did — runs, tools, connection trouble, crashes — '
      + 'but never your messages, files or key. After a crash it asks before sending anything.'));
  const openLogs = el('button', 'btn small', 'Open log folder');
  openLogs.addEventListener('click', () => call(cf.openLogs).catch((err) => paneStatus(pane, err.message, 'error')));
  logs.append(logsText, openLogs);
  pane.append(logs);

  pane.append(el('div', 'pane-section', 'Spending control'));
  const capRow = el('div', 'set-row');
  const capText = el('div', 'set-text');
  capText.append(el('div', 'set-title', 'Credit cap per message'),
    el('div', 'set-desc', 'A message stops when it has spent this many credits, tool rounds included. '
      + '0 means no cap; the lowest cap applied is 20.'));
  const cap = el('input', 'set-number');
  cap.type = 'number';
  cap.min = '0';
  cap.max = '100000';
  cap.step = '1';
  cap.value = String(prefs.credit_cap_per_message || 0);
  const saveCap = () => {
    const value = Math.round(Number(cap.value));
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      paneStatus(pane, 'Enter a whole number from 0 to 100,000.', 'error');
      return;
    }
    if (value !== (prefs.credit_cap_per_message || 0)) save({ credit_cap_per_message: value });
  };
  cap.addEventListener('change', saveCap);
  cap.addEventListener('keydown', (event) => { if (event.key === 'Enter') cap.blur(); });
  capRow.append(capText, cap);
  pane.append(capRow);

  pane.append(switchRow({
    title: 'Economy mode',
    desc: 'Spend fewer credits on long sessions: the conversation is compacted at 40% of your context limit '
      + 'instead of 90%, so each tool round re-sends much less. Older details are summarized sooner.',
    checked: prefs.economy_mode,
    onChange: (on) => save({ economy_mode: on }),
  }));
  const foot = el('div', 'pane-foot');
  foot.append(el('div', 'pane-status'));
  pane.append(foot);
  applyStatus(pane);
}
