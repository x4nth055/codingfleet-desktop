'use strict';
// The real app, started for recording the promo video:
//   npx electron scripts/promo [--scale=1.5]
// - its own profile (a temporary folder), so no real session or key is used;
// - the API is the scripted mock (mock-api.cjs, turns.cjs);
// - a control server on 127.0.0.1:47800 that the scene scripts drive
//   (run JavaScript in the window, send input, take pictures, record video).
const { app, BrowserWindow, clipboard, ClipboardItem } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SCALE = Number(arg('scale', '1.5'));
const PORT = Number(arg('control', '47800'));
const PROFILE = arg('profile', fs.mkdtempSync(path.join(os.tmpdir(), 'cf-promo-')));

app.setPath('userData', PROFILE);
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));
// Keep painting at full rate while the window is covered or not focused.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const { createMock } = require('./mock-api.cjs');
const { turns, sessions, localState } = require('./turns.cjs');

const mock = createMock({ turns, sessions });

(async () => {
  const base = await mock.listen();
  // The app keeps talking to codingfleet.com as far as it can tell (that is
  // what its account card shows); this process answers instead.
  const realFetch = globalThis.fetch;
  const REAL = 'https://codingfleet.com/v1';
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return realFetch(url.startsWith(REAL) ? base + url.slice(REAL.length) : input, init);
  };
  process.env.CODINGFLEET_API_KEY = 'cf_sk_promo_demo_key_0000';
  // The folders and preferences the sidebar knows, as a returning user has them.
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(path.join(PROFILE, 'state.json'), JSON.stringify(localState(), null, 2));
  require('../../src/main/main.js');
  startControl();
  // 16:9, the video's shape: 1280x720 at the default scale is 1920x1080.
  app.whenReady().then(() => {
    const fit = () => {
      const w = win();
      if (!w) return setTimeout(fit, 100);
      w.setContentSize(Number(arg('width', '1280')), Number(arg('height', '720')));
      w.setPosition(0, 0);
      return undefined;
    };
    fit();
  });
})();

// ── Control server ─────────────────────────────────────────────────────────
const win = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
let recording = null;
let savedClipboard = null;

function startRecording(file, fps = 30) {
  const w = win();
  const size = w.getContentSize().map((n) => Math.round(n * SCALE));
  // Even sizes for the encoder.
  const [width, height] = size.map((n) => n - (n % 2));
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-pix_fmt', 'yuv444p',
    file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  let latest = null;
  let frames = 0;
  const started = Date.now();
  w.webContents.beginFrameSubscription(false, (image) => { latest = image; });
  w.webContents.invalidate();
  const blank = Buffer.alloc(width * height * 4);
  const tick = () => {
    if (!recording) return;
    // Frames are written on the clock, so the video runs at real speed.
    const due = Math.floor(((Date.now() - started) / 1000) * fps) + 1;
    while (frames < due) {
      let buf = blank;
      if (latest) {
        const s = latest.getSize();
        const img = s.width === width && s.height === height ? latest : latest.resize({ width, height });
        buf = img.toBitmap();
      }
      ffmpeg.stdin.write(buf);
      frames++;
    }
    recording.timer = setTimeout(tick, 1000 / fps / 2);
  };
  recording = { ffmpeg, file, timer: null, started, w };
  tick();
  return { width, height };
}

function stopRecording() {
  if (!recording) return Promise.resolve(null);
  const { ffmpeg, file, timer, w, started } = recording;
  recording = null;
  clearTimeout(timer);
  try { w.webContents.endFrameSubscription(); } catch { /* closed */ }
  return new Promise((resolve) => {
    ffmpeg.on('close', () => resolve({ file, seconds: (Date.now() - started) / 1000 }));
    ffmpeg.stdin.end();
  });
}

function startControl() {
  http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* none */ }
    const reply = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data === undefined ? null : data));
    };
    try {
      const w = win();
      switch (req.url) {
        case '/ready': return reply({ ready: Boolean(w), profile: PROFILE });
        case '/eval': return reply(await w.webContents.executeJavaScript(body.js, true));
        case '/shot': {
          const image = await w.webContents.capturePage();
          fs.writeFileSync(body.file, image.toPNG());
          return reply({ file: body.file, size: image.getSize() });
        }
        case '/input':
          for (const e of body.events || [body]) w.webContents.sendInputEvent(e);
          return reply(true);
        case '/size':
          w.setContentSize(body.width, body.height);
          if (body.center !== false) w.center();
          return reply(w.getContentSize());
        case '/focus': w.show(); w.focus(); w.webContents.focus(); return reply(true);
        // An image on the clipboard, for a real Ctrl+V into the prompt.
        // What was there before is kept, and put back by /clipboard/restore.
        case '/clipboard': {
          if (!savedClipboard) {
            // Each saved type's payload is read now: the items only stay valid
            // while the clipboard holds them.
            savedClipboard = await Promise.all((await clipboard.read()).map(async (item) => {
              const entries = await Promise.all(item.types.map(async (t) => [t, await item.getType(t)]));
              return new ClipboardItem(Object.fromEntries(entries));
            }));
          }
          const png = fs.readFileSync(body.image);
          await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
          return reply((await clipboard.read()).flatMap((item) => item.types));
        }
        case '/clipboard/restore':
          if (savedClipboard) {
            if (savedClipboard.length) await clipboard.write(savedClipboard);
            else clipboard.clear();
            savedClipboard = null;
          }
          return reply(true);
        case '/record/start': return reply(startRecording(body.file, body.fps));
        case '/record/stop': return reply(await stopRecording());
        case '/mock/log': return reply(mock.log.slice(-200));
        case '/quit': reply(true); setTimeout(() => app.exit(0), 100); return undefined;
        default: return reply({ error: 'unknown' }, 404);
      }
    } catch (err) {
      return reply({ error: err.message, stack: err.stack }, 500);
    }
  }).listen(PORT, '127.0.0.1');
}
