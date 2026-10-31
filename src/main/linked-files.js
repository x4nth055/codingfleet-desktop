'use strict';
// Files an answer links to. The agent writes [the video](out/run.mp4) for a
// file it made, and the window asks to show it in its folder, open it with its
// app, or read it into the side panel (renderer/app/12-files.js).
//
// Reading stays inside the session's folder, as for the images an answer
// shows: a link that names another path is not a reason to hand its contents
// to the window. Showing and opening reach a file anywhere on this computer,
// never on another one: touching \\server\share sends the user's Windows
// sign-in to that server. A program or a script asks before it opens, since
// opening it runs it, whatever wrote the link.
const fs = require('fs');
const path = require('path');

const fileLinks = require('../core/file-links');
const tools = require('../core/tools');

const TEXT_VIEW_MAX_BYTES = 2 * 1024 * 1024;
const SNIFF_BYTES = 8192;

// No NUL near the start: what the side panel can show as text.
async function looksLikeText(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return !head.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * @param {object} deps
 * @param {(sessionId: string) => string|null} deps.folderOf the session's folder on this computer
 * @param {{ openPath: Function, showItemInFolder: Function }} deps.shell Electron's shell
 * @param {{ showMessageBox: Function }} deps.dialog Electron's dialog
 * @param {() => object|null} deps.getWindow the window a question is asked over
 * @param {(file: string) => Promise<object>} deps.browse loads a file in the browser pane
 * @param {string} [deps.platform]
 */
function createLinkedFiles({ folderOf, shell, dialog, getWindow, browse, platform = process.platform }) {
  function target({ sessionId, path: shown } = {}) {
    const cwd = folderOf(sessionId);
    if (!cwd) throw new Error('This session has no folder on this computer.');
    if (typeof shown !== 'string' || !shown || shown.length > 1024 || shown.includes('\0')) throw new Error('No file.');
    const file = tools.resolvePath(cwd, shown);
    const inside = tools.isInside(cwd, file);
    if (!inside && /^[\\/]{2}/.test(file)) throw new Error(`${shown} is on another computer.`);
    return { cwd, file, inside, shown };
  }

  async function statOf(file, shown) {
    try {
      return await fs.promises.stat(file);
    } catch {
      throw new Error(`${shown} is not there.`);
    }
  }

  const runs = (file, stat) => stat.isFile()
    && (fileLinks.runsWhenOpened(file) || (platform !== 'win32' && (stat.mode & 0o111) !== 0));

  const relativeTo = (cwd, file) => path.relative(cwd, file).replace(/\\/g, '/');

  /** What the file is, for the window to choose what a click does. */
  async function info(arg) {
    const { cwd, file, inside } = target(arg);
    let stat = null;
    try { stat = await fs.promises.stat(file); } catch { /* not there */ }
    const isFile = Boolean(stat && stat.isFile());
    return {
      path: file,
      name: path.basename(file),
      relative: inside ? relativeTo(cwd, file) : null,
      inside,
      exists: Boolean(stat),
      folder: Boolean(stat && stat.isDirectory()),
      size: isFile ? stat.size : null,
      kind: fileLinks.kindOf(file),
      text: isFile && inside && fileLinks.maybeText(file) && await looksLikeText(file),
      runs: Boolean(stat) && runs(file, stat),
    };
  }

  /** The file's text for the side panel: its first 2 MB, cut at a whole line. */
  async function readText(arg) {
    const { cwd, file, inside, shown } = target(arg);
    if (!inside) throw new Error(`${shown} is outside the session folder.`);
    const stat = await statOf(file, shown);
    if (!stat.isFile()) throw new Error(`${shown} is not a file.`);
    const length = Math.min(stat.size, TEXT_VIEW_MAX_BYTES);
    const bytes = Buffer.alloc(length);
    const handle = await fs.promises.open(file, 'r');
    try {
      await handle.read(bytes, 0, length, 0);
    } finally {
      await handle.close();
    }
    if (bytes.includes(0)) throw new Error(`${path.basename(file)} is not a text file.`);
    const truncated = stat.size > length;
    let text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    if (truncated) text = text.slice(0, Math.max(0, text.lastIndexOf('\n') + 1));
    return {
      path: file,
      name: path.basename(file),
      relative: relativeTo(cwd, file),
      size: stat.size,
      mtime: stat.mtimeMs,
      text,
      truncated,
    };
  }

  /** Opens the file with its app, or a folder in the file manager. False when the user said no. */
  async function open(arg) {
    const { file, shown } = target(arg);
    const stat = await statOf(file, shown);
    if (runs(file, stat)) {
      const name = path.basename(file);
      const { response } = await dialog.showMessageBox(getWindow(), {
        type: 'warning',
        buttons: ['Cancel', 'Open'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Open a program or script?',
        message: `Open ${name}?`,
        detail: `${file}\n\n${name} is a program, a script or a document with macros. Opening it runs it on this `
          + 'computer with your permissions. Open it only if you trust what made it.',
      });
      if (response !== 1) return false;
    }
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return true;
  }

  /** Shows the file selected in its folder: Explorer, Finder or the file manager. */
  async function reveal(arg) {
    const { file, shown } = target(arg);
    await statOf(file, shown);
    shell.showItemInFolder(file);
    return true;
  }

  /** A page or a PDF in the session's folder, in the app's browser pane. */
  async function browseFile(arg) {
    const { file, inside, shown } = target(arg);
    if (!inside) throw new Error(`${shown} is outside the session folder.`);
    const stat = await statOf(file, shown);
    if (!stat.isFile()) throw new Error(`${shown} is not a file.`);
    return browse(file);
  }

  return { info, readText, open, reveal, browse: browseFile };
}

module.exports = { createLinkedFiles, TEXT_VIEW_MAX_BYTES };
