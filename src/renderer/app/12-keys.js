'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Keyboard shortcuts: approvals, moving between
// sessions, and the list of every shortcut (Ctrl+/).

// ── The list of shortcuts ──────────────────────────────────────────────────
function shortcutGroups() {
  const alt = altLabel();
  return [
    ['Anywhere', [
      ['Ctrl+N', 'New session'],
      ['Ctrl+K', 'Search sessions'],
      ['Ctrl+Tab', 'Next session in the list'],
      ['Ctrl+Shift+Tab', 'Previous session'],
      ['Ctrl+F', 'Find in the conversation'],
      ['Ctrl+,', 'Settings'],
      ['Ctrl+/', 'This list'],
    ]],
    ['Writing a message', [
      ['Enter', 'Send, or steer the agent while it works'],
      ['Shift+Enter', 'New line'],
      ['@', 'Mention a file or folder of the project'],
      ['Ctrl+Shift+S', 'Screenshot a region into the message'],
      ['Esc', 'Close a menu, or cancel a voice recording'],
    ]],
    ['When the agent asks', [
      [`${alt}Y`, 'Allow'],
      [`${alt}A`, 'Allow all of this kind, for the session'],
      [`${alt}N`, 'Deny'],
    ]],
    ['In the session list', [
      ['↑ ↓', 'Move between sessions'],
      ['Enter', 'Open the session'],
      ['F2', 'Rename it'],
    ]],
  ];
}

function keysNode(combo) {
  const keys = el('span', 'sc-keys');
  // "Ctrl+Shift+Tab" as three keys; "Ctrl+," and "↑ ↓" kept whole where a
  // split would lose the key itself.
  const parts = combo === '↑ ↓' ? ['↑', '↓'] : combo.split(/\+(?=.)/);
  for (const part of parts) keys.append(el('kbd', null, part));
  return keys;
}

function openShortcuts() {
  if (document.getElementById('shortcutSheet')) return;
  closeMenus();
  const overlay = el('div', 'overlay confirm-overlay');
  overlay.id = 'shortcutSheet';
  const modal = el('div', 'modal shortcut-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Keyboard shortcuts');
  const head = el('div', 'modal-head');
  const close = el('button', 'icon-button');
  close.title = 'Close';
  close.innerHTML = ICON.x;
  head.append(el('h2', null, 'Keyboard shortcuts'), close);
  modal.append(head);
  const grid = el('div', 'sc-grid');
  for (const [title, rows] of shortcutGroups()) {
    const group = el('section', 'sc-group');
    group.append(el('h3', null, title));
    for (const [combo, what] of rows) {
      const row = el('div', 'sc-row');
      row.append(el('span', 'sc-what', what), keysNode(combo));
      group.append(row);
    }
    grid.append(group);
  }
  modal.append(grid);
  overlay.append(modal);
  const done = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    $('prompt').focus();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' || (event.ctrlKey && event.key === '/')) {
      event.preventDefault();
      event.stopPropagation();
      done();
    }
  };
  document.addEventListener('keydown', onKey, true);
  close.addEventListener('click', done);
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) done(); });
  document.body.append(overlay);
}

// ── Moving between sessions ────────────────────────────────────────────────
// In the order the sidebar shows them, so the next one is the one below.
function cycleSession(step) {
  const ids = [...document.querySelectorAll('#sessionList .session[data-id]')].map((row) => row.dataset.id);
  if (!ids.length) return;
  const at = ids.indexOf(S.current);
  const next = at === -1 ? (step > 0 ? 0 : ids.length - 1) : (at + step + ids.length) % ids.length;
  if (ids[next] !== S.current) selectSession(ids[next]);
}

// ── Answering approvals ────────────────────────────────────────────────────
// Alt (Option on a Mac) and a letter answer the oldest call waiting in the
// open session. Plain letters would answer while someone types a message.
function answerByKey(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const decision = Object.keys(APPROVAL_KEYS).find((key) => APPROVAL_KEYS[key] === event.code);
  if (!decision) return false;
  // A dialog on top is what the keys are for, not the conversation under it.
  if (!$('settings').hidden || document.querySelector('.confirm-overlay')) return false;
  const tool = waitingTools(S.current)[0];
  if (!tool || !approvalChoices(tool).includes(decision)) return false;
  event.preventDefault();
  decideTool(tool, decision);
  return true;
}

function wireKeys() {
  document.addEventListener('keydown', (event) => {
    if (answerByKey(event)) return;
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Tab' || event.key === 'PageDown' || event.key === 'PageUp') {
      if (!$('settings').hidden || document.querySelector('.confirm-overlay')) return;
      event.preventDefault();
      cycleSession(event.key === 'PageUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1);
    } else if (event.key === '/' && !event.shiftKey) {
      event.preventDefault();
      openShortcuts();
    } else if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
      event.preventDefault();
      if (!$('settings').hidden) return;
      closeMenus();
      focusSessionSearch();
    }
  });
}
