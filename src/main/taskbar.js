'use strict';
// What the taskbar (or the Dock) says about the agent, for someone in another
// window: a moving bar while a run goes, and a mark while one waits for an
// approval. Windows shows both on the app's taskbar button; macOS and Linux
// get a badge with the number of approvals waiting.

// A 16x16 amber dot with a dark ring, drawn by hand: nativeImage reads no SVG.
function overlayDot(nativeImage) {
  const size = 16;
  const data = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      // BGRA. Amber inside, a dark ring so it reads on any taskbar colour.
      const inside = Math.max(0, Math.min(1, 6.2 - d));
      const ring = Math.max(0, Math.min(1, 7.6 - d));
      const alpha = Math.max(inside, ring);
      if (!alpha) continue;
      const mix = ring > 0 && inside < 1 ? inside : 1;
      data[i] = Math.round(0x1a * (1 - mix) + 0x24 * mix);       // B
      data[i + 1] = Math.round(0x1a * (1 - mix) + 0xb4 * mix);   // G
      data[i + 2] = Math.round(0x1a * (1 - mix) + 0xf5 * mix);   // R
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(data, { width: size, height: size });
}

/**
 * @param {{ app: Electron.App, nativeImage: typeof Electron.nativeImage,
 *           getWindow: () => Electron.BrowserWindow | null, platform?: string }} o
 */
function createTaskbar({ app, nativeImage, getWindow, platform = process.platform }) {
  let last = '';
  let dot = null;

  /** @param {{ running: number, waiting: number }} now */
  function sync({ running, waiting }) {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const key = `${running > 0}|${waiting}`;
    if (key === last) return;
    last = key;
    try {
      if (waiting > 0) win.setProgressBar(1, { mode: 'paused' });
      else if (running > 0) win.setProgressBar(2, { mode: 'indeterminate' });
      else win.setProgressBar(-1, { mode: 'none' });
      if (platform === 'win32') {
        if (waiting > 0) {
          if (!dot) dot = overlayDot(nativeImage);
          win.setOverlayIcon(dot, waiting === 1 ? 'Waiting for your approval' : `${waiting} approvals waiting`);
        } else {
          win.setOverlayIcon(null, '');
        }
      } else if (typeof app.setBadgeCount === 'function') {
        app.setBadgeCount(waiting);
      }
    } catch { /* a taskbar that cannot show this is not worth an error */ }
  }

  return { sync };
}

module.exports = { createTaskbar, overlayDot };
