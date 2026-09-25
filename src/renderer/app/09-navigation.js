'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Opening sessions, the turns this window drew itself, and the menus.

// ── Navigation ─────────────────────────────────────────────────────────────
// A new session in a folder the sidebar already knows. Same as New session,
// except the folder is chosen for us instead of being asked for.
function newSessionIn(cwd) {
  S.draftSandbox = false;
  S.draftCwd = cwd;
  S.init.state.lastCwd = cwd;
  cf.setState({ lastCwd: cwd });
  newSession();
}

function newSession() {
  closeMenus();
  hideBanner();
  if (S.current !== null) discardAttachments();
  S.current = null;
  restoreDraft();
  S.model = S.init.state.model || 'auto';
  S.panel.open = false;
  renderPanel();
  renderSidebar();
  renderAccount();
  renderMain();
  $('prompt').focus();
}

const showsAsImage = (file) => file.kind === 'image' && !file.deleted && Boolean(file.preview || file.fileId);

// A sent image: its preview, fetched again for a reopened session; click to see it whole.
function imageCard(file) {
  const img = el('img', 'msg-image');
  img.alt = file.name || 'Image';
  img.title = file.name || '';
  img.decoding = 'async';
  img.addEventListener('load', () => img.classList.add('ready'), { once: true });
  img.addEventListener('click', () => openViewer({ src: img.src, fileId: file.fileId, name: file.name }));
  const preview = file.preview || S.images.get(file.fileId);
  if (preview) {
    img.src = preview;
  } else {
    img.classList.add('pending');
    call(cf.image, { fileId: file.fileId }).then((src) => {
      S.images.set(file.fileId, src);
      file.preview = src;
      img.src = src;
    }, () => {
      img.replaceWith(attachmentChip({ ...file, status: 'ready' }, { removable: false }));
    }).finally(() => img.classList.remove('pending'));
  }
  return img;
}

// The whole image over the app. Esc, or a click anywhere, closes it.
// `full` is a promise of a larger copy, shown as soon as it arrives.
function openViewer({ src, fileId, name, full }) {
  if (!src && !fileId && !full) return;
  closeViewer();
  const overlay = el('div', 'viewer');
  overlay.id = 'viewer';
  const img = el('img', 'viewer-image');
  img.alt = name || 'Image';
  img.addEventListener('load', () => img.classList.add('ready'));
  if (src) img.src = src;
  overlay.append(img);
  if (name) overlay.append(el('div', 'viewer-name', name));
  overlay.addEventListener('click', closeViewer);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const larger = fileId ? call(cf.image, { fileId, full: true }) : full;
  if (larger) {
    Promise.resolve(larger).then((url) => {
      if (url && overlay.isConnected) img.src = url;
    }, () => {});
  }
}

function closeViewer() {
  const overlay = document.getElementById('viewer');
  if (overlay) overlay.remove();
}

// ── The turns this window drew itself ──────────────────────────────────────
// A transcript rebuilt from history places each tool where its run said it
// went (`text_offset`). A run that left no marks, or whose calls did not line
// up with them, comes back as one group at the top of the turn with the answer
// hanging below it -- nothing like the run that happened. What this window drew
// from the events is where things really were, so a rebuild keeps it.
const ownTurns = new Map(); // session id -> { text, items }

const normalized = (text) => String(text || '').replace(/\s+/g, ' ').trim();

// The end of an answer is what names its turn: the beginning is often a stock
// line ("Now let me..."), the middle loses the chip markup the server cuts out,
// so a whole-text comparison would refuse turns that are plainly the same.
function sameAnswer(mine, theirs) {
  const a = normalized(mine);
  const b = normalized(theirs);
  if (!a || !b) return false;
  const tail = Math.min(120, a.length, b.length);
  return a.slice(-tail) === b.slice(-tail);
}

// Where the last turn of a rebuilt transcript begins: after its prompt.
function lastTurnStart(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'user') return i + 1;
  }
  return null;
}

// A session's transcript from the server's history, with the newest turn kept
// as this window drew it when that turn is one it streamed itself.
function rebuiltTranscript(sessionId, data) {
  const messages = data.messages || [];
  const items = fromHistory(sessionId, messages, data.compactions || []);
  const own = ownTurns.get(sessionId);
  const last = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!own || !last || !sameAnswer(own.text, last.text)) {
    // The newest turn is one from somewhere else, so ours is history now and
    // is read the way every other past turn is.
    ownTurns.delete(sessionId);
    return items;
  }
  const start = lastTurnStart(items);
  if (start == null) return items;
  // A compaction belongs to a turn's window rather than to the turn's own
  // items, so it is kept even though the rest of the flat copy is dropped.
  const compactions = items.slice(start).filter((item) => item.type === 'compaction'
    && !own.items.some((mine) => mine.type === 'compaction' && mine.at === item.at));
  return [...items.slice(0, start), ...compactions, ...own.items];
}

function fromHistory(sessionId, messages, compactions = []) {
  const items = [];
  // A compaction goes before the first message that came after it: an
  // automatic one lands between the prompt and the answer it made room for.
  const pending = [...compactions].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const flushCompactions = (until) => {
    while (pending.length && (!until || Date.parse(pending[0].at) <= Date.parse(until))) {
      const c = pending.shift();
      items.push({ type: 'compaction', before: c.before_tokens, after: c.after_tokens, manual: c.manual, at: c.at });
    }
  };
  for (const message of messages) {
    if (message.created_at) flushCompactions(message.created_at);
    const firstItem = items.length;
    if (message.role === 'user') {
      const { text, refs } = splitReferences(message.text);
      items.push({
        type: 'user', text, at: message.created_at,
        files: [...refs, ...(message.files || []).map((file) => ({
          name: file.filename || file.id, size: file.size, kind: file.kind, deleted: file.deleted,
          fileId: file.id, preview: S.images.get(file.id) || null,
        }))],
      });
      for (const steer of message.steers || []) {
        const parts = splitReferences(String(steer));
        items.push({ type: 'user', text: parts.text, files: parts.refs, steer: true });
      }
      if (message.checkpoint_id) {
        for (const item of items.slice(firstItem)) item.checkpointId = message.checkpoint_id;
      }
      continue;
    }
    if (message.created_at) items.push({ type: 'stamp', at: message.created_at });
    // Tools sit between the paragraphs they came between (text_offset); tools
    // called together, with no text between them, share one group. An older
    // turn has no offsets: its tools come first, in one group.
    const text = message.text || '';
    let cursor = 0;
    let group = null;
    const pushText = (upTo) => {
      const chunk = text.slice(cursor, upTo).trim();
      cursor = upTo;
      if (!chunk) return;
      items.push({ type: 'assistant', text: chunk });
      group = null;
    };
    for (const tool of message.tools || []) {
      const at = Number.isInteger(tool.text_offset) ? Math.min(tool.text_offset, text.length) : cursor;
      if (at > cursor) pushText(at);
      if (!group) {
        group = { type: 'tools', sessionId, tools: [], open: false, history: true };
        items.push(group);
      }
      const entry = {
        id: null, group, name: tool.name, arguments: tool.arguments || {},
        status: tool.state === 'called' ? 'cancelled' : tool.ok ? 'done' : 'failed', history: true,
      };
      if (tool.subagent && tool.subagent.id) {
        entry.agentId = tool.subagent.id;
        const known = agentsOf(sessionId).get(tool.subagent.id);
        if (!known || !known.items.length) {
          ensureAgent(sessionId, tool.subagent.id, {
            role: tool.subagent.role || 'Sub-agent', model: tool.subagent.model || null,
            task: (tool.arguments && tool.arguments.task) || '', credits: tool.subagent.credits,
            summary: tool.subagent.summary || '', status: tool.subagent.error ? 'failed' : 'done',
            loaded: false,
          });
        }
      }
      group.tools.push(entry);
    }
    pushText(text.length);
    if (message.partial) {
      items.push({ type: 'notice', text: message.interrupted
        ? 'This run stopped before finishing. Its partial work is saved; you can continue here.'
        : 'This run is still in progress. Its partial work is saved.' });
    }
    if (message.model || message.usage) {
      items.push({ type: 'footer', model: message.model, usage: message.usage || null });
    }
    if (message.checkpoint_id) {
      for (const item of items.slice(firstItem)) item.checkpointId = message.checkpoint_id;
    }
  }
  flushCompactions(null);
  return items;
}

async function selectSession(id) {
  closeMenus();
  hideBanner();
  if (S.current !== id) discardAttachments();
  S.current = id;
  loadBackground(id);
  restoreDraft();
  S.model = sessionModel(currentSession()) || newSessionModel();
  S.panel.open = false;
  renderPanel();
  renderSidebar();
  renderAccount();
  renderMain();
  $('prompt').focus();
  if (S.loaded.has(id) || S.loading.has(id)) return;
  S.loading.add(id);
  await loadSessionHistory(id);
}

// A session whose history could not be read, and when it is tried again.
const loadFailures = new Map(); // session id -> { message, attempts, next }

async function loadSessionHistory(id) {
  S.loading.add(id);
  const pending = transcriptOf(id).filter((item) => item.type !== 'load-error');
  let failed = null;
  try {
    const data = await call(cf.messages, id);
    S.transcripts.set(id, [...rebuiltTranscript(id, data), ...pending]);
    const known = S.sessions.find((x) => x.id === id);
    S.seenAnswer.set(id, (known && known.last_message_at) || null);
    S.loaded.add(id);
    loadFailures.delete(id);
  } catch (err) {
    failed = err;
  } finally {
    S.loading.delete(id);
  }
  if (failed) {
    const before = loadFailures.get(id);
    const attempts = before ? before.attempts + 1 : 1;
    // A lost connection or a busy server passes: try again, more slowly each
    // time. Anything else (a deleted session, a refused key) is final.
    const retry = failed.transient || failed.status === 0 || failed.status == null;
    const wait = Math.min(30, 5 * 2 ** (attempts - 1));
    loadFailures.set(id, { message: failed.message, attempts, next: retry ? Date.now() + wait * 1000 : null });
    S.transcripts.set(id, [{ type: 'load-error', sessionId: id }, ...pending]);
    if (!retry) S.loaded.add(id);
  }
  if (S.current === id) renderMain();
  renderSidebar();
  if (!failed) checkCurrentSession();
}

// Called every second while a failed session is open: the countdown, then the retry.
function tickLoadRetry() {
  const failure = S.current && loadFailures.get(S.current);
  if (!failure || failure.next == null || S.loading.has(S.current)) return;
  if (Date.now() >= failure.next) {
    loadSessionHistory(S.current);
    return;
  }
  const label = document.querySelector('.load-error .retry-in');
  if (label) label.textContent = retryText(failure);
}

function retryText(failure) {
  if (failure.next == null) return '';
  const seconds = Math.max(0, Math.ceil((failure.next - Date.now()) / 1000));
  return seconds ? `Trying again in ${seconds}s` : 'Trying again…';
}

function retryNow(id) {
  const failure = loadFailures.get(id);
  if (failure) failure.next = Date.now();
  if (!S.loading.has(id)) loadSessionHistory(id);
  const label = document.querySelector('.load-error .retry-in');
  if (label) label.textContent = 'Trying again…';
}

// ── Menus ──────────────────────────────────────────────────────────────────
function closeMenus() {
  $('sessionMenu').hidden = true;
  for (const menu of document.querySelectorAll('.pref-menu')) menu.hidden = true;
  for (const open of document.querySelectorAll('.session-more.open')) open.classList.remove('open');
  for (const open of document.querySelectorAll('.session.menu-open')) open.classList.remove('menu-open');
  $('attachMenu').hidden = true;
  $('folderMenu').hidden = true;
  $('modelMenu').hidden = true;
  $('effortMenu').hidden = true;
  $('permMenu').hidden = true;
  $('changesMenu').hidden = true;
}

// Where a new session runs: a folder on this computer, or a cloud sandbox.
// A session that exists keeps what it was created with, so this only offers to
// open the folder then.
function openFolderMenu() {
  closeMenus();
  const session = currentSession();
  const menu = $('folderMenu');
  menu.style.left = `${$('folderButton').offsetLeft}px`;
  const list = $('folderList');
  list.replaceChildren();

  const option = (iconName, name, sub, selected, run) => {
    const row = el('button', `menu-item${selected ? ' selected' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
    row.append(icon(iconName), main);
    row.addEventListener('click', () => {
      closeMenus();
      run();
    });
    return row;
  };

  if (session) {
    const cwd = local(session.id).cwd;
    list.append(el('div', 'menu-group', 'This session'));
    list.append(option(
      session.executor === 'client' ? 'folder' : 'sparkle',
      session.executor === 'client' ? (cwd ? baseName(cwd) : 'Another computer') : 'Cloud sandbox',
      session.executor === 'client'
        ? (cwd || 'This session was started on another computer')
        : "Tools run on CodingFleet's servers",
      true,
      () => { if (cwd) cf.openFolder(cwd); },
    ));
    list.append(el('div', 'menu-group', 'New session'));
  }

  const sandbox = !session && S.draftSandbox;
  list.append(option('sparkle', 'Cloud sandbox', "Runs on CodingFleet's servers. Nothing here is read or changed.",
    sandbox, () => {
      S.draftSandbox = true;
      S.draftCwd = null;
      if (session) newSession();
      else renderMain();
    }));
  const folder = !session && !S.draftSandbox && S.draftCwd;
  list.append(option('folder', S.draftCwd && !session ? baseName(S.draftCwd) : 'A folder on this computer',
    S.draftCwd && !session ? S.draftCwd : 'CodingFleet reads, edits and runs code inside it',
    Boolean(folder), async () => {
      if (session) newSession();
      S.draftSandbox = false;
      await pickFolder();
    }));
  if (S.init.state.lastCwd && S.init.state.lastCwd !== S.draftCwd) {
    list.append(option('folder', baseName(S.init.state.lastCwd), S.init.state.lastCwd, false, () => {
      if (session) newSession();
      S.draftSandbox = false;
      S.draftCwd = S.init.state.lastCwd;
      renderMain();
    }));
  }
  menu.hidden = false;
}

function openModelMenu() {
  closeMenus();
  ensureModels();
  const menu = $('modelMenu');
  menu.style.left = `${$('modelButton').offsetLeft}px`;
  menu.hidden = false;
  $('modelSearch').value = '';
  renderModelList('');
  $('modelSearch').focus();
  const selected = menu.querySelector('.menu-item.selected');
  if (selected) selected.scrollIntoView({ block: 'center' });
}

// Vision, intelligence and price, each in its own fixed column so every row
// of a picker lines up; an empty cell keeps its place.
function modelColumns(vision, iq, price) {
  const cols = el('span', 'model-cols');
  const eyeCell = el('span', 'mc-vision');
  if (vision) {
    eyeCell.append(icon('eye', 'icon model-vision'));
    eyeCell.title = 'Vision: this model can read images you attach';
  }
  const iqCell = el('span', 'mc-iq');
  if (iq) {
    const pill = el('span', 'pill iq', String(iq));
    pill.title = `Intelligence Index: ${iq}/100 (higher is smarter)`;
    iqCell.append(pill);
  }
  const priceCell = el('span', 'mc-price');
  if (price) {
    const { text, cls, title } = typeof price === 'string' ? { text: price } : price;
    const pill = el('span', `pill${cls ? ` ${cls}` : ''}`, text);
    pill.title = title || 'Credits per 20k tokens';
    priceCell.append(pill);
  }
  cols.append(eyeCell, iqCell, priceCell);
  return cols;
}

// The account's plan covers this model: it costs no credits here.
// The server prices by the KEY, not by the app: a desktop key (browser
// sign-in) gets the plan's unlimited models for no credits, a key made for
// code pays for every model even here. An older server that does not say
// which kind of key this is keeps the old answer.
function desktopPriced() {
  const client = S.credits && S.credits.key && S.credits.key.client;
  return !client || client === 'desktop';
}

// A key for code on a plan with unlimited models: those models cost credits
// in this app until it signs in again through the browser.
function paysWithThisKey() {
  return Boolean(S.credits && S.credits.plan && S.credits.plan.unlimited_models && !desktopPriced());
}

function planIncludes(variant) {
  return Boolean(variant && variant.unlimited && S.credits && S.credits.plan && S.credits.plan.unlimited_models
    && desktopPriced());
}

function includedPill() {
  const plan = (S.credits && S.credits.plan && S.credits.plan.name) || 'your';
  return {
    text: 'Unlimited',
    cls: 'unl',
    title: `Included in your ${plan} plan: no credits in this app and on the web (fair use applies).`,
  };
}

function priceLabel(variants) {
  if (variants.length && variants.every(planIncludes)) return includedPill();
  return creditRange(variants);
}

function creditRange(variants) {
  const costs = variants.map((v) => v.credits_per_20k_tokens).filter((c) => c != null);
  if (!costs.length) return null;
  const low = Math.min(...costs);
  const high = Math.max(...costs);
  return low === high ? `${fmtNum(low)} cr` : `${fmtNum(low)}–${fmtNum(high)} cr`;
}

// The session picker's list. A picker other than the composer's passes its own
// list element, selected model and choice handler.
const composerPicker = () => ({ list: $('modelList'), selected: S.model, choose: chooseModel });

function renderModelList(query, picker = composerPicker()) {
  const list = picker.list;
  list.replaceChildren();
  const q = query.trim().toLowerCase();
  const matches = (...parts) => !q || parts.some((p) => p && String(p).toLowerCase().includes(q));
  let shown = 0;

  const row = (id, name, sub, selected, extra = []) => {
    const button = el('button', `menu-item${selected ? ' selected' : ''}${shown === 0 && q ? ' focus' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
    button.append(main, ...extra);
    button.addEventListener('click', () => picker.choose(id));
    shown++;
    return button;
  };

  if (matches('auto', 'auto select')) {
    list.append(row('auto', 'Auto', 'Picks a model for each message', picker.selected === 'auto'));
  }

  let provider;
  for (const entry of modelEntries()) {
    const providerName = entry.provider ? entry.provider.name : null;
    if (!matches(entry.name, providerName, ...entry.variants.map((v) => v.name), ...entry.variants.map((v) => v.id))) continue;
    if (providerName !== provider) {
      provider = providerName;
      const header = el('div', 'menu-group');
      if (entry.provider) header.append(providerLogo(entry.provider));
      header.append(el('span', null, providerName || 'Other models'));
      list.append(header);
    }
    const selected = entry.variants.some((v) => v.id === picker.selected);
    const lead = entry.variants.find((v) => v.id === entry.defaultId) || entry.variants[0];
    const pills = [modelColumns(
      entry.variants.some((v) => v.supports_vision),
      Math.max(0, ...entry.variants.map((v) => v.intelligence_index || 0)),
      priceLabel(entry.variants),
    )];
    const sub = entry.variants.length > 1
      ? entry.variants.map((v) => (v.effort ? v.effort.label : v.name)).join(' · ')
      : lead.id;
    list.append(row(selected ? picker.selected : lead.id, entry.name, sub, selected, pills));
  }
  if (!shown) {
    list.append(el('div', 'menu-empty', S.models.length ? 'No model matches.' : S.modelsError || 'Loading models…'));
  }
}

function openEffortMenu() {
  closeMenus();
  const entry = entryOf(S.model);
  if (!entry || entry.variants.length < 2) return;
  const menu = $('effortMenu');
  menu.style.left = `${$('effortButton').offsetLeft}px`;
  fillEffortList($('effortList'), S.model, chooseModel);
  menu.hidden = false;
}

function fillEffortList(list, selectedId, choose) {
  const entry = entryOf(selectedId);
  list.replaceChildren(el('div', 'menu-group', `${entry.name} · thinking effort`));
  for (const variant of entry.variants) {
    const button = el('button', `menu-item${variant.id === selectedId ? ' selected' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', variant.effort ? variant.effort.label : variant.name), el('div', 'mi-sub', variant.name));
    button.append(main);
    button.append(modelColumns(
      variant.supports_vision,
      variant.intelligence_index || 0,
      planIncludes(variant) ? includedPill()
        : variant.credits_per_20k_tokens != null ? `${fmtNum(variant.credits_per_20k_tokens)} cr` : null,
    ));
    button.addEventListener('click', () => choose(variant.id));
    list.append(button);
  }
}

// The composer's model and effort buttons, for any model id.
function modelButtonParts(id) {
  const selected = findModel(id);
  return [
    (selected && providerLogo(selected.provider, 'plogo small')) || icon(id === 'auto' ? 'sparkle' : 'model'),
    el('span', null, modelName(id)),
    icon('caret', 'icon caret'),
  ];
}

function effortButtonParts(id) {
  const entry = id === 'auto' ? null : entryOf(id);
  if (!entry || entry.variants.length < 2) return null;
  const variant = entry.variants.find((v) => v.id === id);
  return [icon('gauge'), el('span', null, (variant && variant.effort && variant.effort.label) || 'Effort'),
    icon('caret', 'icon caret')];
}

function chooseModel(id) {
  S.model = id;
  // The choice is this session's own. New sessions start on the default model
  // from Settings, Preferences.
  if (S.current) {
    S.init.state.sessions[S.current] = { ...local(S.current), model: id };
    cf.setSessionModel({ sessionId: S.current, model: id });
  }
  closeMenus();
  renderComposer();
  $('prompt').focus();
}

function openPermMenu() {
  closeMenus();
  const menu = $('permMenu');
  menu.style.left = `${$('permButton').offsetLeft}px`;
  const list = $('permList');
  list.replaceChildren();
  const options = [
    ['ask', 'shield', 'Ask before changes', 'Reads inside the project folder run at once. Commands and file changes wait for you.'],
    ['auto', 'bolt', 'Auto-approve', 'Every tool call runs without asking. Use it only in folders you trust.'],
  ];
  for (const [value, iconName, name, sub] of options) {
    const row = el('button', `menu-item${S.permission === value ? ' selected' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
    row.append(icon(iconName), main);
    row.addEventListener('click', () => {
      S.permission = value;
      cf.setState({ permissionMode: value });
      closeMenus();
      renderComposer();
    });
    list.append(row);
  }
  menu.hidden = false;
}
