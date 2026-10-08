'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. @ mentions: typing @ in the composer offers
// the files and folders of the session's folder.
//
// The parsing and the ranking live in lib/mention.js, where they are tested.
// The list of files comes from the main process (core/file-index.js): names
// only, from git when the folder is a repository. A mention stays in the
// message as "@path", which the agent reads with its own file tools.

const MENTION_LIMIT = 8;
const MENTION_INDEX_TTL_MS = 15_000;
const M = {
  open: false,
  mention: null,     // { start, end, query, quoted } where the caret is
  items: [],         // entries shown
  selected: 0,
  index: null,       // { cwd, entries, at, truncated }
  loading: null,     // the promise of the index being read
  error: null,
};

// Where mentions come from: the folder of a session that works on this
// computer, or the folder a new session is about to start in.
function mentionTarget() {
  const session = currentSession();
  if (session) {
    if (session.executor !== 'client') return null;
    const cwd = local(session.id).cwd;
    return cwd ? { sessionId: session.id, cwd } : null;
  }
  if (S.draftSandbox || !S.draftCwd) return null;
  return { sessionId: null, cwd: S.draftCwd };
}

function mentionIndex(target) {
  const fresh = M.index && M.index.cwd === target.cwd && Date.now() - M.index.at < MENTION_INDEX_TTL_MS;
  if (fresh) return Promise.resolve(M.index);
  if (M.loading && M.loading.cwd === target.cwd) return M.loading.promise;
  const arg = target.sessionId ? { sessionId: target.sessionId, cwd: target.cwd } : { cwd: target.cwd };
  const promise = call(cf.fileIndex, arg).then((index) => {
    M.index = {
      cwd: target.cwd, at: Date.now(), truncated: Boolean(index.truncated),
      entries: [...(index.dirs || []), ...(index.files || [])],
    };
    M.error = null;
    return M.index;
  }, (err) => {
    M.error = err.message;
    return null;
  }).finally(() => {
    if (M.loading && M.loading.promise === promise) M.loading = null;
  });
  M.loading = { cwd: target.cwd, promise };
  return promise;
}

function mentionMenu() {
  let menu = $('mentionMenu');
  if (menu) return menu;
  menu = el('div', 'menu mention-menu');
  menu.id = 'mentionMenu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  // Clicking a row must not take the cursor out of the prompt.
  menu.addEventListener('mousedown', (event) => event.preventDefault());
  $('composer').append(menu);
  return menu;
}

function closeMention() {
  M.open = false;
  M.mention = null;
  M.items = [];
  const menu = $('mentionMenu');
  if (menu) menu.hidden = true;
}

function renderMention(note) {
  const menu = mentionMenu();
  const list = el('div', 'menu-list');
  const query = M.mention ? M.mention.query : '';
  const head = el('div', 'menu-group');
  head.append(el('span', null, query.endsWith('/') ? query : 'Files in this folder'));
  list.append(head);
  if (note) {
    list.append(el('div', 'menu-empty', note));
  } else if (!M.items.length) {
    list.append(el('div', 'menu-empty', query ? `No file or folder matches “${query}”.` : 'This folder is empty.'));
  }
  M.items.forEach((entry, i) => {
    const folder = entry.endsWith('/');
    const bare = folder ? entry.slice(0, -1) : entry;
    const slash = bare.lastIndexOf('/');
    const row = el('button', `menu-item mention-item${i === M.selected ? ' focus' : ''}`);
    row.type = 'button';
    row.setAttribute('role', 'option');
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', `${bare.slice(slash + 1)}${folder ? '/' : ''}`));
    if (slash > 0) main.append(el('div', 'mi-sub', bare.slice(0, slash + 1)));
    row.append(icon(folder ? 'folder' : 'file'), main);
    row.addEventListener('mouseenter', () => {
      M.selected = i;
      for (const [n, other] of [...list.querySelectorAll('.mention-item')].entries()) other.classList.toggle('focus', n === i);
    });
    row.addEventListener('click', () => acceptMention(entry));
    list.append(row);
  });
  if (M.index && M.index.truncated && M.items.length) {
    list.append(el('div', 'menu-empty mention-note', 'A very large folder: only part of it is listed.'));
  }
  const foot = el('div', 'mention-foot');
  foot.append(el('span', null, '↑↓ to choose'), el('span', null, 'Enter or Tab to insert'), el('span', null, 'Esc to close'));
  menu.replaceChildren(list, foot);
  menu.hidden = false;
  M.open = true;
  const focused = list.querySelector('.mention-item.focus');
  if (focused) focused.scrollIntoView({ block: 'nearest' });
}

let mentionSeq = 0;
async function updateMention() {
  const prompt = $('prompt');
  const target = mentionTarget();
  const mention = prompt.selectionStart === prompt.selectionEnd
    ? CF_MENTION.mentionAt(prompt.value, prompt.selectionStart) : null;
  if (!mention || !target || voice.state !== 'idle') {
    closeMention();
    return;
  }
  const seq = ++mentionSeq;
  const sameQuery = M.mention && M.mention.query === mention.query && M.mention.start === mention.start;
  M.mention = mention;
  if (!sameQuery) M.selected = 0;
  if (!M.index || M.index.cwd !== target.cwd) renderMention('Reading the folder…');
  const index = await mentionIndex(target);
  if (seq !== mentionSeq) return; // typed on meanwhile
  if (!index) {
    renderMention(M.error ? `The files could not be listed: ${M.error}` : 'The files could not be listed.');
    return;
  }
  M.items = CF_MENTION.rankPaths(index.entries, mention.query, MENTION_LIMIT);
  M.selected = Math.min(M.selected, Math.max(0, M.items.length - 1));
  renderMention();
}

function acceptMention(entry) {
  const prompt = $('prompt');
  if (!M.mention || !entry) return;
  const { text, caret } = CF_MENTION.insertMention(prompt.value, M.mention, entry);
  prompt.value = text;
  prompt.focus();
  prompt.setSelectionRange(caret, caret);
  rememberDraft();
  autosize();
  updateSendButton();
  // A folder stays open for what is inside it; a file is done.
  if (entry.endsWith('/')) updateMention();
  else closeMention();
}

function wireMention() {
  const prompt = $('prompt');
  // Registered before the composer's own keys, so Enter picks a file rather
  // than sending the message while the list is open.
  prompt.addEventListener('keydown', (event) => {
    if (!M.open || event.isComposing) return;
    const move = (step) => {
      event.preventDefault();
      if (!M.items.length) return;
      M.selected = (M.selected + step + M.items.length) % M.items.length;
      renderMention();
    };
    if (event.key === 'ArrowDown') move(1);
    else if (event.key === 'ArrowUp') move(-1);
    else if ((event.key === 'Enter' && !event.shiftKey) || (event.key === 'Tab' && !event.shiftKey)) {
      if (!M.items.length) {
        if (event.key === 'Tab') return;
        closeMention();
        return; // Enter with nothing to pick sends, as usual
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      acceptMention(M.items[M.selected]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMention();
    }
  });
  prompt.addEventListener('input', updateMention);
  prompt.addEventListener('click', updateMention);
  prompt.addEventListener('keyup', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateMention();
  });
  prompt.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== prompt) closeMention();
  }, 0));
}
