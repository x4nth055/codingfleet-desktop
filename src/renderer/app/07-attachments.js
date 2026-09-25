'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Files, screenshots, drag and drop, paste; and compacting a session.

// ── Attachments ────────────────────────────────────────────────────────────
// Files join the message being written: from the + menu, a drop anywhere on
// the window, or a paste. Each uploads at once, so Send only waits for the
// stragglers. The server checks every file; the limits here only spare a
// pointless upload.
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
let attachmentSeq = 0;

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function roomFor(count) {
  const free = MAX_ATTACHMENTS - S.attachments.length;
  if (count > free) {
    showBanner(free > 0 ? `You can attach ${free} more file${free === 1 ? '' : 's'} to this message.`
      : `A message can carry at most ${MAX_ATTACHMENTS} files.`);
  }
  return Math.max(0, Math.min(count, free));
}

// Where a new attachment goes, which decides what adding one means:
//   folder session  -> the agent already works on this computer. A text or
//                      code file is handed over by its path (inside the folder
//                      it reads it at once; outside, it asks you first), and
//                      nothing is uploaded. Images and documents only the
//                      server can read (PDF, Office) are uploaded.
//   sandbox session -> files are uploaded into that session's sandbox; for a
//                      session that does not exist yet, when you send.
function attachTarget() {
  const session = currentSession();
  if (session) {
    return session.executor === 'client'
      ? { mode: 'folder', cwd: local(session.id).cwd || null, key: `folder:${session.id}` }
      : { mode: 'sandbox', sessionId: session.id, key: `sandbox:${session.id}` };
  }
  if (S.draftSandbox) return { mode: 'sandbox', sessionId: null, draft: true, key: 'sandbox:new' };
  return { mode: 'folder', cwd: S.draftCwd || null, key: `folder:new:${S.draftCwd || ''}` };
}

function addAttachment(info, upload, target = attachTarget()) {
  const item = {
    key: ++attachmentSeq, name: info.name, size: info.size || 0, kind: info.kind || 'file',
    preview: info.preview || null, status: 'uploading', fileId: null, error: null,
    target: target.key, location: target.mode === 'sandbox' ? 'sandbox' : 'server',
  };
  if (item.size > MAX_ATTACHMENT_BYTES) {
    item.status = 'error';
    item.error = 'Larger than 20 MB';
  }
  S.attachments.push(item);
  if (item.status !== 'error' && upload) {
    item.start = (sessionId) => {
      item.status = 'uploading';
      item.promise = upload(sessionId).then((data) => {
        item.status = 'ready';
        item.fileId = data.id;
        item.kind = data.kind || item.kind;
        if (item.preview && item.kind === 'image') S.images.set(data.id, item.preview);
      }, (err) => {
        item.status = 'error';
        item.error = err.message;
      }).finally(() => {
        renderAttachments();
        updateSendButton();
      });
      return item.promise;
    };
    if (target.draft) item.status = 'queued';
    else item.start(target.sessionId || null);
  }
  renderAttachments();
  updateSendButton();
}

// A file the agent reads where it is: its path goes with the message.
function addReference(info, target) {
  S.attachments.push({
    key: ++attachmentSeq, name: info.name, size: info.size || 0, kind: 'path', status: 'ready',
    path: info.path, ref: info.inside ? info.relative : info.path, inside: info.inside, target: target.key,
  });
  renderAttachments();
  updateSendButton();
}

function attachInfos(infos) {
  const target = attachTarget();
  for (const info of infos.slice(0, roomFor(infos.length))) {
    if (target.mode === 'folder' && info.text) addReference(info, target);
    else addAttachment(info, (sessionId) => call(cf.uploadPath, { path: info.path, sessionId }), target);
  }
}

async function attachPaths(paths) {
  if (!paths.length) return;
  try {
    attachInfos(await call(cf.describeFiles, { paths, cwd: attachTarget().cwd || null }));
  } catch (err) {
    showBanner(err.message);
  }
}

async function pickAttachments() {
  closeMenus();
  try {
    attachInfos(await call(cf.pickFiles, { cwd: attachTarget().cwd || null }));
  } catch (err) {
    showBanner(err.message);
  }
}

function attachBytes(name, type, bytes, preview) {
  if (!roomFor(1)) return;
  addAttachment({ name, size: bytes.byteLength, kind: IMAGE_TYPES.includes(type) ? 'image' : 'file', preview },
    (sessionId) => call(cf.uploadData, { name, type, data: new Uint8Array(bytes), sessionId }));
}

function blobPreview(blob) {
  return new Promise((resolve) => {
    if (!IMAGE_TYPES.includes(blob.type) || blob.size > MAX_ATTACHMENT_BYTES) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function attachBlobs(blobs, fallbackName) {
  const take = roomFor(blobs.length);
  for (const blob of blobs.slice(0, take)) {
    const ext = (blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const name = blob.name || `${fallbackName}.${ext}`;
    const preview = await blobPreview(blob);
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      addAttachment({ name, size: blob.size, kind: 'file' }, null);
      continue;
    }
    attachBytes(name, blob.type, await blob.arrayBuffer(), preview);
  }
}

// A screenshot, attached so the model can see it. `mode` is 'region' (the user
// drags a rectangle), 'window' (one open window) or a screen.
async function takeScreenshot(mode, id) {
  closeMenus();
  if (!roomFor(1)) return;
  try {
    const shot = await call(cf.screenshot, { mode, id });
    if (!shot) return;   // the region was cancelled with Esc
    addAttachment({ name: shot.name, size: shot.data.length, kind: 'image', preview: shot.preview },
      (sessionId) => call(cf.uploadData, { name: shot.name, type: shot.type, data: shot.data, sessionId }));
  } catch (err) {
    showBanner(err.message);
  }
}

// One open window, chosen from its picture. Resolves to a source id, or null.
function pickWindowDialog(windows) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay');
    const modal = el('div', 'modal shot-picker');
    modal.setAttribute('role', 'dialog');
    const head = el('div', 'modal-head');
    head.append(el('h2', null, 'Which window?'));
    modal.append(head, el('p', 'modal-intro', 'The picture is taken of the whole window, even where '
      + 'something covers it.'));
    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    };
    if (windows.length) {
      const grid = el('div', 'shot-grid');
      for (const item of windows) {
        const card = el('button', 'shot-card');
        card.type = 'button';
        const frame = el('div', 'shot-frame');
        if (item.thumbnail) {
          const img = el('img');
          img.src = item.thumbnail;
          img.alt = '';
          frame.append(img);
        } else {
          frame.append(icon('monitor'));
        }
        const name = el('div', 'shot-name');
        if (item.icon) {
          const badge = el('img', 'shot-icon');
          badge.src = item.icon;
          badge.alt = '';
          name.append(badge);
        }
        name.append(el('span', null, item.name));
        card.title = item.name;
        card.append(frame, name);
        card.addEventListener('click', () => close(item.id));
        grid.append(card);
      }
      modal.append(grid);
    } else {
      modal.append(el('p', 'confirm-text', 'No other window is open.'));
    }
    const cancel = el('button', 'btn', 'Cancel');
    cancel.addEventListener('click', () => close(null));
    const actions = el('div', 'modal-actions');
    actions.append(el('div', 'bar-spacer'), cancel);
    modal.append(actions);
    overlay.append(modal);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    setTimeout(() => cancel.focus(), 0);
  });
}

async function pickWindowShot() {
  closeMenus();
  if (!roomFor(1)) return;
  let targets;
  try {
    targets = await call(cf.screenTargets);
  } catch (err) {
    showBanner(err.message);
    return;
  }
  const id = await pickWindowDialog(targets.windows || []);
  if (id) takeScreenshot('window', id);
}

// The screenshot choices, in the place the attach menu was.
async function openScreenshotMenu() {
  const menu = $('attachMenu');
  const list = $('attachList');
  list.replaceChildren();
  const note = el('div', 'attach-note');
  note.append(el('strong', null, 'Screenshot.'),
    el('span', null, ' It is uploaded with your message, so the model can see it.'));
  list.append(note);
  menuOption(list, 'crop', 'Select a region', 'Drag a rectangle on any screen. Esc cancels.',
    () => takeScreenshot('region'));
  menuOption(list, 'monitor', 'A window', 'Pick one open window, covered or not', pickWindowShot);
  const screens = el('div', 'menu-rows');
  list.append(screens);
  menu.hidden = false;
  let targets = null;
  try {
    targets = await call(cf.screenTargets);
  } catch { /* the screen row still works without the list */ }
  if (menu.hidden) return;
  const found = (targets && targets.screens) || [];
  if (found.length < 2) {
    menuOption(screens, 'monitor', 'The whole screen', 'The screen CodingFleet is on',
      () => takeScreenshot('screen'));
    return;
  }
  for (const item of found) {
    menuOption(screens, 'monitor', item.label,
      [`${item.width} × ${item.height}`, item.current ? 'where CodingFleet is' : '', item.primary ? 'main' : '']
        .filter(Boolean).join(' · '),
      () => takeScreenshot('screen', item.id));
  }
}

function removeAttachment(key) {
  const index = S.attachments.findIndex((a) => a.key === key);
  if (index === -1) return;
  const [item] = S.attachments.splice(index, 1);
  // An upload nobody will send is removed from the account too.
  const drop = (id) => { if (id) cf.deleteFile(id); };
  if (item.fileId) drop(item.fileId);
  else if (item.promise) item.promise.then(() => drop(item.fileId));
  renderAttachments();
  updateSendButton();
}

// Moving to another session: what was added for this one does not apply there.
function discardAttachments() {
  for (const item of [...S.attachments]) removeAttachment(item.key);
}

function attachmentChip(item, { removable }) {
  const chip = el('div', `att${item.status === 'error' ? ' error' : ''}`);
  chip.title = item.error ? `${item.name}: ${item.error}` : item.name;
  if (item.kind === 'path') chip.classList.add('ref');
  if (item.preview) {
    const img = el('img', 'att-thumb');
    img.alt = '';
    img.src = item.preview;
    chip.append(img);
  } else {
    const box = el('span', 'att-icon');
    box.innerHTML = item.kind === 'image' ? ICON.image : item.kind === 'path' ? ICON.folder : ICON.file;
    chip.append(box);
  }
  const text = el('span', 'att-text');
  const sub = item.status === 'uploading' ? 'Uploading…'
    : item.status === 'queued' ? 'Uploads to the sandbox when you send'
    : item.status === 'error' ? (item.error || 'Could not upload')
    : item.kind === 'path' ? (item.inside ? 'In the folder · not uploaded' : 'On this computer · read after you approve')
    : [item.kind === 'image' ? 'Image' : 'File', item.location === 'sandbox' ? 'in the sandbox' : '',
      item.size ? fmtSize(item.size) : ''].filter(Boolean).join(' · ');
  if (item.kind === 'path') chip.title = `${item.path}\n${item.inside
    ? 'The agent reads it from your folder.'
    : 'Outside the folder: the agent asks before reading it.'}`;
  text.append(el('span', 'att-name', item.name), el('span', 'att-sub', sub));
  chip.append(text);
  if (item.status === 'uploading') {
    const busy = el('span', 'att-busy');
    busy.append(el('span', 'spinner'));
    chip.append(busy);
  }
  if (removable) {
    const remove = el('button', 'att-remove');
    remove.title = 'Remove';
    remove.innerHTML = ICON.x;
    remove.addEventListener('click', () => removeAttachment(item.key));
    chip.append(remove);
  }
  return chip;
}

function renderAttachments() {
  const box = $('attachments');
  box.replaceChildren(...S.attachments.map((item) => attachmentChip(item, { removable: true })));
  box.hidden = S.attachments.length === 0;
}

// One row of the attach menu: an icon, a name and a line about it.
function menuOption(list, iconName, name, sub, run) {
  const row = el('button', 'menu-item');
  const main = el('div', 'mi-main');
  main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
  row.append(icon(iconName), main);
  row.addEventListener('click', run);
  list.append(row);
  return row;
}

function openAttachMenu() {
  closeMenus();
  const menu = $('attachMenu');
  menu.style.left = `${$('attachButton').offsetLeft}px`;
  const list = $('attachList');
  list.replaceChildren();
  const option = (iconName, name, sub, run) => menuOption(list, iconName, name, sub, run);
  const target = attachTarget();
  if (target.mode === 'folder') {
    const where = target.cwd ? baseName(target.cwd) : 'your project folder';
    const note = el('div', 'attach-note');
    note.append(el('strong', null, 'CodingFleet already works on your files.'),
      el('span', null, ` It reads and edits everything in ${where} — just name the file in your message.`));
    list.append(note);
    option('file', 'Add files', 'Passed by path, nothing uploaded. Files outside the folder need your approval.',
      pickAttachments);
    option('monitor', 'Screenshot', 'A region, a window or a whole screen', openScreenshotMenu);
    list.append(el('div', 'menu-empty', 'Images and PDF or Office documents are uploaded; the model reads them on CodingFleet.'));
  } else {
    option('upload', 'Upload to the sandbox', 'Any file: code, pages, data, images', pickAttachments);
    option('monitor', 'Screenshot', 'A region, a window or a whole screen', openScreenshotMenu);
    list.append(el('div', 'menu-empty', target.draft
      ? 'Files go into the new session\'s sandbox when you send. Or drop them anywhere, or paste an image.'
      : 'Or drop files anywhere, or paste an image.'));
  }
  menu.hidden = false;
}

// Checked before anything is sent: nothing failed, and nothing was added for
// another place (the sandbox, when the message now goes to a folder session).
function checkAttachments(targetKey = attachTarget().key) {
  const failed = S.attachments.find((a) => a.status === 'error');
  if (failed) throw new Error(`${failed.name} could not be attached (${failed.error}). Remove it to send.`);
  const elsewhere = S.attachments.find((a) => a.target !== targetKey);
  if (elsewhere) throw new Error(`${elsewhere.name} was added for another session or place. Remove it and add it again.`);
}

// The attachments a message is sent with: starts the uploads that waited for
// a session, and waits for all of them.
async function readyAttachments(sessionId, targetKey = attachTarget().key) {
  checkAttachments(targetKey);
  for (const item of S.attachments.filter((a) => a.status === 'queued')) item.start(sessionId);
  const pending = S.attachments.filter((a) => a.promise && a.status === 'uploading').map((a) => a.promise);
  if (pending.length) await Promise.allSettled(pending);
  checkAttachments(targetKey);
  return S.attachments.filter((a) => a.status === 'ready');
}

// What the model gets for files passed by path.
const REFERENCES_HEADER = '\n\nFiles for this message, on this computer (read them with your file tools):\n';
const OUTSIDE_NOTE = ' (outside the working folder)';

function withReferences(text, items) {
  const refs = items.filter((a) => a.kind === 'path');
  if (!refs.length) return text;
  const lines = refs.map((a) => `- \`${a.ref}\`${a.inside ? '' : OUTSIDE_NOTE}`);
  return `${text}${REFERENCES_HEADER}${lines.join('\n')}`;
}

// The reverse of withReferences, for a message read back from the server.
function splitReferences(text) {
  const value = String(text || '');
  const at = value.lastIndexOf(REFERENCES_HEADER);
  if (at === -1) return { text: value, refs: [] };
  const refs = [];
  for (const line of value.slice(at + REFERENCES_HEADER.length).split('\n')) {
    let body = line.trim();
    const inside = !body.endsWith(OUTSIDE_NOTE);
    if (!inside) body = body.slice(0, -OUTSIDE_NOTE.length);
    if (!body.startsWith('- `') || !body.endsWith('`') || body.length < 5) return { text: value, refs: [] };
    const ref = body.slice(3, -1);
    refs.push({ kind: 'path', status: 'ready', name: ref.split(/[\\/]/).pop(), path: ref, ref, inside });
  }
  return { text: value.slice(0, at), refs };
}

const uploadedIds = (items) => items.filter((a) => a.fileId).map((a) => a.fileId);

function clearAttachments() {
  S.attachments = [];
  renderAttachments();
}

// ── Drag and drop, paste ───────────────────────────────────────────────────
let dragDepth = 0;
const draggingFiles = (event) => [...(event.dataTransfer && event.dataTransfer.types || [])].includes('Files');

function wireDrop() {
  window.addEventListener('dragenter', (event) => {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    const target = attachTarget();
    $('dropTitle').textContent = target.mode === 'folder' ? 'Drop to add' : 'Drop to upload to the sandbox';
    $('dropSub').textContent = target.mode === 'folder'
      ? 'The agent reads text and code where they are — nothing is uploaded. Images and documents are.'
      : 'Any file, up to 20 MB each';
    $('dropOverlay').hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!draggingFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('dropOverlay').hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    $('dropOverlay').hidden = true;
    const files = [...(event.dataTransfer ? event.dataTransfer.files : [])];
    if (!files.length) return;
    if (!S.settings.hasKey) {
      openSettings(true);
      return;
    }
    const paths = [];
    const blobs = [];
    for (const file of files) {
      const where = cf.pathForFile(file);
      if (where) paths.push(where);
      else blobs.push(file);
    }
    if (paths.length) attachPaths(paths);
    if (blobs.length) attachBlobs(blobs, 'dropped');
    $('prompt').focus();
  });
  $('prompt').addEventListener('paste', (event) => {
    const images = [...(event.clipboardData ? event.clipboardData.items : [])]
      .filter((item) => item.kind === 'file' && IMAGE_TYPES.includes(item.type))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!images.length) return;
    event.preventDefault();
    attachBlobs(images, 'pasted-image');
  });
}

// ── Compaction ─────────────────────────────────────────────────────────────
// Older messages summarized to make room in the context: by the button, or on
// its own when the conversation nears the limit.
const MIN_COMPACT_TOKENS = 20_000;
const compacting = new Set();

function compactionChip(item) {
  const node = el('div', 'compaction');
  node.append(icon('compress', 'icon'));
  const text = el('span', 'compaction-text');
  text.append(el('strong', null, item.manual ? 'Compacted the conversation' : 'Compacted the conversation automatically'));
  if (item.before && item.after != null) {
    text.append(el('span', 'compaction-stats', `${fmtCompact(item.before)} → ${fmtCompact(item.after)} tokens`));
  }
  node.append(text);
  node.title = item.manual
    ? 'Older messages were summarized on request. The newest ones are kept as they are.'
    : 'The conversation neared its context limit, so older messages were summarized. '
      + 'The newest ones are kept as they are.';
  if (item.before && item.after != null) {
    node.title += `\nBefore: ${Number(item.before).toLocaleString()} tokens. Now: ${Number(item.after).toLocaleString()} tokens.`;
  }
  return node;
}

function setContextTokens(sessionId, tokens) {
  const session = S.sessions.find((s) => s.id === sessionId);
  if (!session || tokens == null) return;
  session.context = { ...(session.context || {}), tokens };
  if (sessionId === S.current) renderAccount();
}

function compactButton(session) {
  const button = el('button', 'compact-button');
  const busy = compacting.has(session.id);
  const running = S.running.has(session.id);
  const small = ((session.context || {}).tokens || 0) < MIN_COMPACT_TOKENS;
  button.append(icon('compress', 'icon'), el('span', null, busy ? 'Compacting…' : 'Compact'));
  button.disabled = busy || running || small;
  button.title = running ? 'Wait for the run to finish, then compact.'
    : small ? 'The conversation is still small: there is nothing worth compacting.'
      : 'Summarize the older messages now, to free context. The newest messages stay as they are.';
  button.addEventListener('click', () => compactSession(session.id));
  return button;
}

async function compactSession(sessionId) {
  if (compacting.has(sessionId)) return;
  compacting.add(sessionId);
  renderAccount();
  try {
    const data = await call(cf.compactSession, sessionId);
    const c = data.compaction || {};
    addItem(sessionId, { type: 'compaction', before: c.before_tokens, after: c.after_tokens, manual: true, at: c.at });
    if (data.context) {
      const session = S.sessions.find((s) => s.id === sessionId);
      if (session) session.context = data.context;
    }
  } catch (err) {
    showBanner(`The conversation could not be compacted: ${err.message}`);
  } finally {
    compacting.delete(sessionId);
    renderAccount();
  }
}
