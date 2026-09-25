'use strict';
// Renders build/icon.svg to the PNGs every build uses:
//   npx electron scripts/make-icon.cjs
// build/icon.png (1024 px) is what electron-builder turns into the Windows
// .ico, the macOS .icns and the Linux icons; build/icon-256.png is the window
// icon on Linux. Run it again after changing the SVG, and commit the PNGs.
//
// The SVG is drawn onto a canvas of the exact size, not captured from a
// window: a window is clamped to the screen, a canvas is not.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html,<!doctype html><title>icon</title>');
    const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
    for (const [size, name] of [[1024, 'icon.png'], [256, 'icon-256.png']]) {
      const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = ${size};
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, ${size}, ${size});
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('the SVG did not load'));
        img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
      })`);
      fs.writeFileSync(path.join(BUILD, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`wrote build/${name}`);
    }
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
