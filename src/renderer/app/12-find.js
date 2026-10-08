'use strict';
/* global cf */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Find in the conversation (Ctrl+F).
//
// Matches are painted with the CSS Custom Highlight API rather than the
// browser's find: that one searches the whole page, its own search box
// included, while this searches the conversation and nothing else. Only what
// is shown is searched: a folded tool step keeps its contents to itself.

const FIND_LIMIT = 2000;
const FIND = { open: false, query: '', ranges: [], index: -1, observer: null, timer: null };
const canHighlight = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

// Text that is part of the page but not of the conversation: buttons' labels,
// hover tips, and the copy buttons on code.
const FIND_SKIP = '.tip, .code-copy, .footer-copy, .approval, button.tool-head .tool-meta, script, style';

function findTextNodes(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (parent.closest(FIND_SKIP) || parent.closest('[hidden]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: text.length });
    text += node.nodeValue;
  }
  return { nodes, text };
}

// Where an offset in the joined text falls: the node holding it, and where in it.
function nodeAt(nodes, offset, end) {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // A match ending exactly where a node starts ends in the node before it.
    if (nodes[mid].start < offset || (!end && nodes[mid].start === offset)) lo = mid;
    else hi = mid - 1;
  }
  return { node: nodes[lo].node, offset: offset - nodes[lo].start };
}

function findMatches(query) {
  const root = $('column');
  const q = String(query || '').toLowerCase();
  if (!root || !q) return [];
  const { nodes, text } = findTextNodes(root);
  if (!nodes.length) return [];
  const hay = text.toLowerCase();
  const ranges = [];
  for (let at = hay.indexOf(q); at !== -1 && ranges.length < FIND_LIMIT; at = hay.indexOf(q, at + q.length)) {
    const start = nodeAt(nodes, at, false);
    const stop = nodeAt(nodes, at + q.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(stop.node, stop.offset);
    ranges.push(range);
  }
  return ranges;
}

function paintFind() {
  if (!canHighlight()) return;
  CSS.highlights.set('cf-find', new Highlight(...FIND.ranges));
  const current = FIND.ranges[FIND.index];
  if (current) CSS.highlights.set('cf-find-current', new Highlight(current));
  else CSS.highlights.delete('cf-find-current');
}

function renderFindCount() {
  const count = $('findCount');
  if (!count) return;
  const total = FIND.ranges.length;
  count.textContent = !FIND.query ? '' : total
    ? `${FIND.index + 1} of ${total >= FIND_LIMIT ? `${FIND_LIMIT}+` : total}` : 'No results';
  count.classList.toggle('none', Boolean(FIND.query) && !total);
  $('findPrev').disabled = total < 2;
  $('findNext').disabled = total < 2;
}

function showFindMatch() {
  const range = FIND.ranges[FIND.index];
  paintFind();
  renderFindCount();
  if (!range) return;
  const box = $('transcript');
  const rect = range.getBoundingClientRect();
  const view = box.getBoundingClientRect();
  if (rect.top < view.top + 40 || rect.bottom > view.bottom - 40) {
    box.scrollTop += rect.top - view.top - box.clientHeight / 3;
  }
}

// Searches again, keeping the place: the match nearest the one shown before.
function runFind({ keepPlace = false } = {}) {
  const before = keepPlace ? FIND.ranges[FIND.index] : null;
  const beforeTop = before && before.startContainer.isConnected ? before.getBoundingClientRect().top : null;
  FIND.ranges = findMatches(FIND.query);
  if (!FIND.ranges.length) FIND.index = -1;
  else if (beforeTop != null) {
    let best = 0;
    FIND.ranges.forEach((range, i) => {
      if (Math.abs(range.getBoundingClientRect().top - beforeTop)
        < Math.abs(FIND.ranges[best].getBoundingClientRect().top - beforeTop)) best = i;
    });
    FIND.index = best;
  } else {
    // A new search starts at the first match in view, or after it.
    const top = $('transcript').getBoundingClientRect().top;
    const first = FIND.ranges.findIndex((range) => range.getBoundingClientRect().bottom >= top);
    FIND.index = first === -1 ? FIND.ranges.length - 1 : first;
  }
  if (keepPlace) {
    paintFind();
    renderFindCount();
  } else {
    showFindMatch();
  }
}

function stepFind(step) {
  if (FIND.ranges.some((range) => !range.startContainer.isConnected)) runFind({ keepPlace: true });
  if (!FIND.ranges.length) return;
  FIND.index = (FIND.index + step + FIND.ranges.length) % FIND.ranges.length;
  showFindMatch();
}

function buildFindBar() {
  const bar = el('div', 'find-bar');
  bar.id = 'findBar';
  bar.hidden = true;
  bar.setAttribute('role', 'search');
  const input = el('input');
  input.id = 'findInput';
  input.placeholder = 'Find in the conversation';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.title = 'Searches what is shown. Open a tool step to search inside it.';
  const count = el('span', 'find-count');
  count.id = 'findCount';
  const button = (id, iconName, title, run) => {
    const node = el('button', 'icon-button');
    node.id = id;
    node.title = title;
    node.append(icon(iconName));
    node.addEventListener('click', run);
    return node;
  };
  const prev = button('findPrev', 'caret', 'Previous (Shift+Enter)', () => stepFind(-1));
  prev.classList.add('up');
  const next = button('findNext', 'caret', 'Next (Enter)', () => stepFind(1));
  const close = button('findClose', 'x', 'Close (Esc)', closeFind);
  bar.prepend(icon('search', 'icon find-icon'));
  bar.append(input, count, prev, next, close);
  input.addEventListener('input', () => {
    FIND.query = input.value;
    runFind();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'F3') {
      event.preventDefault();
      stepFind(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeFind();
    }
  });
  document.querySelector('.main').append(bar);
  return bar;
}

function openFind() {
  if (!S.current) return;
  const bar = $('findBar') || buildFindBar();
  const input = $('findInput');
  const selected = String(window.getSelection ? window.getSelection() : '').trim();
  if (selected && !selected.includes('\n') && selected.length < 120) input.value = selected;
  bar.hidden = false;
  FIND.open = true;
  FIND.query = input.value;
  input.focus();
  input.select();
  if (!canHighlight()) {
    $('findCount').textContent = 'Not available here';
    return;
  }
  runFind();
  // The conversation keeps changing while a run streams: count again, keeping
  // the place, a moment after it settles.
  if (!FIND.observer) {
    FIND.observer = new MutationObserver(() => {
      if (!FIND.open || !FIND.query) return;
      clearTimeout(FIND.timer);
      FIND.timer = setTimeout(() => runFind({ keepPlace: true }), 250);
    });
  }
  FIND.observer.observe($('transcript'), { childList: true, subtree: true, characterData: true });
}

function closeFind() {
  const bar = $('findBar');
  if (bar) bar.hidden = true;
  FIND.open = false;
  FIND.ranges = [];
  FIND.index = -1;
  clearTimeout(FIND.timer);
  if (FIND.observer) FIND.observer.disconnect();
  if (canHighlight()) {
    CSS.highlights.delete('cf-find');
    CSS.highlights.delete('cf-find-current');
  }
  $('prompt').focus();
}

function wireFind() {
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      if (!$('settings').hidden || document.querySelector('.confirm-overlay')) return;
      event.preventDefault();
      openFind();
    } else if (event.key === 'F3' && FIND.open && document.activeElement !== $('findInput')) {
      event.preventDefault();
      stepFind(event.shiftKey ? -1 : 1);
    }
  });
}
