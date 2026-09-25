'use strict';
// Updates: checked at start and every six hours, downloaded in the background,
// installed when the user restarts — never while they work unless they ask.
//
// With "Update automatically" off the app does not even check on its own: it
// contacts GitHub only when the user presses "Check now".
//
// Only an installed build updates itself. A development run has nothing to
// replace, and the portable .exe cannot replace itself: both say so in the log
// and carry on. The feed is the project's GitHub releases (package.json
// "publish"), which electron-builder writes into the build; a feed that cannot
// be reached (offline, no release yet, a private repository) is logged, never
// shown as an error.
//
// macOS installs only an update signed by the same Apple developer, and this
// app is not signed for macOS. There the updater only finds out that a new
// version exists, and the window offers the download page instead.
const { app, shell } = require('electron');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const pkg = require('../../package.json');

const feed = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
const RELEASES_URL = feed.owner && feed.repo
  ? `https://github.com/${feed.owner}/${feed.repo}/releases/latest`
  : 'https://codingfleet.com';

function createUpdater({ log, send, enabled }) {
  let updater = null;
  let timer = null;
  const manualOnly = process.platform === 'darwin';
  let status = { state: 'idle', version: null, percent: null, available: false, manual: manualOnly };

  const tell = (next) => {
    status = { ...status, ...next };
    send('update:status', status);
  };

  function why() {
    if (!app.isPackaged) return 'a development run';
    if (process.env.PORTABLE_EXECUTABLE_DIR) return 'the portable .exe';
    return null;
  }

  function load() {
    if (updater) return updater;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.logger = {
      info: (m) => log.info(`update: ${m}`),
      warn: (m) => log.warn(`update: ${m}`),
      error: (m) => log.error(`update: ${m}`),
      debug: () => {},
    };
    updater.autoInstallOnAppQuit = !manualOnly;
    updater.on('checking-for-update', () => tell({ state: 'checking' }));
    updater.on('update-not-available', () => tell({ state: 'current', available: false }));
    updater.on('update-available', (info) => tell({
      state: updater.autoDownload ? 'downloading' : 'available', version: info.version, available: true, percent: 0,
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
    return updater;
  }

  function start() {
    const reason = why();
    if (reason) {
      log.info(`updates are off: ${reason} does not update itself`);
      tell({ state: 'unavailable', reason });
      return;
    }
    schedule();
  }

  // Automatic checks only while the user wants them.
  function schedule() {
    clearInterval(timer);
    timer = null;
    if (!enabled()) {
      tell({ state: status.available ? status.state : 'off' });
      return;
    }
    check();
    timer = setInterval(() => { if (enabled()) check(); }, CHECK_EVERY_MS);
    timer.unref?.();
  }

  function check() {
    if (why()) return status;
    const u = load();
    u.autoDownload = enabled() && !manualOnly;
    u.checkForUpdates().catch(() => { /* reported through 'error' */ });
    return status;
  }

  /** Download a version found while automatic updates were off; on macOS, open the download page. */
  function download() {
    if (manualOnly) {
      shell.openExternal(RELEASES_URL);
      return status;
    }
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

  return { start, check, download, install, schedule, status: () => status };
}

module.exports = { createUpdater, RELEASES_URL };
