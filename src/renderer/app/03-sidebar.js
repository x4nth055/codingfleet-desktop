'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. The session list, what can be done to a session, and the header.

// ── Sidebar ────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = $('sessionList');
  list.replaceChildren();
  if (!S.settings.hasKey) {
    list.append(el('div', 'sidebar-empty', 'Add your API key to see your sessions.'));
    return;
  }
  if (S.sessionsError && !S.sessions.length) {
    list.append(el('div', 'sidebar-empty', S.sessionsError));
    return;
  }
  if (!S.sessions.length) {
    list.append(el('div', 'sidebar-empty', 'Your sessions will show here.'));
    return;
  }
  const when = (s) => new Date(s.last_used_at || s.last_message_at || s.created_at).getTime();
  // A search keeps the sessions whose name or folder holds every word typed,
  // and opens every folder: a match hidden in a folded group is no match.
  const searching = Boolean(sessionQuery.trim());
  const sorted = [...S.sessions]
    .filter((s) => !searching || CF_SESSION_TOOLS.sessionMatches(sessionQuery,
      [sessionLabel(s), s.title, sessionGroup(s), local(s.id).cwd]))
    .sort((a, b) => when(b) - when(a));
  if (!sorted.length) {
    list.append(el('div', 'sidebar-empty', `No session matches “${sessionQuery.trim()}”.`));
    return;
  }

  // A spec's folder needs the spec's name: the specs are loaded once, and the
  // sidebar is drawn again when they come.
  if (!sbx.specs && !sbx.specsLoading && !sbx.unsupported && !sbx.specsError
      && S.sessions.some((s) => s.executor !== 'client' && s.sandbox_spec)) loadSpecs();

  // Pinned sessions first, whatever their folder. The rest by folder, as in
  // Claude Code: the folder is what a person remembers, not the day they started.
  // Keyed apart from the name, so a spec and a local folder of the same name
  // stay two folders.
  const groups = new Map();
  const names = new Map();
  const pinned = sorted.filter((s) => s.pinned);
  if (pinned.length) groups.set('Pinned', pinned);
  for (const session of sorted) {
    if (session.pinned) continue;
    const spec = sessionSpec(session);
    const key = spec ? `spec:${spec.id}` : sessionGroup(session);
    names.set(key, sessionGroup(session));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }

  // A folder sits where its most recently used session sits, so the one you
  // just worked in is always at the top -- and the sessions inside it already
  // follow the same order, having been pushed in it.
  const newest = (sessions) => Math.max(...sessions.map(when));
  const ordered = [...groups.entries()].sort(([a, sa], [b, sb]) => {
    if (a === 'Pinned') return b === 'Pinned' ? 0 : -1;
    if (b === 'Pinned') return 1;
    return newest(sb) - newest(sa);
  });

  for (const [key, sessions] of ordered) {
    const name = names.get(key) || key;
    const collapsed = !searching && S.collapsed.has(key);
    // A div, not a button: the header carries a button of its own, and a
    // button inside a button is not something a browser will render.
    const head = el('div', `group-head${collapsed ? ' collapsed' : ''}${key === 'Pinned' ? ' pinned' : ''}`);
    const spec = key === 'Pinned' ? null : sessionSpec(sessions[0]);
    const cwd = key === 'Pinned' || spec ? null : local(sessions[0].id).cwd;
    head.title = cwd || (spec ? `Cloud sandbox built from "${spec.name}" (${spec.summary})` : name);
    head.tabIndex = 0;
    head.setAttribute('role', 'button');
    head.append(chevron());
    if (key === 'Pinned') head.append(icon('pin', 'icon group-icon'));
    if (spec) head.append(icon('box', 'icon group-icon'));
    head.append(el('span', 'group-name', name), el('span', 'group-count', String(sessions.length)));
    // The folder is already known, so a new session in it is one click: the
    // same thing as New session, with the folder (or the spec) picked for you.
    if (cwd || spec) {
      const add = el('button', 'group-add');
      add.title = cwd ? `New session in ${cwd}` : `New cloud session on "${spec.name}"`;
      add.setAttribute('aria-label', `New session in ${name}`);
      add.innerHTML = ICON.plus;
      add.addEventListener('click', (event) => {
        event.stopPropagation();
        if (cwd) newSessionIn(cwd);
        else newSessionOnSpec(spec.id);
      });
      head.append(add);
    }
    const toggle = () => {
      if (collapsed) S.collapsed.delete(key);
      else S.collapsed.add(key);
      renderSidebar();
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (event) => {
      if (event.target !== head) return; // the + button answers its own keys
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    list.append(head);
    if (collapsed) continue;
    for (const session of sessions) list.append(sessionRow(session));
  }
}

function sessionRow(session) {
  const iso = session.last_used_at || session.created_at;
  const row = el('div', `session${session.id === S.current ? ' selected' : ''}`);
  row.dataset.id = session.id;
  if (renaming === session.id) {
    const input = el('input', 'session-rename');
    input.value = sessionLabel(session);
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Session name');
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      finishRename(session.id, input.value, save);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    row.classList.add('renaming');
    row.append(input, el('div', 'session-meta', `${groupOf(iso)} · ${relTime(iso)}`));
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return row;
  }
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.title = sessionLabel(session);
  const side = el('span', 'session-side');
  if (S.running.has(session.id) || S.remoteBusy.has(session.id)) side.append(el('span', 'dot running'));
  const more = el('button', 'session-more');
  more.title = 'Rename, duplicate, pin or delete';
  more.setAttribute('aria-label', 'Session actions');
  more.innerHTML = ICON.more;
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!$('sessionMenu').hidden && $('sessionMenu').dataset.id === session.id) closeMenus();
    else openSessionMenu(session, more);
  });
  side.append(more);
  row.append(
    el('div', 'session-title', sessionLabel(session)),
    side,
    el('div', 'session-meta', `${groupOf(iso)} · ${relTime(iso)}`),
  );
  row.addEventListener('click', () => selectSession(session.id));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === row) selectSession(session.id);
    if (event.key === 'F2' && event.target === row) startRename(session.id);
  });
  return row;
}

// ── The sidebar's width ────────────────────────────────────────────────────
// Drag its right edge, or focus the edge and use the arrow keys (Shift for
// bigger steps, Home and End for the ends). A double-click goes back to the
// usual width. The width is kept on this computer; theme-boot.js applies it
// before the first paint. The conversation always keeps room to be read.
const SIDEBAR_WIDTH_KEY = 'cf.sidebar-width';
const SIDEBAR_DEFAULT = 272;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const MAIN_MIN = 560; // what the conversation and composer need beside it
let sidebarWidth = null; // px once chosen; null = the usual width

function sidebarMax() {
  const panel = $('agentsPanel');
  const panelWidth = (panel && !panel.hidden ? panel.getBoundingClientRect().width : 0) + terminalRightWidth();
  // A wide sidebar gives way to a small window, down to the usual width and
  // no further: below that the conversation is better off scrolling sideways
  // than the sidebar turning to slivers on its own.
  return Math.max(SIDEBAR_DEFAULT, Math.min(SIDEBAR_MAX, window.innerWidth - MAIN_MIN - panelWidth));
}

function applySidebarWidth(px) {
  const width = Math.round(Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, Number(px) || SIDEBAR_DEFAULT)));
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  const handle = $('sidebarResizer');
  if (handle) {
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
    handle.setAttribute('aria-valuemax', String(sidebarMax()));
  }
  return width;
}

function setSidebarWidth(px) {
  sidebarWidth = applySidebarWidth(px);
  try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)); } catch { /* this run only */ }
}

function resetSidebarWidth() {
  sidebarWidth = null;
  try { localStorage.removeItem(SIDEBAR_WIDTH_KEY); } catch { /* nothing kept */ }
  applySidebarWidth(SIDEBAR_DEFAULT);
}

const currentSidebarWidth = () => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width);

function wireSidebarResize() {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(saved) && saved > 0) sidebarWidth = saved;
  } catch { /* the usual width */ }
  applySidebarWidth(sidebarWidth ?? SIDEBAR_DEFAULT);
  const handle = $('sidebarResizer');
  if (!handle) return;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = currentSidebarWidth();
    document.body.classList.add('sidebar-resizing');
    const move = (e) => {
      e.preventDefault();
      applySidebarWidth(startWidth + (e.clientX - startX));
    };
    const up = () => {
      document.body.classList.remove('sidebar-resizing');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      setSidebarWidth(currentSidebarWidth());
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', resetSidebarWidth);
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 64 : 16;
    const now = currentSidebarWidth();
    const next = { ArrowLeft: now - step, ArrowRight: now + step, Home: SIDEBAR_MIN, End: SIDEBAR_MAX }[event.key];
    if (next == null) return;
    event.preventDefault();
    setSidebarWidth(next);
  });
  // A smaller window takes the sidebar down with it, and gives it back once
  // there is room again: the width chosen is kept, only what is shown changes.
  window.addEventListener('resize', () => applySidebarWidth(sidebarWidth ?? SIDEBAR_DEFAULT));
}

// ── Hiding the sidebar ─────────────────────────────────────────────────────
// The button beside the app's name, or Ctrl+B. While it is hidden, a button at
// the start of the top bar brings it back. Kept on this computer.
const SIDEBAR_HIDDEN_KEY = 'cf.sidebar-hidden';
let sidebarAnimation = null;

const sidebarHidden = () => document.documentElement.classList.contains('sidebar-hidden');

function setSidebarHidden(hidden) {
  const root = document.documentElement;
  if (hidden === sidebarHidden()) return;
  root.classList.add('sidebar-animating');
  clearTimeout(sidebarAnimation);
  sidebarAnimation = setTimeout(() => root.classList.remove('sidebar-animating'), 220);
  // Focus in the sidebar would be left on something nobody can see.
  if (hidden && document.activeElement && document.activeElement.closest('.sidebar')) $('prompt').focus();
  root.classList.toggle('sidebar-hidden', hidden);
  try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0'); } catch { /* this run only */ }
  if (!hidden) applySidebarWidth(sidebarWidth ?? SIDEBAR_DEFAULT);
  renderTopbar();
}

const toggleSidebar = () => setSidebarHidden(!sidebarHidden());

function sidebarOpenButton() {
  const button = el('button', 'icon-button sidebar-open');
  button.title = 'Show the sidebar (Ctrl+B)';
  button.setAttribute('aria-label', 'Show the sidebar');
  button.innerHTML = ICON.sidebar;
  button.addEventListener('click', () => setSidebarHidden(false));
  return button;
}

function wireSidebarToggle() {
  const button = $('sidebarToggle');
  button.innerHTML = ICON.sidebar;
  button.addEventListener('click', () => setSidebarHidden(true));
}

// ── Searching the sessions ─────────────────────────────────────────────────
// The box above the list. Enter opens the first match, the arrow keys walk the
// list, Esc clears the search. Ctrl+K puts the cursor in it.
let sessionQuery = '';

function wireSessionSearch() {
  const input = $('sessionSearch');
  if (!input) return;
  input.addEventListener('input', () => {
    sessionQuery = input.value;
    renderSidebar();
  });
  input.addEventListener('keydown', (event) => {
    const rows = () => [...document.querySelectorAll('#sessionList .session[data-id]')];
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (input.value) {
        input.value = '';
        sessionQuery = '';
        renderSidebar();
      } else {
        $('prompt').focus();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const first = rows()[0];
      if (first) selectSession(first.dataset.id);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const first = rows()[0];
      if (first) first.focus();
    }
  });
  // From the list, the arrows move between sessions and up past the first
  // one back into the box.
  $('sessionList').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const row = event.target.closest && event.target.closest('.session[data-id]');
    if (!row || event.target !== row) return;
    event.preventDefault();
    const rows = [...document.querySelectorAll('#sessionList .session[data-id]')];
    const at = rows.indexOf(row);
    const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (event.key === 'ArrowUp') input.focus();
  });
}

function focusSessionSearch() {
  const input = $('sessionSearch');
  if (!input) return;
  input.focus();
  input.select();
}

// ── Session actions ────────────────────────────────────────────────────────
let renaming = null; // the session being renamed in the sidebar

function openSessionMenu(session, anchor) {
  closeMenus();
  const menu = $('sessionMenu');
  const list = $('sessionMenuList');
  list.replaceChildren();
  const item = (iconName, label, run, danger = false) => {
    const button = el('button', `menu-item${danger ? ' danger' : ''}`);
    button.append(icon(iconName), el('span', 'mi-name', label));
    button.addEventListener('click', () => {
      closeMenus();
      run();
    });
    list.append(button);
  };
  item('edit', 'Rename', () => startRename(session.id));
  item('copy', 'Duplicate', () => duplicateSession(session.id));
  item('pin', session.pinned ? 'Unpin' : 'Pin', () => pinSession(session.id, !session.pinned));
  item('download', 'Export as Markdown', () => exportSession(session));
  list.append(el('div', 'menu-sep'));
  item('trash', 'Delete', () => confirmDelete(session), true);
  menu.dataset.id = session.id;
  menu.hidden = false;
  const box = anchor.getBoundingClientRect();
  const height = menu.offsetHeight;
  const below = box.bottom + 4 + height < window.innerHeight - 8;
  menu.style.top = `${below ? box.bottom + 4 : Math.max(8, box.top - height - 4)}px`;
  menu.style.left = `${Math.max(8, box.right - menu.offsetWidth)}px`;
  anchor.classList.add('open');
  anchor.closest('.session').classList.add('menu-open');
}

function startRename(id) {
  renaming = id;
  renderSidebar();
}

async function finishRename(id, value, save) {
  renaming = null;
  const session = S.sessions.find((s) => s.id === id);
  const title = String(value || '').trim().slice(0, 200);
  if (save && session && title && title !== sessionLabel(session)) {
    const before = session.title;
    session.title = title;
    try {
      const data = await call(cf.renameSession, { sessionId: id, title });
      session.title = data.title || title;
    } catch (err) {
      session.title = before;
      showBanner(`The session could not be renamed: ${err.message}`);
    }
  }
  renderSidebar();
  if (S.current === id) renderTopbar();
}

async function pinSession(id, pinned) {
  const session = S.sessions.find((s) => s.id === id);
  if (!session) return;
  session.pinned = pinned;
  renderSidebar();
  try {
    await call(cf.pinSession, { sessionId: id, pinned });
  } catch (err) {
    session.pinned = !pinned;
    renderSidebar();
    showBanner(`The session could not be ${pinned ? 'pinned' : 'unpinned'}: ${err.message}`);
  }
}

async function duplicateSession(id) {
  try {
    const copy = await call(cf.duplicateSession, id);
    const source = local(id);
    S.init.state.sessions[copy.id] = { cwd: source.cwd || null, model: source.model, label: copy.title || '' };
    S.sessions = [copy, ...S.sessions];
    await selectSession(copy.id);
    loadSessions({ quiet: true });
  } catch (err) {
    showBanner(`The session could not be duplicated: ${err.message}`);
  }
}

// A short line under the composer that says something worked, then goes.
let hintTimer = null;
function flashHint(text, ms = 4000) {
  const hint = $('hint');
  if (!hint) return;
  hint.textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (hint.textContent === text) hint.textContent = S.current && S.running.has(S.current) ? 'Enter to steer' : '';
  }, ms);
}

// The whole conversation as a Markdown file, in a place the user picks. A
// session not opened yet is read from the server first.
async function exportSession(session) {
  let items;
  try {
    if (S.loaded.has(session.id) && !loadFailures.has(session.id)) {
      items = transcriptOf(session.id);
    } else {
      const data = await call(cf.messages, session.id);
      items = fromHistory(session.id, data.messages || [], data.compactions || []);
    }
  } catch (err) {
    showBanner(`The session could not be read to export it: ${err.message}`);
    return;
  }
  const title = sessionLabel(session);
  const folder = session.executor === 'client' ? local(session.id).cwd : 'Cloud sandbox';
  const text = CF_SESSION_TOOLS.transcriptMarkdown({
    title,
    folder,
    exportedAt: new Date().toLocaleString(),
    items: items.map((item) => (item.type === 'footer' ? { ...item, modelName: modelLabel(item.model) } : item)),
  });
  try {
    const saved = await call(cf.saveText, { name: CF_SESSION_TOOLS.exportFileName(title), text });
    if (saved) flashHint(`Exported to ${saved}`, 6000);
  } catch (err) {
    showBanner(`The session could not be exported: ${err.message}`);
  }
}

async function confirmDelete(session) {
  const where = session.executor === 'client'
    ? 'Files in your folder are not touched.'
    : 'Its cloud sandbox is stopped and its files are deleted.';
  const ok = await confirmDialog({
    title: 'Delete this session?',
    text: `"${sessionLabel(session)}" and its conversation are deleted for good, here and on codingfleet.com. ${where}`,
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await call(cf.deleteSession, session.id);
  } catch (err) {
    showBanner(`The session could not be deleted: ${err.message}`);
    return;
  }
  S.sessions = S.sessions.filter((s) => s.id !== session.id);
  S.transcripts.delete(session.id);
  S.loaded.delete(session.id);
  S.agents.delete(session.id);
  delete S.init.state.sessions[session.id];
  forgetDraft(session.id);
  if (S.current === session.id) newSession();
  renderSidebar();
}

// A small yes/no dialog. Resolves true only on the confirm button.
function confirmDialog({ title, text, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay confirm-overlay');
    const modal = el('div', 'modal confirm-modal');
    modal.setAttribute('role', 'alertdialog');
    const cancel = el('button', 'btn', 'Cancel');
    const ok = el('button', `btn ${danger ? 'danger-solid' : 'primary'}`, confirm);
    const actions = el('div', 'modal-actions');
    actions.append(el('div', 'bar-spacer'), cancel, ok);
    modal.append(el('h2', 'confirm-title', title), el('p', 'confirm-text', text), actions);
    overlay.append(modal);
    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(false); });
    document.body.append(overlay);
    setTimeout(() => cancel.focus(), 0);
  });
}

function renderAccount() {
  const box = $('account');
  box.replaceChildren();
  const row = (label, value) => {
    const r = el('div', 'account-row');
    r.append(el('span', null, label), el('strong', null, value));
    return r;
  };
  if (!S.settings.hasKey) {
    const add = el('button', 'btn primary wide', 'Add your API key');
    add.addEventListener('click', () => openSettings(true));
    box.append(add);
  } else if (!S.credits) {
    box.append(el('div', 'account-row', S.creditsError || 'Loading your account…'));
  } else {
    box.append(renderQuota(S.credits));
    const session = currentSession();
    const context = session && session.context;
    if (context && context.limit) {
      const line = row('Context', `${fmtCompact(context.tokens)} / ${fmtCompact(context.limit)}`);
      line.title = "How much of your plan's context limit this session's conversation takes. "
        + 'Near the limit, older messages are summarized automatically.';
      line.classList.add('context-row');
      line.querySelector('span').after(compactButton(session));
      box.append(line);
    }
  }
  const foot = el('div', 'account-foot');
  foot.append(accountWho());
  const gear = el('button', 'icon-button');
  gear.title = 'Settings';
  gear.innerHTML = ICON.gear;
  gear.addEventListener('click', () => openSettings(false));
  foot.append(gear);
  box.append(foot);
}

// Who the app is signed in as, next to the gear: the one thing in the footer
// worth reading at a glance. It opens the account page; the server address is
// only shown when it is not the default one, since then it is news.
function accountWho() {
  const account = (S.credits && S.credits.account) || {};
  const name = account.username || account.email;
  const version = S.init && S.init.version ? `CodingFleet ${S.init.version}` : 'CodingFleet';
  const custom = S.settings.apiBase !== S.settings.defaultApiBase
    ? S.settings.apiBase.replace(/^https?:\/\//, '') : '';
  // Signed out, the button above already says what to do; the app's version
  // is all that is left to say.
  if (!S.settings.hasKey) return el('span', 'account-version', version);
  const who = el('button', 'account-who');
  const label = name || (S.creditsError ? 'Account unavailable' : version);
  who.append(el('span', 'account-avatar', (name || 'C').charAt(0).toUpperCase()),
    el('span', 'account-name', custom ? `${label} · ${custom}` : label));
  who.title = [
    name && `Signed in as ${account.username && account.email ? `${account.username} (${account.email})` : name}`,
    custom && `Server: ${S.settings.apiBase}`,
    version,
    'Open your account on codingfleet.com',
  ].filter(Boolean).join('\n');
  who.addEventListener('click', () => window.open(`${originOf(S.settings.apiBase)}/account/`));
  return who;
}

// The quota card: a bar of what is left, and the numbers behind it on hover or
// click. Plans with a weekly allowance show how much of it is left; a
// credits-only account has no ceiling to measure against, so it shows its
// balance instead.
let quotaOpen = false;

function quotaLevel(pct, backed = false) {
  if (pct >= 50) return 'good';
  // With credits behind the allowance, running the weekly down is a warning,
  // not a wall. Red is kept for the case where there is nothing left to spend.
  if (pct >= 20 || backed) return 'low';
  return 'out';
}

function renderQuota(credits) {
  const plan = credits.plan || {};
  const total = Number(credits.weekly_total) || 0;
  const left = Math.max(0, Number(credits.weekly_remaining) || 0);
  const hasAllowance = total > 0 && credits.weekly_remaining != null;
  const pct = hasAllowance ? Math.max(0, Math.min(100, Math.round((left / total) * 100))) : null;

  const balance = Number(credits.credits) || 0;
  // The weekly allowance is spent, but the balance is not: runs carry on, paid
  // by credits. The card says so in green rather than shouting 0% in red.
  const onCredits = hasAllowance && balance > 0 && left <= 0;
  const level = quotaLevel(pct, balance > 0);

  const wrap = el('div', `quota${quotaOpen ? ' open' : ''}`);
  // The bar of what is left. A zero-width fill would still paint its glow as a
  // stray mark at the left end of an empty track, so nothing is drawn at all.
  const meterFor = (percent, cls) => {
    const bar = el('div', 'quota-bar');
    if (percent > 0) {
      const fill = el('div', `quota-fill ${cls}`);
      fill.style.width = `${percent}%`;
      bar.append(fill);
    }
    return bar;
  };
  const card = el('button', 'quota-card');
  card.setAttribute('aria-expanded', String(quotaOpen));
  const head = el('div', 'quota-head');
  const status = el('span', 'quota-pct');
  if (!hasAllowance) {
    status.textContent = `${fmtNum(credits.credits)} credits`;
  } else if (onCredits) {
    status.classList.add('credits');
    status.textContent = 'On credits';
    status.title = `Your weekly allowance is used up. Runs now spend your ${fmtNum(balance)} credits, which never expire.`;
  } else {
    status.classList.add(level);
    status.textContent = `${pct}%`;
  }
  head.append(el('span', 'quota-plan', plan.name || 'Your plan'), status);
  card.append(head);
  if (hasAllowance) {
    // Running out of the allowance is not running out of credits: say what is
    // left to spend, right on the card, while the bar is low or spent.
    const sub = el('div', 'quota-sub');
    if (onCredits) {
      sub.append(
        el('span', 'quota-then', `${fmtNum(balance)} credits left`),
        el('span', null, 'Resets Monday'),
      );
    } else {
      const lowOnAllowance = balance > 0 && pct < 25;
      sub.append(el('span', 'quota-left', lowOnAllowance
        ? `${fmtNum(left)} of ${fmtNum(total)} weekly`
        : `${fmtNum(left)} of ${fmtNum(total)} weekly allowance left`));
      if (lowOnAllowance) sub.append(el('span', 'quota-then', `then ${fmtNum(balance)} credits`));
    }
    card.append(meterFor(pct, onCredits ? 'credits' : level), sub);
  } else {
    card.append(el('div', 'quota-sub', 'Credits never expire'));
  }
  card.addEventListener('click', (event) => {
    event.stopPropagation();
    quotaOpen = !quotaOpen;
    wrap.classList.toggle('open', quotaOpen);
    card.setAttribute('aria-expanded', String(quotaOpen));
  });

  const pop = el('div', 'quota-pop');
  const line = (label, value, cls) => {
    const r = el('div', `qp-row${cls ? ` ${cls}` : ''}`);
    r.append(el('span', null, label), el('strong', null, value));
    return r;
  };
  pop.append(el('div', 'qp-title', plan.name ? `${plan.name} plan` : 'Your account'));
  if (hasAllowance) {
    pop.append(line('Weekly allowance', `${fmtNum(left)} / ${fmtNum(total)}`));
    pop.append(meterFor(pct, onCredits ? 'credits' : level));
  }
  pop.append(line('Credits', fmtNum(credits.credits)));
  if (credits.quota_remaining != null && hasAllowance) {
    pop.append(line('You can spend', fmtNum(credits.quota_remaining), 'total'));
  }
  pop.append(el('div', 'qp-note', hasAllowance
    ? 'Runs use the weekly allowance first, then credits. The allowance resets every Monday.'
    : 'Runs use your credits.'));

  const urls = plan.urls || {};
  const origin = originOf(S.settings.apiBase);
  const actions = el('div', 'account-actions');
  const openLink = (label, url, title, primary) => {
    const button = el('button', `btn small${primary ? ' primary' : ''}`, label);
    button.title = title;
    button.addEventListener('click', () => window.open(url));
    return button;
  };
  actions.append(
    openLink('Plans', urls.plans || `${origin}/pricing/`, 'Upgrade or change your plan on codingfleet.com', true),
    openLink('Buy credits', creditsUrl(urls), 'Buy a credit pack on codingfleet.com'),
    openLink('Billing', urls.billing || `${origin}/billing/`, 'Invoices and payment method'),
  );
  pop.append(actions);
  wrap.append(pop, card);
  return wrap;
}

// The credit packs, further down the pricing page.
function creditsUrl(urls) {
  return (urls && urls.credits && urls.credits.includes('#'))
    ? urls.credits : `${originOf(S.settings.apiBase)}/pricing/#one-time-purchase`;
}

// ── Header ─────────────────────────────────────────────────────────────────
function renderTopbar() {
  const bar = $('topbar');
  bar.replaceChildren();
  const session = currentSession();
  if (sidebarHidden()) bar.append(sidebarOpenButton());
  bar.append(el('div', 'top-title', session ? sessionLabel(session) : S.current ? 'Session' : 'New session'));

  const cwd = session ? local(session.id).cwd : S.draftCwd;
  if (cwd) {
    const chip = el('button', 'chip');
    chip.title = `${cwd}\nOpen in File Explorer`;
    chip.append(icon('folder'), el('span', null, baseName(cwd)));
    chip.addEventListener('click', () => cf.openFolder(cwd));
    bar.append(chip);
  }
  // What this session has cost so far: the runs' footers, added up.
  if (session && S.loaded.has(session.id)) {
    const spend = CF_SESSION_TOOLS.sessionSpend(transcriptOf(session.id));
    if (spend.runs) {
      const cost = el('span', 'chip cost-chip');
      cost.append(icon('coins'), el('span', null, `${fmtNum(spend.credits)} ${spend.credits === 1 ? 'credit' : 'credits'}`));
      cost.title = `This session has cost ${fmtNum(spend.credits)} credits over ${spend.runs} `
        + `run${spend.runs === 1 ? '' : 's'}. Runs your plan covers count as 0.`;
      bar.append(cost);
    }
  }
  bar.append(el('div', 'top-spacer'));

  if (session && (S.running.has(session.id) || S.remoteBusy.has(session.id))) {
    const status = el('div', 'status');
    status.append(el('span', 'dot running'), el('span', null, 'Working'));
    bar.append(status);
  }
  bar.append(terminalToggleButton());
}
