'use strict';
/* global cf, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Files the conversation links to: what a click
// on one does, the menu a right-click opens, and a text file in the side panel.

// ── Which file ─────────────────────────────────────────────────────────────
// The file a node in the conversation stands for: a picture of a local file,
// a link to one, or a row of the edited files. `shown` is the path as it was
// written there, relative to the session's folder or absolute; the main
// process resolves it (files:info), and decides what may be done with it.
function fileTargetOf(node) {
  if (!node || !node.closest) return null;
  const img = node.closest('img[data-local-path]');
  if (img) return { sessionId: String(img.dataset.local || '').split('\n')[0] || S.current, shown: img.dataset.localPath, img };
  const tagged = node.closest('[data-file-path]');
  if (tagged) {
    return {
      sessionId: tagged.dataset.fileSession || S.current,
      shown: tagged.dataset.filePath,
      img: tagged.tagName === 'IMG' ? tagged : null,
      inViewer: Boolean(tagged.closest('#viewer')),
    };
  }
  const link = node.closest('.markdown a[href]');
  const target = link && CF_FILE_LINKS.localFileTarget(link.getAttribute('href'));
  return target ? { sessionId: S.current, shown: target.path, line: target.line } : null;
}

const onThisComputer = (sessionId) => Boolean(sessionId && local(sessionId).cwd);

const revealLabel = () => (S.init.platform === 'darwin' ? 'Show in Finder'
  : S.init.platform === 'win32' ? 'Show in Explorer' : 'Show in folder');

const fileArg = (target) => ({ sessionId: target.sessionId, path: target.shown });

function fileInfo(target) {
  return call(cf.fileInfo, fileArg(target));
}

function copyToClipboard(text, done = 'Copied.') {
  call(cf.copyText, text).then(() => flashHint(done), (err) => flashHint(err.message));
}

// ── What a click does ──────────────────────────────────────────────────────
// A link to a file opens it where it reads best: a page in the browser pane,
// text in the side panel, a picture in the viewer, anything else with its app.
function onFileLinkClick(link, event) {
  if (!link.closest('.markdown') || event.target.closest('.markdown img')) return;
  const target = CF_FILE_LINKS.localFileTarget(link.getAttribute('href'));
  if (!target) return;
  if (!onThisComputer(S.current)) {
    flashHint(`${target.path} is in the cloud sandbox, not on this computer.`);
    return;
  }
  openFileTarget({ sessionId: S.current, shown: target.path, line: target.line });
}

async function openFileTarget(target) {
  let info;
  try {
    info = await fileInfo(target);
  } catch (err) {
    flashHint(err.message);
    return;
  }
  if (!info.exists) flashHint(`${target.shown} is not there.`);
  else if (info.inside && (info.kind === 'html' || info.kind === 'pdf')) browseFile(target);
  else if (info.text) openFilePanel(target);
  else if (info.inside && info.kind === 'image') viewFileImage(target, info);
  else openWithApp(target);
}

function openWithApp(target) {
  call(cf.openFile, fileArg(target)).catch((err) => flashHint(err.message));
}

function revealFile(target) {
  call(cf.revealFile, fileArg(target)).catch((err) => flashHint(err.message));
}

async function browseFile(target) {
  openBrowserPanel({ focus: false });
  try {
    BROWSER.state = await call(cf.browseFile, fileArg(target));
    updateBrowserBar();
  } catch (err) {
    flashHint(err.message);
  }
}

function viewFileImage(target, info) {
  openViewer({
    name: info.relative || info.path,
    full: call(cf.localImage, { ...fileArg(target), full: true }).then((data) => data.url),
    file: target,
  });
}

// A picture as the window draws it, onto the clipboard. A local one is read
// again whole first: the one in the conversation is made smaller.
async function copyImage(target) {
  try {
    const src = target.shown
      ? (await call(cf.localImage, { ...fileArg(target), full: true })).url
      : target.img.currentSrc || target.img.src;
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    await call(cf.copyImage, canvas.toDataURL('image/png'));
    flashHint('Image copied.');
  } catch (err) {
    flashHint(`Could not copy the image: ${err.message}`);
  }
}

// ── The menu a right-click opens ───────────────────────────────────────────
let ctxMenu = null;
let ctxAsked = 0; // the newest right-click: an older one's answer is dropped

function contextMenuNode() {
  if (!ctxMenu) {
    ctxMenu = el('div', 'menu ctx-menu');
    ctxMenu.id = 'ctxMenu';
    ctxMenu.hidden = true;
    ctxMenu.setAttribute('role', 'menu');
    ctxMenu.append(el('div', 'menu-list'));
    document.body.append(ctxMenu);
  }
  return ctxMenu;
}

function hideContextMenu() {
  if (ctxMenu) ctxMenu.hidden = true;
}

// `groups`: lists of { icon, label, sub, run, disabled }, { head } or { note },
// drawn with a line between lists.
function showContextMenu(x, y, groups) {
  const menu = contextMenuNode();
  const list = menu.firstChild;
  list.replaceChildren();
  groups.filter((group) => group.length).forEach((group, index) => {
    if (index) list.append(el('div', 'menu-sep'));
    for (const entry of group) {
      if (entry.head) {
        const head = el('div', 'ctx-head', entry.head);
        head.title = entry.head;
        list.append(head);
        continue;
      }
      if (entry.note) {
        list.append(el('div', 'ctx-note', entry.note));
        continue;
      }
      const button = el('button', 'menu-item');
      button.setAttribute('role', 'menuitem');
      button.disabled = Boolean(entry.disabled);
      const text = el('span', 'mi-main');
      text.append(el('div', 'mi-name', entry.label));
      if (entry.sub) text.append(el('div', 'mi-sub', entry.sub));
      button.append(icon(entry.icon), text);
      button.addEventListener('click', () => {
        hideContextMenu();
        entry.run();
      });
      list.append(button);
    }
  });
  menu.hidden = false;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y}px`;
}

async function fileMenu(target) {
  const copyPath = (path) => ({ icon: 'copy', label: 'Copy path', run: () => copyToClipboard(path, 'Path copied.') });
  if (!onThisComputer(target.sessionId)) {
    return [[{ head: target.shown }], [{ note: 'This file is in the cloud sandbox, not on this computer.' }],
      [copyPath(target.shown)]];
  }
  let info;
  try {
    info = await fileInfo(target);
  } catch (err) {
    return [[{ head: target.shown }], [{ note: err.message }], [copyPath(target.shown)]];
  }
  const head = [{ head: info.relative || info.path }];
  if (!info.exists) return [head, [{ note: 'This file is not there.' }], [copyPath(info.path)]];

  const open = [];
  if (info.text) {
    open.push({ icon: 'code', label: 'Open in side panel', run: () => openFilePanel(target) });
  } else if (!info.inside && !info.folder && CF_FILE_LINKS.maybeText(info.path)) {
    open.push({ icon: 'code', label: 'Open in side panel', sub: 'Only for files in the session folder', disabled: true, run() {} });
  }
  if (info.inside && info.kind === 'image' && !target.inViewer) {
    open.push({ icon: 'eye', label: 'View', run: () => viewFileImage(target, info) });
  }
  if (info.inside && (info.kind === 'html' || info.kind === 'pdf' || CF_FILE_LINKS.extensionOf(info.path) === '.svg')) {
    open.push({ icon: 'globe', label: 'Open in browser pane', run: () => browseFile(target) });
  }
  open.push({
    icon: 'external',
    label: info.folder ? 'Open folder' : 'Open with default app',
    sub: info.runs ? 'A program or script: asks before it runs' : null,
    run: () => openWithApp(target),
  });
  open.push({ icon: 'folder', label: revealLabel(), run: () => revealFile(target) });

  const copy = [];
  if (info.inside && info.kind === 'image' && target.img) {
    copy.push({ icon: 'image', label: 'Copy image', run: () => copyImage(target) });
  }
  copy.push(copyPath(info.path));
  if (info.relative && info.relative !== info.path) {
    copy.push({ icon: 'copy', label: 'Copy relative path', run: () => copyToClipboard(info.relative, 'Path copied.') });
  }
  return [head, open, copy];
}

function linkMenu(href) {
  if (!/^https?:/i.test(href)) return [[{ icon: 'copy', label: 'Copy link address', run: () => copyToClipboard(href) }]];
  return [
    [{ icon: 'external', label: 'Open link', run: () => window.open(href) },
      { icon: 'globe', label: 'Open in browser pane', run: () => openInAppBrowser(href) }],
    [{ icon: 'copy', label: 'Copy link address', run: () => copyToClipboard(href) }],
  ];
}

function imageMenu(img) {
  const src = img.currentSrc || img.src;
  const items = [];
  // A picture drawn from data is the window's own; one from a site would taint
  // the canvas it is copied through.
  if (src.startsWith('data:')) items.push({ icon: 'image', label: 'Copy image', run: () => copyImage({ img }) });
  if (/^https?:/i.test(src)) {
    return [[{ icon: 'external', label: 'Open image in browser', run: () => window.open(src) }],
      [...items, { icon: 'copy', label: 'Copy image address', run: () => copyToClipboard(src) }]];
  }
  return [items];
}

async function onContextMenu(event) {
  // Fields have nothing of the app's here.
  if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
  const selected = String(window.getSelection() || '').trim() ? String(window.getSelection()) : '';
  const target = fileTargetOf(event.target);
  const link = !target && event.target.closest('a[href]');
  const img = !target && !link && event.target.closest('.markdown img, .tool-image, .msg-image, .viewer-image');
  if (!target && !link && !(img && (img.currentSrc || img.src)) && !selected) return;
  event.preventDefault();
  const asked = ++ctxAsked;
  const { clientX: x, clientY: y } = event;
  const groups = selected ? [[{ icon: 'copy', label: 'Copy', run: () => copyToClipboard(selected) }]] : [];
  if (target) groups.push(...await fileMenu(target));
  else if (link) groups.push(...linkMenu(link.href));
  else if (img) groups.push(...imageMenu(img));
  if (asked === ctxAsked) showContextMenu(x, y, groups);
}

function wireFiles() {
  document.addEventListener('contextmenu', onContextMenu);
  // The menu stays where it was opened: anything that moves the page closes it.
  document.addEventListener('scroll', hideContextMenu, true);
  window.addEventListener('resize', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);
}

// ── A text file in the side panel ──────────────────────────────────────────
// Read from the session's folder each time it is opened or refreshed; the
// panel shows one file at a time, beside the sub-agents when there are some.
const isMarkdownFile = (name) => /\.(md|markdown|mdx)$/i.test(name);

function openFilePanel({ sessionId, shown, line = null }) {
  const before = S.panel.file;
  const same = before && before.sessionId === sessionId && before.shown === shown;
  // preview: a Markdown file drawn rendered; null until it is read, then
  // rendered unless a line was asked for.
  const file = same ? before : { sessionId, shown, data: null, error: null, preview: null };
  file.line = line;
  file.jump = Boolean(line);
  if (line) file.preview = false;
  S.panel = { ...S.panel, open: true, view: 'file', file };
  renderPanel();
  loadPanelFile(file);
}

// The file the panel shows for the session on screen, if any.
function panelFile() {
  const file = S.panel.file;
  return file && file.sessionId === S.current ? file : null;
}

function showFilePanel() {
  S.panel = { ...S.panel, open: true, view: 'file' };
  renderPanel();
}

async function loadPanelFile(file) {
  file.loading = true;
  try {
    file.data = await call(cf.readTextFile, { sessionId: file.sessionId, path: file.shown });
    file.error = null;
    if (file.preview == null) file.preview = isMarkdownFile(file.data.name);
  } catch (err) {
    file.error = err.message;
  } finally {
    file.loading = false;
  }
  if (S.panel.file === file) renderPanel();
}

// Lines as an editor numbers them: a newline at the very end starts none.
const textLines = (text) => Math.max(1, lineCount(text) - (text.endsWith('\n') ? 1 : 0));

// The language a file is coloured as, or '' to show it plain.
function fileLanguage(name, text) {
  if (typeof hljs === 'undefined' || !text || text.length > HIGHLIGHT_LIMIT) return '';
  const named = CF_FILE_LINKS.languageOf(name);
  if (named === 'plaintext') return '';
  const lang = LANGUAGE_ALIASES[named] || named;
  try {
    if (lang && hljs.getLanguage(lang)) return lang;
    if (text.length <= GUESS_LIMIT) {
      const guess = highlighted('?', text, () => {
        const found = hljs.highlightAuto(text);
        return { value: found.value, language: found.language, relevance: found.relevance };
      });
      if (guess.language && guess.relevance >= 5) return guess.language;
    }
  } catch { /* shown plain */ }
  return '';
}

function fileCodeView(file, lang) {
  const text = file.data.text;
  const count = textLines(text);
  const lines = el('div', 'fv-lines');
  const gutter = el('div', 'fv-gutter', Array.from({ length: count }, (_, i) => i + 1).join('\n'));
  const pre = el('pre', 'fv-code');
  const code = el('code', 'hljs');
  code.textContent = text;
  if (lang) {
    try { code.innerHTML = highlightAs(lang, text).value; } catch { /* shown plain */ }
  }
  pre.append(code);
  lines.append(gutter, pre);
  if (file.line && file.line <= count) {
    const mark = el('div', 'fv-mark');
    mark.style.setProperty('--fv-at', String(file.line - 1));
    lines.append(mark);
  }
  return lines;
}

function fileBarButton(iconName, title, run, pressed = null) {
  const button = el('button', 'icon-button');
  button.title = title;
  button.setAttribute('aria-label', title);
  if (pressed != null) button.setAttribute('aria-pressed', String(pressed));
  button.innerHTML = ICON[iconName];
  button.addEventListener('click', run);
  return button;
}

function renderFilePanel(panel, file, agents) {
  const key = `${file.sessionId}\n${file.shown}`;
  const oldBody = panel.dataset.file === key ? panel.querySelector('.fv-body') : null;
  const keep = oldBody && !file.jump ? { top: oldBody.scrollTop, left: oldBody.scrollLeft } : null;
  const data = file.data;
  const name = data ? data.name : baseName(file.shown);
  const extra = agents.length
    ? [fileBarButton('robot', `Show the sub-agents (${agents.length})`, () => openPanel())]
    : [];
  panelHeader(panel, { iconName: 'file', title: name, extra });
  delete panel.dataset.agent;
  panel.dataset.file = key;

  const target = { sessionId: file.sessionId, shown: file.shown };
  const bar = el('div', 'fv-bar');
  const where = el('span', 'fv-path', data ? data.relative : file.shown);
  where.title = data ? data.path : file.shown;
  bar.append(where);
  const lang = data && !file.preview ? fileLanguage(data.name, data.text) : '';
  if (data) {
    const lines = textLines(data.text);
    bar.append(el('span', 'fv-meta', `${fmtNum(lines)} line${lines === 1 ? '' : 's'}${lang ? ` · ${languageLabel(lang)}` : ''}`));
  }
  const tools = el('div', 'fv-tools');
  if (data && isMarkdownFile(data.name)) {
    tools.append(fileBarButton(file.preview ? 'code' : 'eye', file.preview ? 'Show the source' : 'Show it rendered', () => {
      file.preview = !file.preview;
      renderPanel();
    }, file.preview));
  }
  tools.append(
    fileBarButton('refresh', 'Read the file again', () => loadPanelFile(file)),
    fileBarButton('copy', 'Copy the contents', () => data && copyToClipboard(data.text)),
    fileBarButton('external', 'Open with default app', () => openWithApp(target)),
    fileBarButton('folder', revealLabel(), () => revealFile(target)),
  );
  bar.append(tools);
  panel.append(bar);

  const body = el('div', `fv-body${file.preview ? ' preview' : ''}`);
  if (!data && file.error) {
    body.append(el('div', 'ap-empty', file.error));
  } else if (!data) {
    body.append(el('div', 'ap-empty', 'Loading…'));
  } else {
    if (file.error) body.append(el('div', 'fv-note', `Could not read it again: ${file.error}`));
    if (data.truncated) {
      body.append(el('div', 'fv-note', 'This file is long: only its beginning is shown. Open it with its app to see all of it.'));
    }
    if (file.preview) {
      const markdown = el('div', 'markdown');
      setMarkdown(markdown, data.text);
      body.append(markdown);
    } else {
      body.append(fileCodeView(file, lang));
    }
  }
  panel.append(body);
  if (keep) {
    body.scrollTop = keep.top;
    body.scrollLeft = keep.left;
  } else if (data && file.jump && file.line && !file.preview) {
    file.jump = false;
    const gutter = body.querySelector('.fv-gutter');
    const step = gutter ? parseFloat(getComputedStyle(gutter).lineHeight) || 19 : 19;
    body.scrollTop = Math.max(0, (file.line - 1) * step - body.clientHeight / 3);
  }
}
