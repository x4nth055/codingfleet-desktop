'use strict';
// Screenshots: a whole screen, one window, or a region the user drags.
//
// A region is taken from a picture, not from the live desktop: every screen is
// captured first, and each one gets an overlay window showing its own frozen
// copy. The user drags on that, so what they select is exactly what was there,
// and nothing that appears while they drag — a notification, a menu closing —
// can get into the file. It also means no second capture has to be timed
// against the overlays disappearing.
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const path = require('path');

const images = require('../core/images');

// The app's own window is out of the way before a screen is captured.
const HIDE_SETTLE_MS = 350;
// What the overlay shows. It only has to look right, so it is a JPEG of the
// screen at its logical size, not the full-resolution capture it crops from.
const OVERLAY_QUALITY = 88;
// A drag shorter than this on both sides is a click, not a selection.
const MIN_REGION_PX = 6;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pixelSize = (display) => ({
  width: Math.max(1, Math.round(display.size.width * (display.scaleFactor || 1))),
  height: Math.max(1, Math.round(display.size.height * (display.scaleFactor || 1))),
});

function sourceFor(sources, display, index) {
  return sources.find((s) => String(s.display_id) === String(display.id)) || sources[index] || sources[0];
}

/** Every screen, captured at its own resolution. [{ display, image }] */
async function captureScreens(displays) {
  const size = displays.reduce((big, display) => {
    const px = pixelSize(display);
    return { width: Math.max(big.width, px.width), height: Math.max(big.height, px.height) };
  }, { width: 1, height: 1 });
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  return displays.map((display, index) => ({ display, image: sourceFor(sources, display, index).thumbnail }))
    .filter((shot) => shot.image && !shot.image.isEmpty());
}

/** The screens and the open windows the user can choose from. */
async function listTargets(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const here = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : primary;
  const screens = displays.map((display, index) => ({
    id: String(display.id),
    label: displays.length === 1 ? 'The screen' : `Screen ${index + 1}`,
    width: display.size.width,
    height: display.size.height,
    primary: display.id === primary.id,
    current: display.id === here.id,
  }));
  let windows = [];
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: true,
    });
    windows = sources
      .filter((source) => source.name && source.name !== 'Entire screen')
      .map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : null,
        icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      }));
  } catch {
    windows = [];
  }
  return { screens, windows };
}

/** One whole screen. `displayId` defaults to the screen the app is on. */
async function captureScreen(win, displayId) {
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => String(d.id) === String(displayId))
    || (win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay());
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
  if (visible) win.hide();
  try {
    await wait(HIDE_SETTLE_MS);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: pixelSize(display) });
    const source = sourceFor(sources, display, displays.indexOf(display));
    if (!source || source.thumbnail.isEmpty()) throw new Error('The screen could not be captured.');
    return source.thumbnail;
  } finally {
    if (visible) {
      win.show();
      win.focus();
    }
  }
}

/** One window, by the id listTargets gave. Occluded windows capture too. */
async function captureWindow(sourceId) {
  const size = screen.getAllDisplays().reduce((big, display) => {
    const px = pixelSize(display);
    return { width: Math.max(big.width, px.width), height: Math.max(big.height, px.height) };
  }, { width: 1920, height: 1080 });
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size });
  const source = sources.find((s) => s.id === sourceId);
  if (!source) throw new Error('That window is not open any more.');
  if (source.thumbnail.isEmpty()) throw new Error('That window could not be captured.');
  return source.thumbnail;
}

function overlayFor(shot, alone) {
  const { bounds } = shot.display;
  const overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#000000',
    title: 'CodingFleet — select a region',
    webPreferences: {
      preload: path.join(__dirname, 'region-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Above the taskbar and every other window, including full-screen apps.
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'region.html'));
  overlay.webContents.once('did-finish-load', () => {
    if (overlay.isDestroyed()) return;
    overlay.webContents.send('region:image', {
      url: shot.image.toJPEG(OVERLAY_QUALITY).toString('base64'),
      alone,
    });
    overlay.show();
    overlay.focus();
  });
  return overlay;
}

/**
 * A region the user drags out, as a picture, or null when they cancelled.
 * The rectangle comes back in the overlay's own pixels, which are the screen's
 * logical pixels; the capture it is cut from is in real ones.
 */
async function captureRegion(win) {
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
  if (visible) win.hide();
  let shots;
  try {
    await wait(HIDE_SETTLE_MS);
    shots = await captureScreens(screen.getAllDisplays());
  } catch (err) {
    if (visible) win.show();
    throw err;
  }
  if (!shots.length) {
    if (visible) win.show();
    throw new Error('The screen could not be captured.');
  }

  const overlays = shots.map((shot) => ({ shot, window: overlayFor(shot, shots.length === 1) }));
  const picked = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('region:done', onDone);
      ipcMain.removeListener('region:cancel', onCancel);
      for (const { window } of overlays) {
        window.removeAllListeners('closed');
        if (!window.isDestroyed()) window.destroy();
      }
      resolve(value);
    };
    const onDone = (event, rect) => {
      const hit = overlays.find((o) => !o.window.isDestroyed() && o.window.webContents === event.sender);
      finish(hit ? { shot: hit.shot, rect: rect || {} } : null);
    };
    const onCancel = () => finish(null);
    ipcMain.on('region:done', onDone);
    ipcMain.on('region:cancel', onCancel);
    for (const { window } of overlays) window.on('closed', onCancel);
  });

  if (visible) {
    win.show();
    win.focus();
  }
  if (!picked) return null;

  const { display, image } = picked.shot;
  const box = images.cropBox(picked.rect, display.bounds, image.getSize(), MIN_REGION_PX);
  if (!box) return null;
  const cut = image.crop(box);
  return cut.isEmpty() ? null : cut;
}

module.exports = { listTargets, captureScreen, captureWindow, captureRegion, MIN_REGION_PX };
