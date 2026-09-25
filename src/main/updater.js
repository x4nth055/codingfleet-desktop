'use strict';
// Updates: checked at start and every six hours, downloaded in the background,
// installed when the user restarts — never while they work unless they ask.
//
// Only an installed build updates itself. A development run has nothing to
// replace, and the portable .exe cannot replace itself: both say so in the log
// and carry on. The feed is the project's GitHub releases (package.json
// "publish"), which electron-builder writes into the build; a feed that cannot
// be reached (offline, no release yet, a private repository) is logged, never
// shown as an error. macOS updates only a signed and notarized app.
const { app } = require('electron');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function createUpdater({ log, send, enabled }) {
  let updater = null;
  let status = { state: 'idle', version: null, percent: null, available: false };

  const tell = (next) => {
    status = { ...status, ...next };
    send('update:status', status);
  };

  function why() {
    if (!app.isPackaged) return 'a development run';
    if (process.env.PORTABLE_EXECUTABLE_DIR) return 'the portable .exe';
    return null;
  }

  function start() {
    const reason = why();
    if (reason) {
      log.info(`updates are off: ${reason} does not update itself`);
      tell({ state: 'unavailable', reason });
      return;
    }
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.logger = {
      info: (m) => log.info(`update: ${m}`),
      warn: (m) => log.warn(`update: ${m}`),
      error: (m) => log.error(`update: ${m}`),
      debug: () => {},
    };
    updater.autoDownload = enabled();
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => tell({ state: 'checking' }));
    updater.on('update-not-available', () => tell({ state: 'current', available: false }));
    updater.on('update-available', (info) => tell({
      state: enabled() ? 'downloading' : 'available', version: info.version, available: true, percent: 0,
    }));
    updater.on('download-progress', (p) => tell({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    updater.on('update-downloaded', (info) => {
      log.info(`update ${info.version} downloaded; installs on restart`);
      tell({ state: 'ready', version: info.version, percent: 100 });
    });
    updater.on('error', (err) => {
      log.warn(`update check failed: ${err && err.message}`);
      tell({ state: 'error' });
    });
    check();
    setInterval(check, CHECK_EVERY_MS).unref?.();
  }

  function check() {
    if (!updater) return status;
    updater.autoDownload = enabled();
    updater.checkForUpdates().catch(() => { /* reported through 'error' */ });
    return status;
  }

  /** Download a version found while automatic updates were off. */
  function download() {
    if (updater && status.available && status.state === 'available') {
      tell({ state: 'downloading', percent: 0 });
      updater.downloadUpdate().catch(() => {});
    }
    return status;
  }

  /** Restart into the downloaded version. */
  function install() {
    if (!updater || status.state !== 'ready') throw new Error('No update is ready to install.');
    log.info(`restarting into ${status.version}`);
    // isSilent: no installer window; isForceRunAfter: the app opens again.
    setImmediate(() => updater.quitAndInstall(true, true));
    return true;
  }

  return { start, check, download, install, status: () => status };
}

module.exports = { createUpdater };
