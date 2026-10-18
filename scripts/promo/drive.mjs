// Driving the promo app like a person would: a visible cursor that glides to
// what it clicks, real mouse and keyboard events, and typing at human speed.
import { ctl } from './ctl.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const js = (code) => ctl('eval', { js: code });

// The cursor is drawn by the page (a recording has no system cursor).
const CURSOR = `(() => {
  if (document.getElementById('promo-cursor')) return true;
  const style = document.createElement('style');
  style.textContent = \`
    #promo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
      width: 22px; height: 22px; transform: translate(-100px, -100px); will-change: transform;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); transition: opacity .25s; }
    #promo-cursor svg { display: block; transform-origin: 3px 2px; transition: transform .12s ease; }
    #promo-cursor.down svg { transform: scale(.82); }
    .promo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 36px; height: 36px;
      margin: -18px 0 0 -18px; border-radius: 50%; border: 2px solid rgba(160, 150, 255, .9);
      animation: promo-ripple .5s ease-out forwards; }
    @keyframes promo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
  \`;
  document.head.appendChild(style);
  const c = document.createElement('div');
  c.id = 'promo-cursor';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.2 14.2 L10 20.5 L12.8 19.3 L10.1 13.2 L15.8 13.2 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  window.__cursor = { x: -100, y: -100 };
  window.__cursorTo = (x, y, ms) => new Promise((resolve) => {
    const from = { ...window.__cursor };
    const t0 = performance.now();
    const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const k = ease(t);
      // A slight arc, like a hand moving a mouse.
      const arc = Math.sin(Math.PI * t) * Math.min(40, Math.hypot(x - from.x, y - from.y) * .08);
      window.__cursor = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k - arc };
      c.style.transform = 'translate(' + window.__cursor.x + 'px,' + window.__cursor.y + 'px)';
      if (t < 1) requestAnimationFrame(step); else resolve(true);
    };
    requestAnimationFrame(step);
  });
  window.__ripple = (x, y) => {
    const r = document.createElement('div');
    r.className = 'promo-ripple';
    r.style.left = x + 'px'; r.style.top = y + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
  };
  // Approvals and finished runs would otherwise raise system notifications.
  window.Notification = function Notification() {};
  // The layout's outer boxes never scroll on their own, but a menu item
  // scrolled into view can nudge them; a recording keeps them in place.
  const roots = [document.documentElement, document.body, document.querySelector('.app'), document.querySelector('.main')];
  window.__nudged = [];
  document.addEventListener('scroll', (event) => {
    const el = event.target === document ? document.documentElement : event.target;
    if (roots.includes(el) && el.scrollTop) {
      window.__nudged.push((el.className || el.tagName) + ':' + el.scrollTop);
      el.scrollTop = 0;
    }
  }, true);
  return true;
})()`;

export async function setup() {
  await js(CURSOR);
}

export async function showCursor(visible = true) {
  await js(`document.getElementById('promo-cursor').style.opacity = ${visible ? 1 : 0}`);
}

// The centre (or a point inside) of the first element matching a selector, or
// of the first element whose text matches.
export async function pointOf(target, { dx = 0.5, dy = 0.5, text } = {}) {
  if (Array.isArray(target)) return { x: target[0], y: target[1] };
  const found = await js(`(() => {
    const list = [...document.querySelectorAll(${JSON.stringify(target)})].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && getComputedStyle(el).visibility !== 'hidden';
    });
    const want = ${JSON.stringify(text || null)};
    const el = want ? list.find((e) => e.textContent.trim().includes(want)) : list[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * ${dx}, y: r.top + r.height * ${dy} };
  })()`);
  if (!found) throw new Error(`Nothing on screen matches ${target}${text ? ` "${text}"` : ''}`);
  return found;
}

export async function moveTo(target, { ms = 650, ...opts } = {}) {
  const p = await pointOf(target, opts);
  await js(`window.__cursorTo(${p.x}, ${p.y}, ${ms})`);
  await ctl('input', { type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) });
  return p;
}

export async function click(target, opts = {}) {
  const p = await moveTo(target, opts);
  await sleep(opts.pause ?? 120);
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  await js(`document.getElementById('promo-cursor').classList.add('down'); window.__ripple(${p.x}, ${p.y})`);
  await ctl('input', { events: [
    { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
  ] });
  await sleep(110);
  await js("document.getElementById('promo-cursor').classList.remove('down')");
  return p;
}

// Typing at a person's pace: a little uneven, a pause after punctuation.
export async function type(text, { cps = 16 } = {}) {
  for (const ch of text) {
    if (ch === '\n') await key('Enter', ['shift']);
    else await ctl('input', { type: 'char', keyCode: ch });
    const base = 1000 / cps;
    const pause = /[.,!?]/.test(ch) ? 2.5 : ch === ' ' ? 1.3 : 0.6 + Math.random() * 0.8;
    await sleep(base * pause);
  }
}

export async function key(keyCode, modifiers = []) {
  await ctl('input', { events: [
    { type: 'keyDown', keyCode, modifiers },
    { type: 'keyUp', keyCode, modifiers },
  ] });
}

export async function waitFor(condition, { timeout = 30000, every = 100 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await js(`Boolean(${condition})`)) return true;
    await sleep(every);
  }
  throw new Error(`Timed out waiting for: ${condition}`);
}

// Glides the conversation so the last block containing `text` sits `offset`
// pixels below the top of the transcript.
export async function scrollToText(text, { offset = 24, ms = 900 } = {}) {
  return js(`(async () => {
    const box = document.getElementById('transcript');
    const hits = [...box.querySelectorAll('p, li, h1, h2, h3, table, .tool-group, .files-card, .bubble')]
      .filter((el) => el.textContent.includes(${JSON.stringify(text)}));
    const el = hits[hits.length - 1];
    if (!el) return false;
    const from = box.scrollTop;
    const to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight,
      from + el.getBoundingClientRect().top - box.getBoundingClientRect().top - ${offset}));
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ${ms});
        box.scrollTop = from + (to - from) * (1 - Math.pow(1 - t, 3));
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    return true;
  })()`);
}

export const shot = (file) => ctl('shot', { file });
export const record = (file, fps = 30) => ctl('record/start', { file, fps });
export const stop = () => ctl('record/stop');
export const focus = () => ctl('focus');
