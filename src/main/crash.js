'use strict';
// Crashes: caught, logged, and offered to the user to send.
//
// Nothing is sent without asking. A crash is written down (crash.json in the
// app's data folder) and, the next time the window loads — right away after
// the window itself crashed and was reloaded, or on the next start after the
// whole app died — the window asks whether to send a report: the error, the
// app's version and platform, and the tail of its own log (see core/log.js,
// which never holds messages, file contents or keys). Native crashes also
// leave a minidump in the crash dumps folder, kept on this computer only.
const { app, crashReporter } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Before anything else runs: a crash during start-up still leaves a dump.
function startNativeDumps() {
  try {
    crashReporter.start({ uploadToServer: false, compress: true });
  } catch { /* an unsupported platform keeps working without dumps */ }
}

function createCrashes({ log }) {
  const marker = () => path.join(app.getPath('userData'), 'crash.json');
  const scanFile = () => path.join(app.getPath('userData'), 'crash-scan.json');

  function read(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  function write(file, value) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
    } catch (err) {
      log.warn('could not write', file, err.message);
    }
  }

  /** Remember a crash for the window to offer. The first one since the last offer is kept. */
  function record(kind, error) {
    const details = error instanceof Error
      ? { message: `${error.name}: ${error.message}`, stack: error.stack || '' }
      : { message: String((error && error.message) || error || ''), stack: '' };
    log.error(`crash (${kind})`, details.stack || details.message);
    if (read(marker())) return;
    write(marker(), {
      kind,
      ...details,
      at: new Date().toISOString(),
      version: app.getVersion(),
      platform: `${process.platform} ${os.release()} ${process.arch}`,
    });
  }

  // Native dumps newer than the last look: the whole app died in C++, and no
  // JavaScript handler ran to write the marker.
  function newDumps() {
    const since = Number((read(scanFile()) || {}).at) || Date.now();
    write(scanFile(), { at: Date.now() });
    let dir;
    try { dir = app.getPath('crashDumps'); } catch { return []; }
    const found = [];
    const walk = (folder, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
        else if (entry.name.endsWith('.dmp')) {
          try { if (fs.statSync(full).mtimeMs > since) found.push(full); } catch { /* gone */ }
        }
      }
    };
    walk(dir, 0);
    return found;
  }

  /** The crash waiting to be offered, or null. Looked at once per window load. */
  function pending() {
    const dumps = newDumps();
    if (dumps.length && !read(marker())) {
      record('main', { message: `CodingFleet stopped unexpectedly (${dumps.length} crash dump${dumps.length === 1 ? '' : 's'} on this computer).` });
    }
    return read(marker());
  }

  function clear() {
    try { fs.unlinkSync(marker()); } catch { /* already gone */ }
  }

  /** Catch what can be caught, for the process and for one window. */
  function watch(getWindow) {
    process.on('uncaughtException', (err) => record('main', err));
    process.on('unhandledRejection', (reason) => log.warn('unhandled rejection', reason));
    app.on('render-process-gone', (_event, contents, details) => {
      log.error('window process gone', details);
      if (details.reason === 'clean-exit') return;
      record('renderer', { message: `The window stopped: ${details.reason} (exit code ${details.exitCode}).` });
      const win = getWindow();
      // A blank window is no use to anyone: draw it again, which then offers the report.
      if (win && !win.isDestroyed() && contents === win.webContents) setTimeout(() => win.reload(), 500);
    });
    app.on('child-process-gone', (_event, details) => log.warn('child process gone', details));
  }

  /** A window that stays frozen for 30 seconds counts; a hiccup does not. */
  function watchWindow(win) {
    let timer = null;
    win.on('unresponsive', () => {
      log.warn('window unresponsive');
      clearTimeout(timer);
      timer = setTimeout(() => record('unresponsive', { message: 'The window stopped responding for 30 seconds.' }), 30000);
    });
    win.on('responsive', () => {
      clearTimeout(timer);
      log.info('window responsive again');
    });
  }

  return { record, pending, clear, watch, watchWindow };
}

module.exports = { startNativeDumps, createCrashes };
