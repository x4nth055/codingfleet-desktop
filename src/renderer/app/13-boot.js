'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Wiring events, updates, crash reports, and starting the app. Loaded last.

// ── Wiring ─────────────────────────────────────────────────────────────────
function wire() {
  $('brandLogo').innerHTML = LOGO;
  $('plusIcon').innerHTML = ICON.plus;
  $('settingsClose').innerHTML = ICON.x;
  $('newSession').addEventListener('click', newSession);

  const prompt = $('prompt');
  prompt.addEventListener('input', () => {
    rememberDraft();
    autosize();
    updateSendButton();
  });
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });
  $('send').addEventListener('click', () => ($('send').classList.contains('stop') ? stopRun() : sendMessage()));
  $('folderButton').addEventListener('click', () => ($('folderMenu').hidden ? openFolderMenu() : closeMenus()));
  $('changesPill').addEventListener('click', () => ($('changesMenu').hidden ? openChangesMenu() : closeMenus()));
  $('attachButton').addEventListener('click', () => ($('attachMenu').hidden ? openAttachMenu() : closeMenus()));
  $('dropIcon').innerHTML = ICON.upload;
  wireDrop();
  $('scrollDown').innerHTML = ICON.caret;
  $('scrollDown').addEventListener('click', scrollToBottom);
  $('transcript').addEventListener('scroll', onTranscriptScroll);
  $('browserSignIn').addEventListener('click', signInWithBrowser);
  $('modelButton').addEventListener('click', () => ($('modelMenu').hidden ? openModelMenu() : closeMenus()));
  $('permButton').addEventListener('click', () => ($('permMenu').hidden ? openPermMenu() : closeMenus()));
  $('effortButton').addEventListener('click', () => ($('effortMenu').hidden ? openEffortMenu() : closeMenus()));
  $('modelSearch').addEventListener('input', (event) => renderModelList(event.target.value));
  $('modelSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = $('modelList').querySelector('.menu-item');
      if (first) first.click();
    }
  });

  $('settingsClose').addEventListener('click', closeSettings);
  for (const button of document.querySelectorAll('#settingsTabs [data-tab]')) {
    button.prepend(icon(button.dataset.icon));
    button.addEventListener('click', () => showSettingsTab(button.dataset.tab));
  }
  $('settingsCancel').addEventListener('click', closeSettings);
  $('settingsSave').addEventListener('click', saveSettings);
  $('keyRemove').addEventListener('click', removeKey);
  $('keyShow').addEventListener('click', () => {
    const input = $('keyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('keyShow').textContent = input.type === 'password' ? 'Show' : 'Hide';
  });
  $('keyInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveSettings();
  });
  $('settings').addEventListener('mousedown', (event) => {
    if (event.target === $('settings')) closeSettings();
  });

  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('.menu, .session-more, .pref-toggle, #modelButton, #effortButton, #permButton, #attachButton, #folderButton, #changesPill')) closeMenus();
  });
  document.addEventListener('click', (event) => {
    const img = event.target.closest('.markdown img, .tool-image');
    if (!img || img.classList.contains('broken')) return;
    openViewer({
      src: img.currentSrc || img.src,
      name: img.dataset.localPath || img.alt,
      full: img.dataset.local ? fullLocalImage(img) : null,
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      newSession();
    }
    // The shortcut every screenshot tool has: drag a region into the message.
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      takeScreenshot('region');
    }
    if (event.ctrlKey && event.key === ',') {
      event.preventDefault();
      openSettings(false);
    }
    if (event.key === 'Escape' && document.getElementById('viewer')) {
      closeViewer();
      return;
    }
    if (event.key === 'Escape') {
      if (S.panel.open && $('settings').hidden && document.activeElement !== $('prompt')) closePanel();
      closeMenus();
      if (!$('settings').hidden) closeSettings();
    }
  });
  // Links open in the browser (the main process refuses anything else).
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    if (/^https?:/i.test(link.href)) window.open(link.href);
  });

  cf.onRunEvent(onRunEvent);
  if (typeof cf.onBackground === 'function') cf.onBackground(onBackgroundChanged);
  if (typeof cf.onUpdate === 'function') cf.onUpdate(onUpdateStatus);
  if (typeof cf.onGitChanged === 'function') cf.onGitChanged(onGitChanged);
  cf.onOpenSession((sessionId) => {
    if (S.sessions.some((s) => s.id === sessionId)) selectSession(sessionId);
  });
  $('micButton').addEventListener('click', toggleVoice);
  renderMic();
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && voice.state === 'recording') stopVoice(true);
  });
  document.addEventListener('click', (event) => {
    if (quotaOpen && !event.target.closest('.quota')) {
      quotaOpen = false;
      const open = document.querySelector('.quota.open');
      if (open) open.classList.remove('open');
    }
  });
  window.addEventListener('focus', () => scheduleLiveRefresh());
  // A window made smaller than the chosen panel width takes the panel back down.
  window.addEventListener('resize', () => { if (panelWidth != null) applyPanelWidth(panelWidth); });
  // Back online: fill in what a start without a connection could not load.
  window.addEventListener('online', () => {
    if (!S.settings.hasKey) return;
    if (S.current && loadFailures.has(S.current)) retryNow(S.current);
    if (!S.account) loadAccountSettings();
    ensureModels();
    loadCredits({ quiet: true });
    loadSessions({ quiet: true });
    call(cf.recoverRuns).catch(() => {});
  });
  scheduleLiveRefresh();
  setInterval(() => { if (S.settings.hasKey) loadCredits({ quiet: true }); }, CREDITS_REFRESH_MS);
  window.addEventListener('focus', () => {
    if (S.settings.hasKey && Date.now() - creditsLoadedAt > 10_000) loadCredits({ quiet: true });
  });
  setInterval(renderSidebar, 60_000); // keeps the "5m" labels honest
  setInterval(tickLoadRetry, 1000);
}

// Errors in this window go to the app's log, where a crash report can show them.
window.addEventListener('error', (event) => {
  if (typeof cf.logError === 'function') {
    cf.logError(event.error && event.error.stack ? event.error.stack : `${event.message} (${event.filename}:${event.lineno})`);
  }
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (typeof cf.logError === 'function') cf.logError(`unhandled rejection: ${(reason && reason.stack) || reason}`);
});

// ── Updates ────────────────────────────────────────────────────────────────
// Downloaded in the background by the main process (updater.js); installed
// only when the user restarts, from this banner or from Preferences.
let updateState = null;
let updateOffered = null;

function updateText(status) {
  if (!status) return '';
  switch (status.state) {
    case 'checking': return 'Checking for updates…';
    case 'current': return 'You have the latest version.';
    case 'available': return status.manual
      ? `Version ${status.version} is out. This Mac app cannot update itself: download it.`
      : `Version ${status.version} is available.`;
    case 'off': return 'Automatic updates are off.';
    case 'downloading': return `Downloading ${status.version || 'the update'}… ${status.percent || 0}%`;
    case 'ready': return `Version ${status.version} is ready. Restart to update.`;
    case 'unavailable': return `This copy does not update itself (${status.reason}).`;
    case 'error': return 'Could not check for updates just now.';
    default: return '';
  }
}

function onUpdateStatus(status) {
  updateState = status;
  // macOS: the app cannot install an update itself, so it points to the download.
  if (status.state === 'available' && status.manual && updateOffered !== status.version) {
    updateOffered = status.version;
    showBanner(`CodingFleet ${status.version} is out.`, [
      { label: 'Download', run: () => call(cf.downloadUpdate).catch((err) => showBanner(err.message)) },
    ], { label: 'Later' });
  }
  if (status.state === 'ready' && updateOffered !== status.version) {
    updateOffered = status.version;
    const busy = S.running.size ? ' A run in progress picks up again after the restart.' : '';
    showBanner(`CodingFleet ${status.version} is ready.${busy}`, [
      { label: 'Restart now', run: () => call(cf.installUpdate).catch((err) => showBanner(err.message)) },
    ], { label: 'Later' });
  }
  const line = document.getElementById('updateLine');
  if (line) renderUpdateRow(line.closest('.set-row'));
}

function renderUpdateRow(row) {
  if (!row) return;
  const status = updateState || {};
  const text = row.querySelector('.set-desc');
  text.textContent = `You have CodingFleet ${S.init.version || status.current || ''}. ${updateText(status)}`.trim();
  const button = row.querySelector('button');
  button.disabled = status.state === 'checking' || status.state === 'downloading' || status.state === 'unavailable';
  if (status.state === 'ready') {
    button.textContent = 'Restart to update';
    button.onclick = () => call(cf.installUpdate).catch((err) => showBanner(err.message));
  } else if (status.state === 'available') {
    button.textContent = 'Download';
    button.onclick = () => call(cf.downloadUpdate).then(onUpdateStatus);
  } else {
    button.textContent = 'Check now';
    button.onclick = () => call(cf.checkForUpdate).then(onUpdateStatus);
  }
}

// Asked once: the app checks for updates by itself only after a yes, so it
// never contacts the update server unless the user asked it to.
async function askAboutUpdates() {
  if (S.init.state.autoUpdate !== undefined || typeof cf.updateStatus !== 'function') return;
  let status = null;
  try { status = await call(cf.updateStatus); } catch { return; }
  if (!status || status.state === 'unavailable') return;
  const answer = (on) => {
    S.init.state.autoUpdate = on;
    cf.setState({ autoUpdate: on });
    hideBanner();
  };
  showBanner('Check for new versions of CodingFleet automatically? The app would ask GitHub every few '
    + 'hours, and download updates to install when you restart. You can change this in Preferences.', [
    { label: 'Yes, keep it up to date', run: () => answer(true) },
  ], { label: 'No', run: () => answer(false) });
}

// The app stopped unexpectedly since the window last loaded. Nothing is sent
// unless the user says so; the banner says what a report holds.
function offerCrashReport(crash) {
  if (!crash || typeof cf.sendCrashReport !== 'function') return;
  const when = crash.at ? ` (${fmtStamp(crash.at)})` : '';
  const what = crash.kind === 'renderer' ? 'The window stopped unexpectedly'
    : crash.kind === 'unresponsive' ? 'The window froze' : 'CodingFleet stopped unexpectedly';
  showBanner(`${what}${when}. Send a crash report? It holds the error and the app's recent log — `
    + 'never your messages, files or key.', [
    { label: 'Send report', run: async () => {
      try {
        await call(cf.sendCrashReport);
        showBanner('Thank you. The report was sent.');
      } catch (err) {
        showBanner(`The report could not be sent: ${err.message}`);
      }
    } },
    { label: 'Open logs', run: () => call(cf.openLogs).catch((err) => showBanner(err.message)) },
  ], { label: 'Do not send', run: () => cf.dismissCrash() });
}

async function boot() {
  S.init = await call(cf.init);
  document.body.classList.add(`platform-${S.init.platform}`);
  S.settings = S.init.settings;
  S.model = newSessionModel();
  S.permission = S.init.state.permissionMode || 'ask';
  S.draftCwd = S.init.state.lastCwd || null;
  wire();
  restoreDraft();
  restorePanelWidth();
  renderAccount();
  renderMain();
  if (!S.settings.hasKey) {
    renderSidebar();
    openSettings(true);
    return;
  }
  // A crash report outranks the update question; the question waits a start.
  if (S.init.crash) offerCrashReport(S.init.crash);
  else askAboutUpdates();
  await loadAll();
  if (S.init.openSession) await selectSession(S.init.openSession);
  await call(cf.recoverRuns);
  if (S.init.shotScroll === 'top') {
    $('transcript').scrollTop = 0;
    onTranscriptScroll();
  }
  if (S.init.shotModel) {
    S.model = S.init.shotModel; // for this window only; not saved
    renderComposer();
  }
  if (S.init.shotMenu === 'folder') openFolderMenu();
  if (S.init.shotMenu === 'changes') {
    // The pill is drawn by a lookup that has to come back first.
    setTimeout(() => openChangesMenu(), 1500);
    setTimeout(() => { const row = document.querySelector('#changesList .file-row'); if (row) row.click(); }, 2500);
  }
  if (S.init.shotMenu === 'attach') openAttachMenu();
  if (S.init.shotMenu === 'shot') {
    openAttachMenu();
    openScreenshotMenu();
  }
  // Development: start a real session from the composer, as a user would.
  if (S.init.shotCwd) {
    S.draftCwd = S.init.shotCwd;
    renderMain();
  }
  if (typeof S.init.shotAttach === 'string') await attachPaths(S.init.shotAttach.split('|').filter(Boolean));
  if (S.init.shotMenu === 'agents' && S.current) {
    const first = [...agentsOf(S.current).keys()][0];
    if (first) openPanel(first);
  }
  if (S.init.shotMenu === 'quota') {
    quotaOpen = true;
    renderAccount();
  }
  if (S.init.shotMenu === 'models') openModelMenu();
  if (S.init.shotMenu === 'effort') openEffortMenu();
  if (S.init.shotMenu === 'permissions') openPermMenu();
  if (S.init.shotMenu === 'settings') openSettings(false);
  if (['privacy', 'preferences', 'mcp'].includes(S.init.shotMenu)) openSettings(false, S.init.shotMenu);
  if (S.init.shotMenu === 'copy') {
    setTimeout(() => { const button = document.querySelector('.code-copy'); if (button) button.click(); }, 2500);
  }
  if (S.init.shotMenu === 'prefmodel') {
    openSettings(false, 'preferences');
    setTimeout(() => { const toggle = document.querySelector('.pref-toggle'); if (toggle) toggle.click(); }, 1500);
  }
  if (S.init.shotMenu === 'delete' && currentSession()) confirmDelete(currentSession());
  if (S.init.shotMenu === 'rename' && S.current) startRename(S.current);
  if (S.init.shotMenu === 'session' && S.sessions.length) {
    const more = document.querySelector('.session.selected .session-more') || document.querySelector('.session-more');
    if (more) more.click();
  }
  if (S.init.shotMenu === 'viewer') {
    setTimeout(() => { const card = document.querySelector('.msg-image'); if (card) card.click(); }, 1500);
  }
  if (S.init.shotPrompt) {
    $('prompt').value = S.init.shotPrompt;
    autosize();
    updateSendButton();
    sendMessage();
  }
  $('prompt').focus();
}

boot().catch((err) => {
  document.body.textContent = `CodingFleet could not start: ${err.message}`;
});
