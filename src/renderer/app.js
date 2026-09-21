'use strict';
/* global cf, marked, DOMPurify, hljs */

// ── Icons (constant markup only) ───────────────────────────────────────────
const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  dot: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4.5"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 12h10"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 3L5 13h6l-1 8 8-10h-6z"/></svg>',
  caret: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 15l4-5"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
  robot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/></svg>',
  panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  compress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>',
  wider: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6l-6 6 6 6M12 6l-6 6 6 6"/></svg>',
  narrower: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l6 6-6 6M12 6l6 6-6 6"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M14.5 8.5l2.5 2.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z"/><path d="M12 14v6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
};
const LOGO = '<svg viewBox="0 0 32 32"><defs><linearGradient id="cfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b9bff"/><stop offset="1" stop-color="#b48cff"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#cfg)"/><path d="M9.5 11l5 5-5 5M16.5 21h6.5" fill="none" stroke="#0b0d12" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name, className = 'icon') {
  const node = el('span', className);
  node.innerHTML = ICON[name];
  return node;
}

function chevron() {
  const holder = el('span');
  holder.innerHTML = ICON.chevron;
  return holder.firstChild;
}

async function call(fn, arg) {
  const res = await fn(arg);
  if (!res || !res.ok) {
    const err = new Error((res && res.error && res.error.message) || 'Something went wrong.');
    Object.assign(err, (res && res.error) || {});
    throw err;
  }
  return res.data;
}

const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const firstLine = (t) => String(t == null ? '' : t).split('\n')[0];
const lineCount = (t) => (t ? String(t).split('\n').length : 0);
const nowIso = () => new Date().toISOString();

// 213300 -> "213.3k", 400000 -> "400k", 1057587 -> "1.06M", 2.5e9 -> "2.5B"
function fmtCompact(n) {
  const value = Math.abs(Number(n) || 0);
  const sign = Number(n) < 0 ? '-' : '';
  const units = [[1e3, 'k', 1], [1e6, 'M', 2], [1e9, 'B', 2]];
  if (value < 1000) return `${sign}${Math.round(value)}`;
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, unit, digits] = units[i];
    if (value < size) continue;
    const shown = Number((value / size).toFixed(digits));
    // Rounding can carry into the next unit: 999,950 is "1M", not "1000k".
    if (shown >= 1000 && units[i + 1]) {
      return `${sign}${Number((value / units[i + 1][0]).toFixed(units[i + 1][2]))}${units[i + 1][1]}`;
    }
    return `${sign}${shown}${unit}`;
  }
  return `${sign}${Math.round(value)}`;
}

function fmtTokens(n) {
  return `${fmtCompact(n || 0)} tokens`;
}

// 80 -> "1m 20s", 5435 -> "1h 30m 35s", 9 -> "9s"
function fmtDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function relTime(iso) {
  const date = new Date(iso);
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function groupOf(iso) {
  const days = (startOfDay(new Date()) - startOfDay(iso)) / 86400000;
  if (days <= 0) return 'Today';
  if (days <= 1) return 'Yesterday';
  if (days <= 7) return 'Previous 7 days';
  return 'Older';
}

// "Today 14:32", "Yesterday 09:05", "Sep 12, 14:32"
function fmtStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return `${date.toLocaleDateString(undefined, options)}, ${time}`;
}

function clipText(text, max = 20000) {
  const t = text == null ? '' : String(text);
  return t.length > max ? `${t.slice(0, max)}\n… ${t.length - max} more characters` : t;
}

const md = (text) => DOMPurify.sanitize(marked.parse(text || '', { gfm: true, breaks: false }));

// Natural sizes of images already loaded, so a streamed answer that is drawn
// again keeps each image's box instead of collapsing and jumping.
const imageSizes = new Map();

// Code blocks: colors for the language, its name, and a copy button.
const HIGHLIGHT_LIMIT = 200_000;   // longer code is shown plain
const GUESS_LIMIT = 20_000;        // a block without a language is guessed up to this size
const LANGUAGE_NAMES = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript',
  tsx: 'TSX', py: 'Python', python: 'Python', sh: 'Shell', bash: 'Bash', shell: 'Shell', zsh: 'Shell',
  ps1: 'PowerShell', powershell: 'PowerShell', cs: 'C#', csharp: 'C#', cpp: 'C++', 'c++': 'C++', c: 'C',
  go: 'Go', rs: 'Rust', rust: 'Rust', rb: 'Ruby', ruby: 'Ruby', php: 'PHP', java: 'Java', kt: 'Kotlin',
  kotlin: 'Kotlin', swift: 'Swift', sql: 'SQL', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', ini: 'INI', md: 'Markdown', markdown: 'Markdown',
  dockerfile: 'Dockerfile', docker: 'Dockerfile', diff: 'Diff', makefile: 'Makefile', lua: 'Lua',
  dart: 'Dart', scala: 'Scala', r: 'R', vue: 'Vue', svelte: 'Svelte', graphql: 'GraphQL', nginx: 'Nginx',
};
// Languages highlight.js knows under another name.
const LANGUAGE_ALIASES = { vue: 'xml', svelte: 'xml', astro: 'xml', env: 'bash', dotenv: 'bash',
  jsonc: 'json', json5: 'json', hcl: 'ini', terraform: 'ini', tf: 'ini', zsh: 'bash', console: 'bash' };

function codeLanguage(code) {
  const match = /(?:^|\s)language-([\w#+.-]+)/.exec(code.className || '');
  return match ? match[1].toLowerCase() : '';
}

function highlightCode(code, lang) {
  if (typeof hljs === 'undefined') return '';
  const text = code.textContent;
  if (!text || text.length > HIGHLIGHT_LIMIT) return '';
  const name = LANGUAGE_ALIASES[lang] || lang;
  try {
    if (name && hljs.getLanguage(name)) {
      code.innerHTML = hljs.highlight(text, { language: name, ignoreIllegals: true }).value;
      return name;
    }
    if (!lang && text.length <= GUESS_LIMIT) {
      const guess = hljs.highlightAuto(text);
      if (guess.language && guess.relevance >= 5) {
        code.innerHTML = guess.value;
        return guess.language;
      }
    }
  } catch { /* shown plain */ }
  return '';
}

function languageLabel(lang, detected) {
  const key = lang || detected;
  if (!key) return 'Code';
  if (LANGUAGE_NAMES[key]) return LANGUAGE_NAMES[key];
  const known = typeof hljs !== 'undefined' && hljs.getLanguage(key);
  return (known && known.name) || key;
}

function decorateCode(node) {
  for (const pre of node.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code || pre.parentElement.classList.contains('code-block')) continue;
    const lang = codeLanguage(code);
    const detected = highlightCode(code, lang);
    code.classList.add('hljs');
    const block = el('div', 'code-block');
    const head = el('div', 'code-head');
    const copy = el('button', 'code-copy');
    copy.type = 'button';
    copy.title = 'Copy code';
    copy.innerHTML = ICON.copy;
    copy.append(el('span', null, 'Copy'));
    copy.addEventListener('click', async () => {
      const res = await cf.copyText(code.textContent);
      const label = copy.querySelector('span');
      copy.classList.toggle('done', Boolean(res && res.ok));
      label.textContent = res && res.ok ? 'Copied' : 'Could not copy';
      clearTimeout(copy.timer);
      copy.timer = setTimeout(() => {
        copy.classList.remove('done');
        label.textContent = 'Copy';
      }, 1600);
    });
    head.append(el('span', 'code-lang', languageLabel(lang, detected)), copy);
    pre.replaceWith(block);
    block.append(head, pre);
  }
}

function setMarkdown(node, text) {
  node.innerHTML = md(text);
  decorateCode(node);
  // A generated image is saved with the answer, and the model often shows it
  // again in its reply: each picture is shown once.
  const seen = new Set();
  for (const img of node.querySelectorAll('img')) {
    if (!seen.has(img.src)) {
      seen.add(img.src);
      continue;
    }
    const holder = img.closest('a') || img;
    const block = holder.parentElement;
    holder.remove();
    if (block && block !== node && !block.textContent.trim() && !block.querySelector('img')) block.remove();
  }
  // A path instead of a URL is a file in the session's folder: nothing serves
  // it, so the picture is read through the main process.
  for (const img of node.querySelectorAll('img')) adoptLocalImage(img);
  for (const img of node.querySelectorAll('img')) {
    img.decoding = 'async';
    if (img.dataset.local && !img.getAttribute('src')) continue;
    const known = imageSizes.get(img.src);
    if (known) {
      img.width = known.width;
      img.height = known.height;
      img.classList.add('ready');
      continue;
    }
    img.addEventListener('load', () => {
      imageSizes.set(img.src, { width: img.naturalWidth, height: img.naturalHeight });
      img.classList.add('ready');
    }, { once: true });
    img.addEventListener('error', () => img.classList.add('ready', 'broken'), { once: true });
  }
}

// ── Images in the session's folder ─────────────────────────────────────────
// The agent writes ![a chart](out/plot.png) for an image it made on this
// computer. Nothing serves that path and the window has no filesystem, so the
// main process reads the file and sends the picture back. Each one is fetched
// once and kept: streamed text redraws its markdown every frame.
const localImages = new Map();        // `${sessionId}\n${path}` -> entry
const LOCAL_IMAGE_RECHECK_MS = 4000;  // a file written again is picked up this soon

function localImageEntry(sessionId, src) {
  const key = `${sessionId}\n${src}`;
  let entry = localImages.get(key);
  if (!entry) {
    entry = { key, sessionId, src, url: null, error: null, at: 0, pending: null };
    localImages.set(key, entry);
  }
  if (!entry.pending && Date.now() - entry.at > LOCAL_IMAGE_RECHECK_MS) {
    entry.pending = call(cf.localImage, { sessionId, path: src }).then((data) => {
      entry.url = data.url;
      entry.error = null;
    }, (err) => {
      entry.url = null;
      entry.error = err.message || 'This image could not be read.';
    }).then(() => {
      entry.pending = null;
      entry.at = Date.now();
      for (const img of document.querySelectorAll('img[data-local]')) {
        if (img.dataset.local === key) paintLocalImage(img, entry);
      }
    });
  }
  return entry;
}

function paintLocalImage(img, entry) {
  if (entry.url) {
    img.classList.remove('broken');
    if (img.getAttribute('src') !== entry.url) {
      img.addEventListener('load', () => img.classList.add('ready'), { once: true });
      img.src = entry.url;
    }
  } else if (entry.error) {
    // In a tool step the picture is an extra, not the message: drop it rather
    // than leave a broken box where the agent already reported what it saw.
    if (img.classList.contains('tool-image')) {
      img.remove();
      return;
    }
    img.removeAttribute('src');
    img.classList.add('ready', 'broken');
    img.alt = `${entry.src} — ${entry.error}`;
    img.title = img.alt;
  }
}

// Makes one <img> a picture of a local file, or leaves it alone when its src
// is a URL. Returns whether it took it over.
function adoptLocalImage(img, sessionId = S.current) {
  const raw = img.getAttribute('src') || '';
  const src = window.CF_IMAGES ? CF_IMAGES.localImageSource(raw) : null;
  const folder = Boolean(sessionId && local(sessionId).cwd);
  if (!src) {
    // Half a path, because the answer is still being written. Keep it out of
    // sight instead of letting the window load it and draw a broken box.
    if (folder && raw && !/^[a-z][a-z0-9+.-]+:/i.test(raw)) {
      img.removeAttribute('src');
      img.hidden = true;
      return true;
    }
    return false;
  }
  if (!folder) return false;
  img.hidden = false;
  img.removeAttribute('src');
  img.dataset.local = `${sessionId}\n${src}`;
  img.dataset.localPath = src;
  img.alt = img.alt || src;
  img.title = src;
  paintLocalImage(img, localImageEntry(sessionId, src));
  return true;
}

// The same picture, larger, for the viewer.
function fullLocalImage(img) {
  const [sessionId, src] = String(img.dataset.local || '').split('\n');
  return call(cf.localImage, { sessionId, path: src, full: true }).then((data) => data.url);
}

function originOf(base) {
  try { return new URL(base).origin; } catch { return 'https://codingfleet.com'; }
}

// ── State ──────────────────────────────────────────────────────────────────
const S = {
  init: null,
  settings: null,
  sessions: [],
  sessionsError: null,
  models: [],
  modelsError: null,
  credits: null,
  creditsError: null,
  current: null,            // selected session id; null is a new session
  transcripts: new Map(),   // session id -> items
  loaded: new Set(),        // sessions whose history is in `transcripts`
  loading: new Set(),
  running: new Map(),       // session id -> { runId, started, turnStart, usage, ended, model, stopping, stamped, files }
  draftCwd: null,
  draftSandbox: false,      // a new session that runs in the cloud, not here
  collapsed: new Set(),     // folder groups the user folded away
  seenAnswer: new Map(),    // session id -> last_message_at shown in the transcript
  remoteBusy: new Set(),    // sessions with a turn going in another client
  agents: new Map(),        // session id -> Map(agent id -> sub-agent)
  panel: { open: false, agentId: null },
  images: new Map(),        // uploaded file id -> preview data URL
  attachments: [],          // the composer's: { key, name, size, kind, preview, status, fileId, error }
  model: 'auto',
  defaultModel: null,       // the account's default model, from its settings
  account: null,            // GET /v1/settings
  accountError: null,
  permission: 'ask',
  sending: false,
};

// A new session starts on the account's default model.
const newSessionModel = () => S.defaultModel || S.init.state.model || 'auto';

const local = (id) => (S.init && S.init.state.sessions[id]) || {};
const currentSession = () => S.sessions.find((s) => s.id === S.current) || null;

function transcriptOf(id) {
  if (!S.transcripts.has(id)) S.transcripts.set(id, []);
  return S.transcripts.get(id);
}

// Which sidebar folder a session belongs to.
function sessionGroup(session) {
  if (session.executor !== 'client') return 'Cloud sandbox';
  const cwd = local(session.id).cwd;
  return cwd ? baseName(cwd) : 'Another computer';
}

function sessionLabel(session) {
  if (!session) return 'New session';
  const firstUser = (S.transcripts.get(session.id) || []).find((i) => i.type === 'user');
  return session.title || local(session.id).label || (firstUser && firstUser.text.slice(0, 80)) || 'Untitled session';
}

const findModel = (id) => S.models.find((m) => m.id === id);

// Effort variants of one model (Low, Medium, High, ...) are one entry, as in
// the web picker. A server without ?include=family gives plain models.
function modelEntries() {
  const entries = [];
  const families = new Map();
  for (const model of S.models) {
    const family = model.family;
    if (family && family.id) {
      let entry = families.get(family.id);
      if (!entry) {
        entry = { id: family.id, name: family.name, provider: model.provider, variants: [], defaultId: family.default };
        families.set(family.id, entry);
        entries.push(entry);
      }
      entry.variants.push(model);
    } else {
      entries.push({ id: model.id, name: model.name, provider: model.provider, variants: [model], defaultId: model.id });
    }
  }
  const rank = (m) => (m.effort && m.effort.rank) || 0;
  for (const entry of families.values()) entry.variants.sort((a, b) => rank(a) - rank(b));
  return entries;
}

function entryOf(modelId) {
  return modelEntries().find((entry) => entry.variants.some((v) => v.id === modelId)) || null;
}

function modelName(id) {
  if (!id || id === 'auto') return 'Auto';
  const entry = entryOf(id);
  return entry ? entry.name : id;
}

// A model the server names by id or by its display name, as an id we list.
function resolveModel(value) {
  if (!value) return null;
  if (value === 'auto' || findModel(value)) return value;
  const byName = S.models.find((m) => m.name === value);
  return byName ? byName.id : null;
}

// The model a session last ran on. Staying on it keeps the provider's prompt
// cache warm, so selecting a session selects its model too.
function sessionModel(session) {
  if (!session) return null;
  return resolveModel(local(session.id).model) || resolveModel(session.last_model)
    || resolveModel(session.model);
}

function applySessionModel() {
  const picked = S.current ? sessionModel(currentSession()) : null;
  S.model = picked || newSessionModel();
  renderComposer();
}

// The name a person knows: "DeepSeek V4.1 Flash", not "deepseek-flash".
function modelLabel(id) {
  if (!id) return '';
  if (id === 'auto') return 'Auto';
  const exact = findModel(id);
  if (exact) return exact.name;
  const entry = entryOf(id);
  return entry ? entry.name : id;
}

function providerLogo(provider, className = 'plogo') {
  if (!provider) return null;
  const box = el('span', className);
  if (provider.logo_url) {
    const img = el('img');
    img.alt = '';
    img.src = provider.logo_url;
    img.addEventListener('error', () => {
      img.remove();
      box.textContent = provider.name.slice(0, 1).toUpperCase();
      box.classList.add('letter');
    });
    box.append(img);
  } else {
    box.textContent = provider.name.slice(0, 1).toUpperCase();
    box.classList.add('letter');
  }
  return box;
}

// ── Data ───────────────────────────────────────────────────────────────────
async function loadSessions({ quiet = false } = {}) {
  let changed = true;
  try {
    const data = await call(cf.sessions);
    const next = data.sessions || [];
    changed = JSON.stringify(next) !== JSON.stringify(S.sessions);
    S.sessions = next;
    S.sessionsError = null;
  } catch (err) {
    if (quiet) return;
    S.sessionsError = err.message;
  }
  if (!changed && quiet) return;
  for (const session of S.sessions) noticeNewAnswers(session);
  renderSidebar();
  renderAccount();
  if (S.current) renderTopbar();
}

// ── Live refresh ───────────────────────────────────────────────────────────
// A session can move on without this app: a turn sent from the web chat, or
// from this app on another computer. Its newest answer's time comes with the
// session list, and the open session is also asked whether a turn is going.
function noticeNewAnswers(session) {
  const at = session.last_message_at || null;
  const seen = S.seenAnswer.get(session.id);
  if (!S.loaded.has(session.id) || S.running.has(session.id)) {
    if (S.loaded.has(session.id)) S.seenAnswer.set(session.id, at);
    return;
  }
  if (seen === undefined) {
    S.seenAnswer.set(session.id, at);
    return;
  }
  if (at && at !== seen) {
    S.seenAnswer.set(session.id, at);
    reloadTranscript(session.id);
  }
}

async function reloadTranscript(id) {
  if (S.loading.has(id)) return;
  S.loading.add(id);
  const box = $('transcript');
  const wasAtBottom = nearBottom();
  const offset = box.scrollTop;
  try {
    const data = await call(cf.messages, id);
    if (S.running.has(id)) return; // this app started a run meanwhile
    S.transcripts.set(id, fromHistory(id, data.messages || [], data.compactions || []));
  } catch {
    return; // keep what is shown; the next tick tries again
  } finally {
    S.loading.delete(id);
  }
  if (S.current !== id) return;
  renderTranscript();
  if (!wasAtBottom) box.scrollTop = offset;
  updateScrollButton();
}

// Whether a turn is going in the open session somewhere else.
async function checkCurrentSession() {
  const id = S.current;
  if (!id || S.running.has(id)) return;
  let detail;
  try {
    detail = await call(cf.session, id);
  } catch {
    return;
  }
  if (S.current !== id) return;
  const busy = Boolean(detail.busy);
  const was = S.remoteBusy.has(id);
  if (busy === was) {
    const session = currentSession();
    if (session) noticeNewAnswers({ ...session, last_message_at: detail.last_message_at });
    return;
  }
  if (busy) S.remoteBusy.add(id);
  else S.remoteBusy.delete(id);
  renderTopbar();
  renderTranscript();
  if (!busy) {
    await reloadTranscript(id);
    S.seenAnswer.set(id, detail.last_message_at || null);
    loadCredits();
  }
}

let liveTimer = 0;
function scheduleLiveRefresh() {
  clearTimeout(liveTimer);
  // Quick while the window is in use or another client is working; slow in
  // the background, where nobody is looking.
  const busy = S.current && S.remoteBusy.has(S.current);
  const delay = busy ? 3000 : document.hasFocus() ? 6000 : 30000;
  liveTimer = setTimeout(async () => {
    if (S.settings && S.settings.hasKey) {
      await Promise.allSettled([loadSessions({ quiet: true }), checkCurrentSession(), ensureModels()]);
    }
    scheduleLiveRefresh();
  }, delay);
}

// Balances change from anywhere: a run here, a turn in the web chat, a
// purchase on the website. So they are read again every 30 seconds, when the
// window comes back into focus, and after every run.
const CREDITS_REFRESH_MS = 30_000;
let creditsLoadedAt = 0;

async function loadCredits({ quiet = false } = {}) {
  let next;
  try {
    next = await call(cf.credits);
  } catch (err) {
    // A background refresh that fails keeps the numbers already shown.
    if (quiet && S.credits) return;
    S.creditsError = err.status === 401 ? 'The API key was refused.' : err.message;
    renderAccount();
    return;
  }
  creditsLoadedAt = Date.now();
  const changed = JSON.stringify(next) !== JSON.stringify(S.credits);
  S.credits = next;
  S.creditsError = null;
  // Redrawing an unchanged card would drop the hover on its details.
  if (changed || !quiet) renderAccount();
}

// The model list comes once per start. A start without a connection used to
// leave the picker empty for good, so an empty list is asked for again: when
// the picker opens, when the network comes back, and on every live refresh.
let modelsLoading = null;
function ensureModels() {
  if (S.models.length || !S.settings || !S.settings.hasKey) return Promise.resolve();
  return loadModels();
}

async function loadModels() {
  if (modelsLoading) return modelsLoading;
  modelsLoading = loadModelsOnce().finally(() => { modelsLoading = null; });
  return modelsLoading;
}

async function loadModelsOnce() {
  try {
    S.models = (await call(cf.models)).models || [];
    S.modelsError = null;
  } catch (err) {
    S.modelsError = err.status === 0
      ? 'No connection. The models will load when you are back online.'
      : err.message;
  }
  if (!$('modelMenu').hidden) renderModelList($('modelSearch').value);
  if (!$('settings').hidden && settingsTab === 'preferences' && !document.querySelector('.pref-menu:not([hidden])')) {
    renderPreferencesPane();
  }
  if (S.current) applySessionModel();
  renderComposer();
}

const loadAll = () => Promise.allSettled([loadSessions(), loadModels(), loadCredits(), loadAccountSettings()]);

async function loadAccountSettings() {
  try {
    const wasPrivate = Boolean(S.account && S.account.privacy.private_sessions);
    S.account = await call(cf.getSettings);
    S.accountError = null;
    if (S.account.privacy.private_sessions && !wasPrivate) notePrivateMode();
  } catch (err) {
    S.accountError = err.status === 0 ? 'No connection. Your settings will load when you are back online.' : err.message;
  }
  applyDefaultModel();
}

// Private session mode is set on the website, and this app cannot run with it on.
function notePrivateMode() {
  if (!(S.account && S.account.privacy.private_sessions)) return;
  showBanner('Private session mode is on in your CodingFleet account, so this app cannot send messages. '
    + 'Turn it off on your account page to use the app.', [{
    label: 'Open account page',
    run: () => window.open(`${originOf(S.settings.apiBase)}/account/`),
  }]);
}

function applyDefaultModel() {
  const chosen = S.account && S.account.preferences.default_model;
  S.defaultModel = chosen || (S.account ? 'auto' : null);
  if (!S.current && !S.sending) {
    S.model = newSessionModel();
    renderComposer();
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function renderSidebar() {
  const list = $('sessionList');
  list.replaceChildren();
  if (!S.settings.hasKey) {
    list.append(el('div', 'sidebar-empty', 'Add your API key to see your sessions.'));
    return;
  }
  if (S.sessionsError && !S.sessions.length) {
    list.append(el('div', 'sidebar-empty', S.sessionsError));
    return;
  }
  if (!S.sessions.length) {
    list.append(el('div', 'sidebar-empty', 'Your sessions will show here.'));
    return;
  }
  const when = (s) => new Date(s.last_used_at || s.last_message_at || s.created_at).getTime();
  const sorted = [...S.sessions].sort((a, b) => when(b) - when(a));

  // Pinned sessions first, whatever their folder. The rest by folder, as in
  // Claude Code: the folder is what a person remembers, not the day they started.
  const groups = new Map();
  const pinned = sorted.filter((s) => s.pinned);
  if (pinned.length) groups.set('Pinned', pinned);
  for (const session of sorted) {
    if (session.pinned) continue;
    const name = sessionGroup(session);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(session);
  }

  // A folder sits where its most recently used session sits, so the one you
  // just worked in is always at the top -- and the sessions inside it already
  // follow the same order, having been pushed in it.
  const newest = (sessions) => Math.max(...sessions.map(when));
  const ordered = [...groups.entries()].sort(([a, sa], [b, sb]) => {
    if (a === 'Pinned') return b === 'Pinned' ? 0 : -1;
    if (b === 'Pinned') return 1;
    return newest(sb) - newest(sa);
  });

  for (const [name, sessions] of ordered) {
    const collapsed = S.collapsed.has(name);
    const head = el('button', `group-head${collapsed ? ' collapsed' : ''}${name === 'Pinned' ? ' pinned' : ''}`);
    const cwd = name === 'Pinned' ? null : local(sessions[0].id).cwd;
    head.title = cwd || name;
    head.append(chevron());
    if (name === 'Pinned') head.append(icon('pin', 'icon group-icon'));
    head.append(el('span', 'group-name', name), el('span', 'group-count', String(sessions.length)));
    head.addEventListener('click', () => {
      if (collapsed) S.collapsed.delete(name);
      else S.collapsed.add(name);
      renderSidebar();
    });
    list.append(head);
    if (collapsed) continue;
    for (const session of sessions) list.append(sessionRow(session));
  }
}

function sessionRow(session) {
  const iso = session.last_used_at || session.created_at;
  const row = el('div', `session${session.id === S.current ? ' selected' : ''}`);
  row.dataset.id = session.id;
  if (renaming === session.id) {
    const input = el('input', 'session-rename');
    input.value = sessionLabel(session);
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Session name');
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      finishRename(session.id, input.value, save);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    row.classList.add('renaming');
    row.append(input, el('div', 'session-meta', `${groupOf(iso)} · ${relTime(iso)}`));
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return row;
  }
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.title = sessionLabel(session);
  const side = el('span', 'session-side');
  if (S.running.has(session.id) || S.remoteBusy.has(session.id)) side.append(el('span', 'dot running'));
  const more = el('button', 'session-more');
  more.title = 'Rename, duplicate, pin or delete';
  more.setAttribute('aria-label', 'Session actions');
  more.innerHTML = ICON.more;
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!$('sessionMenu').hidden && $('sessionMenu').dataset.id === session.id) closeMenus();
    else openSessionMenu(session, more);
  });
  side.append(more);
  row.append(
    el('div', 'session-title', sessionLabel(session)),
    side,
    el('div', 'session-meta', `${groupOf(iso)} · ${relTime(iso)}`),
  );
  row.addEventListener('click', () => selectSession(session.id));
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target === row) selectSession(session.id);
    if (event.key === 'F2' && event.target === row) startRename(session.id);
  });
  return row;
}

// ── Session actions ────────────────────────────────────────────────────────
let renaming = null; // the session being renamed in the sidebar

function openSessionMenu(session, anchor) {
  closeMenus();
  const menu = $('sessionMenu');
  const list = $('sessionMenuList');
  list.replaceChildren();
  const item = (iconName, label, run, danger = false) => {
    const button = el('button', `menu-item${danger ? ' danger' : ''}`);
    button.append(icon(iconName), el('span', 'mi-name', label));
    button.addEventListener('click', () => {
      closeMenus();
      run();
    });
    list.append(button);
  };
  item('edit', 'Rename', () => startRename(session.id));
  item('copy', 'Duplicate', () => duplicateSession(session.id));
  item('pin', session.pinned ? 'Unpin' : 'Pin', () => pinSession(session.id, !session.pinned));
  list.append(el('div', 'menu-sep'));
  item('trash', 'Delete', () => confirmDelete(session), true);
  menu.dataset.id = session.id;
  menu.hidden = false;
  const box = anchor.getBoundingClientRect();
  const height = menu.offsetHeight;
  const below = box.bottom + 4 + height < window.innerHeight - 8;
  menu.style.top = `${below ? box.bottom + 4 : Math.max(8, box.top - height - 4)}px`;
  menu.style.left = `${Math.max(8, box.right - menu.offsetWidth)}px`;
  anchor.classList.add('open');
  anchor.closest('.session').classList.add('menu-open');
}

function startRename(id) {
  renaming = id;
  renderSidebar();
}

async function finishRename(id, value, save) {
  renaming = null;
  const session = S.sessions.find((s) => s.id === id);
  const title = String(value || '').trim().slice(0, 200);
  if (save && session && title && title !== sessionLabel(session)) {
    const before = session.title;
    session.title = title;
    try {
      const data = await call(cf.renameSession, { sessionId: id, title });
      session.title = data.title || title;
    } catch (err) {
      session.title = before;
      showBanner(`The session could not be renamed: ${err.message}`);
    }
  }
  renderSidebar();
  if (S.current === id) renderTopbar();
}

async function pinSession(id, pinned) {
  const session = S.sessions.find((s) => s.id === id);
  if (!session) return;
  session.pinned = pinned;
  renderSidebar();
  try {
    await call(cf.pinSession, { sessionId: id, pinned });
  } catch (err) {
    session.pinned = !pinned;
    renderSidebar();
    showBanner(`The session could not be ${pinned ? 'pinned' : 'unpinned'}: ${err.message}`);
  }
}

async function duplicateSession(id) {
  try {
    const copy = await call(cf.duplicateSession, id);
    const source = local(id);
    S.init.state.sessions[copy.id] = { cwd: source.cwd || null, model: source.model, label: copy.title || '' };
    S.sessions = [copy, ...S.sessions];
    await selectSession(copy.id);
    loadSessions({ quiet: true });
  } catch (err) {
    showBanner(`The session could not be duplicated: ${err.message}`);
  }
}

async function confirmDelete(session) {
  const where = session.executor === 'client'
    ? 'Files in your folder are not touched.'
    : 'Its cloud sandbox is stopped and its files are deleted.';
  const ok = await confirmDialog({
    title: 'Delete this session?',
    text: `"${sessionLabel(session)}" and its conversation are deleted for good, here and on codingfleet.com. ${where}`,
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await call(cf.deleteSession, session.id);
  } catch (err) {
    showBanner(`The session could not be deleted: ${err.message}`);
    return;
  }
  S.sessions = S.sessions.filter((s) => s.id !== session.id);
  S.transcripts.delete(session.id);
  S.loaded.delete(session.id);
  S.agents.delete(session.id);
  delete S.init.state.sessions[session.id];
  forgetDraft(session.id);
  if (S.current === session.id) newSession();
  renderSidebar();
}

// A small yes/no dialog. Resolves true only on the confirm button.
function confirmDialog({ title, text, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay confirm-overlay');
    const modal = el('div', 'modal confirm-modal');
    modal.setAttribute('role', 'alertdialog');
    const cancel = el('button', 'btn', 'Cancel');
    const ok = el('button', `btn ${danger ? 'danger-solid' : 'primary'}`, confirm);
    const actions = el('div', 'modal-actions');
    actions.append(el('div', 'bar-spacer'), cancel, ok);
    modal.append(el('h2', 'confirm-title', title), el('p', 'confirm-text', text), actions);
    overlay.append(modal);
    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(false); });
    document.body.append(overlay);
    setTimeout(() => cancel.focus(), 0);
  });
}

function renderAccount() {
  const box = $('account');
  box.replaceChildren();
  const row = (label, value) => {
    const r = el('div', 'account-row');
    r.append(el('span', null, label), el('strong', null, value));
    return r;
  };
  if (!S.settings.hasKey) {
    const add = el('button', 'btn primary wide', 'Add your API key');
    add.addEventListener('click', () => openSettings(true));
    box.append(add);
  } else if (!S.credits) {
    box.append(el('div', 'account-row', S.creditsError || 'Loading your account…'));
  } else {
    box.append(renderQuota(S.credits));
    const session = currentSession();
    const context = session && session.context;
    if (context && context.limit) {
      const line = row('Context', `${fmtCompact(context.tokens)} / ${fmtCompact(context.limit)}`);
      line.title = "How much of your plan's context limit this session's conversation takes. "
        + 'Near the limit, older messages are summarized automatically.';
      line.classList.add('context-row');
      line.querySelector('span').after(compactButton(session));
      box.append(line);
    }
  }
  const foot = el('div', 'account-foot');
  foot.append(el('span', 'account-server', S.settings.apiBase.replace(/^https?:\/\//, '')));
  const gear = el('button', 'icon-button');
  gear.title = 'Settings';
  gear.innerHTML = ICON.gear;
  gear.addEventListener('click', () => openSettings(false));
  foot.append(gear);
  box.append(foot);
}

// The quota card: a bar of what is left, and the numbers behind it on hover or
// click. Plans with a weekly allowance show how much of it is left; a
// credits-only account has no ceiling to measure against, so it shows its
// balance instead.
let quotaOpen = false;

function quotaLevel(pct, backed = false) {
  if (pct >= 50) return 'good';
  // With credits behind the allowance, running the weekly down is a warning,
  // not a wall. Red is kept for the case where there is nothing left to spend.
  if (pct >= 20 || backed) return 'low';
  return 'out';
}

function renderQuota(credits) {
  const plan = credits.plan || {};
  const total = Number(credits.weekly_total) || 0;
  const left = Math.max(0, Number(credits.weekly_remaining) || 0);
  const hasAllowance = total > 0 && credits.weekly_remaining != null;
  const pct = hasAllowance ? Math.max(0, Math.min(100, Math.round((left / total) * 100))) : null;

  const balance = Number(credits.credits) || 0;
  // The weekly allowance is spent, but the balance is not: runs carry on, paid
  // by credits. The card says so in green rather than shouting 0% in red.
  const onCredits = hasAllowance && balance > 0 && left <= 0;
  const level = quotaLevel(pct, balance > 0);

  const wrap = el('div', `quota${quotaOpen ? ' open' : ''}`);
  // The bar of what is left. A zero-width fill would still paint its glow as a
  // stray mark at the left end of an empty track, so nothing is drawn at all.
  const meterFor = (percent, cls) => {
    const bar = el('div', 'quota-bar');
    if (percent > 0) {
      const fill = el('div', `quota-fill ${cls}`);
      fill.style.width = `${percent}%`;
      bar.append(fill);
    }
    return bar;
  };
  const card = el('button', 'quota-card');
  card.setAttribute('aria-expanded', String(quotaOpen));
  const head = el('div', 'quota-head');
  const status = el('span', 'quota-pct');
  if (!hasAllowance) {
    status.textContent = `${fmtNum(credits.credits)} credits`;
  } else if (onCredits) {
    status.classList.add('credits');
    status.textContent = 'On credits';
    status.title = `Your weekly allowance is used up. Runs now spend your ${fmtNum(balance)} credits, which never expire.`;
  } else {
    status.classList.add(level);
    status.textContent = `${pct}%`;
  }
  head.append(el('span', 'quota-plan', plan.name || 'Your plan'), status);
  card.append(head);
  if (hasAllowance) {
    // Running out of the allowance is not running out of credits: say what is
    // left to spend, right on the card, while the bar is low or spent.
    const sub = el('div', 'quota-sub');
    if (onCredits) {
      sub.append(
        el('span', 'quota-then', `${fmtNum(balance)} credits left`),
        el('span', null, 'Resets Monday'),
      );
    } else {
      const lowOnAllowance = balance > 0 && pct < 25;
      sub.append(el('span', 'quota-left', lowOnAllowance
        ? `${fmtNum(left)} of ${fmtNum(total)} weekly`
        : `${fmtNum(left)} of ${fmtNum(total)} weekly allowance left`));
      if (lowOnAllowance) sub.append(el('span', 'quota-then', `then ${fmtNum(balance)} credits`));
    }
    card.append(meterFor(pct, onCredits ? 'credits' : level), sub);
  } else {
    card.append(el('div', 'quota-sub', 'Credits never expire'));
  }
  card.addEventListener('click', (event) => {
    event.stopPropagation();
    quotaOpen = !quotaOpen;
    wrap.classList.toggle('open', quotaOpen);
    card.setAttribute('aria-expanded', String(quotaOpen));
  });

  const pop = el('div', 'quota-pop');
  const line = (label, value, cls) => {
    const r = el('div', `qp-row${cls ? ` ${cls}` : ''}`);
    r.append(el('span', null, label), el('strong', null, value));
    return r;
  };
  pop.append(el('div', 'qp-title', plan.name ? `${plan.name} plan` : 'Your account'));
  if (hasAllowance) {
    pop.append(line('Weekly allowance', `${fmtNum(left)} / ${fmtNum(total)}`));
    pop.append(meterFor(pct, onCredits ? 'credits' : level));
  }
  pop.append(line('Credits', fmtNum(credits.credits)));
  if (credits.quota_remaining != null && hasAllowance) {
    pop.append(line('You can spend', fmtNum(credits.quota_remaining), 'total'));
  }
  pop.append(el('div', 'qp-note', hasAllowance
    ? 'Runs use the weekly allowance first, then credits. The allowance resets every Monday.'
    : 'Runs use your credits.'));

  const urls = plan.urls || {};
  const origin = originOf(S.settings.apiBase);
  const actions = el('div', 'account-actions');
  const openLink = (label, url, title, primary) => {
    const button = el('button', `btn small${primary ? ' primary' : ''}`, label);
    button.title = title;
    button.addEventListener('click', () => window.open(url));
    return button;
  };
  actions.append(
    openLink('Plans', urls.plans || `${origin}/pricing/`, 'Upgrade or change your plan on codingfleet.com', true),
    openLink('Buy credits', creditsUrl(urls), 'Buy a credit pack on codingfleet.com'),
    openLink('Billing', urls.billing || `${origin}/billing/`, 'Invoices and payment method'),
  );
  pop.append(actions);
  wrap.append(pop, card);
  return wrap;
}

// The credit packs, further down the pricing page.
function creditsUrl(urls) {
  return (urls && urls.credits && urls.credits.includes('#'))
    ? urls.credits : `${originOf(S.settings.apiBase)}/pricing/#one-time-purchase`;
}

// ── Header ─────────────────────────────────────────────────────────────────
function renderTopbar() {
  const bar = $('topbar');
  bar.replaceChildren();
  const session = currentSession();
  bar.append(el('div', 'top-title', session ? sessionLabel(session) : S.current ? 'Session' : 'New session'));

  const cwd = session ? local(session.id).cwd : S.draftCwd;
  if (cwd) {
    const chip = el('button', 'chip');
    chip.title = `${cwd}\nOpen in File Explorer`;
    chip.append(icon('folder'), el('span', null, baseName(cwd)));
    chip.addEventListener('click', () => cf.openFolder(cwd));
    bar.append(chip);
  }
  bar.append(el('div', 'top-spacer'));

  if (session && (S.running.has(session.id) || S.remoteBusy.has(session.id))) {
    const status = el('div', 'status');
    status.append(el('span', 'dot running'), el('span', null, 'Working'));
    bar.append(status);
  }
}

// ── Transcript ─────────────────────────────────────────────────────────────
function renderMain() {
  renderTopbar();
  renderTranscript();
  renderComposer();
}

function renderTranscript() {
  const box = $('transcript');
  box.replaceChildren();
  if (!S.current) {
    box.append(renderEmpty());
    return;
  }
  const column = el('div', 'column');
  column.id = 'column';
  if (!S.loaded.has(S.current) && !loadFailures.has(S.current)) {
    column.append(el('div', 'loading', 'Loading session…'));
  } else {
    for (const item of transcriptOf(S.current)) column.append(renderItem(item));
    if (S.running.has(S.current)) column.append(renderWorking(S.current));
    else if (S.remoteBusy.has(S.current)) column.append(renderRemoteWorking());
  }
  box.append(column);
  box.scrollTop = box.scrollHeight;
  updateScrollButton();
  renderThreadNav();
}

function renderEmpty() {
  const box = el('div', 'empty');
  const logo = el('div', 'empty-logo');
  logo.innerHTML = LOGO;
  box.append(
    logo,
    el('h1', null, 'What should we work on?'),
    el('p', null, 'CodingFleet reads, edits and runs code in the folder you choose. It asks before it runs a command or changes a file.'),
  );

  const card = el('button', 'folder-card');
  const text = el('div', 'fc-text');
  if (S.draftSandbox) {
    text.append(
      el('div', 'fc-title', 'Cloud sandbox'),
      el('div', 'fc-path', "Runs on CodingFleet's servers, not on this computer"),
    );
    card.append(icon('sparkle'), text, el('span', 'fc-change', 'Change'));
  } else {
    text.append(
      el('div', 'fc-title', S.draftCwd ? baseName(S.draftCwd) : 'Choose a project folder'),
      el('div', 'fc-path', S.draftCwd || 'The agent works inside this folder'),
    );
    card.append(icon('folder'), text, el('span', 'fc-change', S.draftCwd ? 'Change' : 'Browse'));
  }
  card.addEventListener('click', openFolderMenu);
  box.append(card);

  const suggestions = el('div', 'suggestions');
  for (const idea of ['Explain how this project is organized', 'Find and fix a bug', 'Write tests for the main module']) {
    const chip = el('button', 'suggestion', idea);
    chip.addEventListener('click', () => {
      $('prompt').value = idea;
      rememberDraft();
      autosize();
      updateSendButton();
      $('prompt').focus();
    });
    suggestions.append(chip);
  }
  box.append(suggestions);
  return box;
}

const nearBottom = () => {
  const box = $('transcript');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 160;
};
const scrollToBottom = () => {
  const box = $('transcript');
  box.scrollTop = box.scrollHeight;
  updateScrollButton();
};

// ── Thread navigation ─────────────────────────────────────────────────────
// One tick per prompt on the right edge; hovering shows the prompts, a click
// goes to one. The tick of the prompt being read is lit as the page scrolls.
function navItems() {
  if (!S.current || !S.loaded.has(S.current)) return [];
  return transcriptOf(S.current).filter((i) => i.type === 'user' && !i.steer && i.node && i.node.isConnected);
}

function renderThreadNav() {
  const nav = $('threadNav');
  nav.replaceChildren();
  const prompts = navItems();
  nav.hidden = prompts.length < 2;
  if (nav.hidden) return;
  for (const item of prompts) {
    const text = String(item.text || '').replace(/\s+/g, ' ').trim();
    const button = el('button', 'tn-item');
    button.title = text.length > 240 ? `${text.slice(0, 240)}…` : text;
    button.append(el('span', 'tn-text', text || 'Message'), el('span', 'tn-tick'));
    button.addEventListener('click', () => item.node.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    item.navButton = button;
    nav.append(button);
  }
  updateThreadNavActive();
}

function updateThreadNavActive() {
  const nav = $('threadNav');
  if (nav.hidden) return;
  const box = $('transcript');
  const line = box.getBoundingClientRect().top + box.clientHeight * 0.35;
  const prompts = navItems().filter((i) => i.navButton);
  let active = prompts[0];
  for (const item of prompts) {
    if (item.node.getBoundingClientRect().top <= line) active = item;
  }
  // At the very bottom the last prompt is the one being read.
  if (nearBottom() && box.scrollHeight > box.clientHeight) active = prompts[prompts.length - 1];
  for (const item of prompts) item.navButton.classList.toggle('active', item === active);
}

let navFrame = 0;
function onTranscriptScroll() {
  updateScrollButton();
  if (navFrame) return;
  navFrame = requestAnimationFrame(() => {
    navFrame = 0;
    updateThreadNavActive();
  });
}

// The button back to the newest message, shown only when there is one to go to.
function updateScrollButton() {
  const button = $('scrollDown');
  if (button) button.hidden = !S.current || nearBottom();
}

function addItem(sessionId, item) {
  transcriptOf(sessionId).push(item);
  if (sessionId !== S.current) return;
  const column = $('column');
  if (!column) return;
  const stick = nearBottom();
  const node = renderItem(item);
  const working = column.querySelector('.working');
  if (working) column.insertBefore(node, working);
  else column.append(node);
  if (stick) scrollToBottom();
  if (item.type === 'user') renderThreadNav();
}

function refreshItem(sessionId, item) {
  if (sessionId !== S.current || !item || !item.node || !item.node.isConnected) return;
  const stick = nearBottom();
  const old = item.node;
  old.replaceWith(renderItem(item));
  if (stick) scrollToBottom();
}

function stamp(at, side) {
  const node = el('div', `stamp ${side}`, fmtStamp(at));
  node.title = new Date(at).toLocaleString();
  return node;
}

function renderItem(item) {
  let node;
  switch (item.type) {
    case 'user': {
      node = el('div', `msg user${item.steer ? ' steer' : ''}`);
      const wrap = el('div', 'user-wrap');
      if (item.at) wrap.append(stamp(item.at, 'user'));
      if (item.steer) wrap.append(el('div', 'steer-label', 'Sent while working'));
      if (item.files && item.files.length) {
        const files = el('div', 'msg-files');
        for (const file of item.files) {
          if (showsAsImage(file)) {
            files.append(imageCard(file));
          } else {
            files.append(attachmentChip({ ...file, status: file.deleted ? 'error' : 'ready',
              error: file.deleted ? 'Deleted' : null }, { removable: false }));
          }
        }
        wrap.append(files);
      }
      wrap.append(el('div', 'bubble', item.text));
      node.append(wrap);
      break;
    }
    case 'stamp':
      node = stamp(item.at, 'assistant');
      break;
    case 'assistant': {
      node = el('div', 'msg assistant');
      const body = el('div', 'markdown');
      setMarkdown(body, item.text);
      node.append(body);
      break;
    }
    case 'tools':
      node = renderGroup(item);
      break;
    case 'files':
      node = renderFiles(item);
      break;
    case 'notice':
      node = el('div', 'notice', item.text);
      break;
    case 'compaction':
      node = compactionChip(item);
      break;
    case 'error':
      node = el('div', 'error-card');
      node.append(el('span', null, item.text));
      break;
    case 'note':
      node = el('div', 'note-card');
      node.append(icon('file'), el('span', null, item.text));
      break;
    case 'load-error': {
      const failure = loadFailures.get(item.sessionId) || { message: 'Something went wrong.', next: null };
      node = el('div', 'error-card load-error');
      const text = el('div', 'load-error-text');
      text.append(el('strong', null, 'This session could not be loaded.'), el('span', null, failure.message));
      const side = el('div', 'load-error-side');
      side.append(el('span', 'retry-in', S.loading.has(item.sessionId) ? 'Trying again…' : retryText(failure)));
      const retry = el('button', 'btn', 'Try again');
      retry.addEventListener('click', () => retryNow(item.sessionId));
      side.append(retry);
      node.append(text, side);
      break;
    }
    case 'footer':
      node = renderFooter(item);
      break;
    default:
      node = el('div');
  }
  item.node = node;
  return node;
}

// What the working line says, from the run's latest status event.
const STATUS_LABELS = {
  thinking: 'Thinking…',
  compacting: 'Compacting the conversation…',
  writing_code: 'Writing code…',
  writing_file: 'Writing a file…',
  editing_file: 'Editing a file…',
  writing_query: 'Writing a query…',
};

function workingText(run) {
  if (!run) return 'Working…';
  if (run.stopping) return 'Stopping…';
  return STATUS_LABELS[run.status] || 'Working…';
}

function updateWorkingLabel(sessionId) {
  if (sessionId !== S.current) return;
  const label = document.querySelector('.working .shimmer');
  if (label) label.textContent = workingText(S.running.get(sessionId));
}

function renderWorking(sessionId) {
  const run = S.running.get(sessionId);
  const node = el('div', 'working');
  node.append(el('span', 'spinner'), el('span', 'shimmer', workingText(run)), el('span', 'hint', ''));
  return node;
}

function renderRemoteWorking() {
  const node = el('div', 'working remote');
  node.append(el('span', 'spinner'), el('span', 'shimmer', 'Working in another window…'),
    el('span', 'hint', 'This view updates when it finishes'));
  return node;
}

setInterval(() => {
  const run = S.current && S.running.get(S.current);
  const clock = document.querySelector('.working .hint');
  if (run && clock) clock.textContent = fmtDuration((Date.now() - run.started) / 1000);
}, 1000);

// The assistant's side of a turn gets one timestamp, above its first output.
function assistantStamp(sessionId) {
  const run = S.running.get(sessionId);
  if (!run || run.stamped) return;
  run.stamped = true;
  addItem(sessionId, { type: 'stamp', at: nowIso() });
}

// Streamed text is re-rendered at most once a frame.
// Web-chat chip markup, as an older server can still send it as text.
const LEAKED_MARKUP = /replace>>>>>|<span class='(custom-tooltip|tool-done-chip)/;

function appendText(sessionId, text) {
  if (LEAKED_MARKUP.test(text)) return;
  const items = transcriptOf(sessionId);
  const last = items[items.length - 1];
  if (last && last.type === 'assistant' && last.live) {
    last.text += text;
    if (!last.scheduled) {
      last.scheduled = true;
      requestAnimationFrame(() => {
        last.scheduled = false;
        if (sessionId !== S.current || !last.node || !last.node.isConnected) return;
        const stick = nearBottom();
        setMarkdown(last.node.querySelector('.markdown'), last.text);
        if (stick) scrollToBottom();
      });
    }
    return;
  }
  if (!text.trim()) return;
  assistantStamp(sessionId);
  addItem(sessionId, { type: 'assistant', text, live: true });
}

function closeLiveText(sessionId) {
  for (const item of transcriptOf(sessionId)) {
    if (item.type === 'assistant') item.live = false;
  }
}

// ── Footer with the token breakdown ────────────────────────────────────────
// What a run's price means, on hover: why a run cost nothing, above all.
function creditsWhy(usage, modelName) {
  const plan = (S.credits && S.credits.plan && S.credits.plan.name) || '';
  const planText = `Included in your ${plan || 'Unlimited'} plan: this model costs no credits in this app `
    + 'and on the web (fair use applies).';
  if (usage.billing === 'plan') return planText;
  if (usage.billing === 'byok') return 'Paid with your own API key for this provider: no credits.';
  if (usage.billing === 'free') return 'A free model: no credits.';
  if (Number(usage.credits) !== 0) return 'Credits this run cost. Your weekly allowance is used first, then your credits.';
  // A run loaded from the history does not say why; the model does.
  const model = S.models.find((m) => m.name === modelName || m.id === modelName);
  if (planIncludes(model)) return planText;
  if (model && !model.credits_per_20k_tokens) return 'A free model: no credits.';
  return 'This run cost no credits.';
}

function creditsLabel(usage, modelName) {
  const label = el('span', 'has-tip credits-label');
  label.tabIndex = 0;
  const n = Number(usage.credits);
  label.append(el('span', 'tip-anchor', `${fmtNum(usage.credits)} ${n === 1 ? 'credit' : 'credits'}`));
  const tip = el('span', 'tip tip-text', creditsWhy(usage, modelName));
  label.append(tip);
  return label;
}

function renderFooter(item) {
  const node = el('div', 'turn-footer');
  const usage = item.usage;
  if (item.model) node.append(el('span', null, modelLabel(item.model)));
  if (usage) {
    if (usage.credits != null) node.append(creditsLabel(usage, item.model));
    const input = usage.prompt_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const output = usage.completion_tokens || 0;
    const total = input + cacheRead + cacheWrite + output;
    const tokens = el('span', 'has-tip');
    tokens.tabIndex = 0;
    tokens.append(el('span', 'tip-anchor', fmtTokens(total)));
    const tip = el('span', 'tip');
    const rows = [
      ['Input (not cached)', input],
      ['Cache read', cacheRead],
      ['Cache write', cacheWrite],
      ['Output', output],
    ];
    if (usage.reasoning_tokens) rows.push(['of which reasoning', usage.reasoning_tokens, 'sub']);
    rows.push(['Total', total, 'total']);
    if (usage.context_tokens) rows.push(['Context used', usage.context_tokens, 'sub']);
    for (const [label, value, kind] of rows) {
      const line = el('span', `tip-row${kind ? ` ${kind}` : ''}`);
      line.append(el('span', null, label), el('b', null, fmtNum(value)));
      tip.append(line);
    }
    tokens.append(tip);
    node.append(tokens);
    if (usage.time_taken) node.append(el('span', null, fmtDuration(usage.time_taken)));
  }
  if (item.note) node.append(el('span', null, item.note));
  return node;
}

// ── Sub-agents ─────────────────────────────────────────────────────────────
// With parallel_agents the agent hands tasks to sub-agents. Each is one row in
// the transcript; its own work (text, tool calls, approvals) is shown in the
// panel on the right, which opens by itself when one starts, as in the web chat.
function agentsOf(sessionId) {
  if (!S.agents.has(sessionId)) S.agents.set(sessionId, new Map());
  return S.agents.get(sessionId);
}

function agentWaiting(agent) {
  return agent.items.some((i) => i.type === 'tools' && i.tools.some((t) => t.status === 'waiting'));
}

function agentState(agent) {
  if (agent.status === 'running' && agentWaiting(agent)) return 'waiting';
  return agent.status;
}

const AGENT_STATE_LABELS = {
  running: 'Working', waiting: 'Needs approval', done: 'Done', failed: 'Failed', cancelled: 'Stopped',
};

function ensureAgent(sessionId, id, fields = {}) {
  const agents = agentsOf(sessionId);
  let agent = agents.get(id);
  if (!agent) {
    agent = { id, sessionId, role: 'Sub-agent', task: '', model: null, status: 'running', items: [],
      credits: null, summary: '', callId: null, loaded: true, taskOpen: false };
    agents.set(id, agent);
  }
  Object.assign(agent, fields);
  return agent;
}

function parentToolOf(agent) {
  const tools = transcriptOf(agent.sessionId).filter((i) => i.type === 'tools').flatMap((g) => g.tools);
  return tools.find((t) => (agent.callId && t.id === agent.callId) || t.agentId === agent.id) || null;
}

// Something about a sub-agent changed: its row in the transcript and the panel.
let panelFrame = 0;
function agentChanged(sessionId, agentId) {
  const agent = agentsOf(sessionId).get(agentId);
  if (!agent) return;
  const parent = parentToolOf(agent);
  if (parent) refreshItem(sessionId, parent.group);
  if (sessionId !== S.current || !S.panel.open) return;
  if (panelFrame) return;
  panelFrame = requestAnimationFrame(() => {
    panelFrame = 0;
    renderPanel();
  });
}

function agentAppendText(agent, text) {
  if (!text) return;
  const last = agent.items[agent.items.length - 1];
  if (last && last.type === 'assistant') last.text += text;
  else agent.items.push({ type: 'assistant', text });
}

function agentAddTool(agent, tool) {
  const last = agent.items[agent.items.length - 1];
  if (last && last.type === 'tools') {
    tool.group = last;
    last.tools.push(tool);
    return;
  }
  const group = { type: 'tools', sessionId: agent.sessionId, agentId: agent.id, tools: [tool], open: false };
  tool.group = group;
  agent.items.push(group);
}

// ── Panel width ────────────────────────────────────────────────────────────
// The panel on the right can be widened with its two header buttons or by
// dragging its left edge. The chosen width is remembered between runs.
const PANEL_WIDTH_KEY = 'cf.panel-width';
const PANEL_MIN_WIDTH = 280;
const PANEL_STEP = 80;
let panelWidth = null;      // px once the user has chosen one; null = the default

const panelWidthMax = () => Math.max(PANEL_MIN_WIDTH, Math.round(window.innerWidth * 0.8));

function storedPanelWidth() {
  if (panelWidth != null) return panelWidth;
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(saved) && saved > 0) panelWidth = saved;
  } catch { /* nothing remembered */ }
  return panelWidth;
}

function applyPanelWidth(px) {
  panelWidth = Math.round(Math.min(panelWidthMax(), Math.max(PANEL_MIN_WIDTH, px)));
  document.documentElement.style.setProperty('--agents-panel-width', `${panelWidth}px`);
  return panelWidth;
}

function savePanelWidth() {
  try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)); } catch { /* kept for this run only */ }
}

function restorePanelWidth() {
  const saved = storedPanelWidth();
  if (saved != null) applyPanelWidth(saved);
}

function stepPanelWidth(direction) {
  const panel = $('agentsPanel');
  const current = panelWidth != null ? panelWidth
    : panel && !panel.hidden ? Math.round(panel.getBoundingClientRect().width) : 380;
  applyPanelWidth(current + direction * PANEL_STEP);
  savePanelWidth();
}

// Dragging the edge: the pointer events live on the document, so the drag
// survives the panel being re-rendered while a sub-agent is working.
function startPanelDrag(event) {
  const panel = $('agentsPanel');
  if (!panel || event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = Math.round(panel.getBoundingClientRect().width);
  document.body.classList.add('panel-resizing');
  const move = (e) => {
    e.preventDefault();
    applyPanelWidth(startWidth + (startX - e.clientX));
  };
  const up = () => {
    document.body.classList.remove('panel-resizing');
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    savePanelWidth();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}

function openPanel(agentId) {
  S.panel = { open: true, agentId: agentId || S.panel.agentId };
  renderPanel();
  const agent = S.current && agentsOf(S.current).get(S.panel.agentId);
  if (agent && !agent.loaded) loadAgent(agent);
}

function closePanel() {
  S.panel = { open: false, agentId: S.panel.agentId };
  renderPanel();
}

async function loadAgent(agent) {
  if (agent.loading) return;
  agent.loading = true;
  try {
    const data = await call(cf.agent, { sessionId: agent.sessionId, agentId: agent.id });
    Object.assign(agent, {
      role: data.role || agent.role,
      task: data.task || '',
      model: data.model || agent.model,
      credits: data.credits,
      summary: data.summary || '',
      status: data.error ? 'failed' : 'done',
      items: data.text ? [{ type: 'assistant', text: data.text, history: true }] : [],
      loaded: true,
    });
  } catch (err) {
    agent.items = [{ type: 'error', text: `Could not load this sub-agent: ${err.message}` }];
    agent.loaded = true;
  } finally {
    agent.loading = false;
  }
  agentChanged(agent.sessionId, agent.id);
}

function renderAgentTool(tool) {
  const agent = agentsOf(tool.group.sessionId).get(tool.agentId);
  const state = agent ? agentState(agent) : tool.status;
  const iconState = state === 'waiting' ? 'waiting' : state === 'running' ? 'running'
    : state === 'done' ? 'done' : state === 'cancelled' ? 'cancelled' : 'failed';
  const node = el('div', `tool agent-tool ${iconState}`);
  const head = el('button', 'tool-head');
  head.title = 'Open in the sub-agents panel';
  const role = (agent && agent.role) || (tool.arguments && tool.arguments.role) || 'Sub-agent';
  const verb = el('span', 'tool-verb');
  verb.append(icon('robot'), ` ${role}`);
  verb.style.display = 'inline-flex';
  verb.style.alignItems = 'center';
  verb.style.gap = '6px';
  head.append(statusIcon(iconState), verb,
    el('span', 'tool-target', firstLine((tool.arguments && tool.arguments.task) || '')),
    toolMeta(tool), el('span', 'tool-open-panel', 'View'));
  head.addEventListener('click', () => openPanel(tool.agentId));
  node.append(head);
  return node;
}

function renderPanel() {
  const panel = $('agentsPanel');
  const app = document.querySelector('.app');
  const agents = S.current ? [...agentsOf(S.current).values()] : [];
  const show = S.panel.open && agents.length > 0;
  panel.hidden = !show;
  app.classList.toggle('with-panel', show);
  if (!show) return;
  if (!agents.some((a) => a.id === S.panel.agentId)) S.panel.agentId = agents[agents.length - 1].id;
  const agent = agents.find((a) => a.id === S.panel.agentId);

  const keepScroll = panel.querySelector('.ap-body');
  const wasAtBottom = keepScroll ? keepScroll.scrollHeight - keepScroll.scrollTop - keepScroll.clientHeight < 80 : true;
  const oldTop = keepScroll ? keepScroll.scrollTop : 0;
  const sameAgent = panel.dataset.agent === agent.id;

  panel.replaceChildren();
  panel.dataset.agent = agent.id;
  const grip = el('div', 'ap-resizer');
  grip.title = 'Drag to resize the panel';
  grip.addEventListener('pointerdown', startPanelDrag);
  panel.append(grip);
  const head = el('div', 'ap-head drag');
  const close = el('button', 'icon-button');
  close.title = 'Close the panel';
  close.innerHTML = ICON.x;
  close.addEventListener('click', closePanel);
  const widthGroup = el('div', 'ap-width');
  const narrower = el('button', 'icon-button');
  narrower.title = 'Make the panel narrower';
  narrower.innerHTML = ICON.narrower;
  narrower.addEventListener('click', () => stepPanelWidth(-1));
  const wider = el('button', 'icon-button');
  wider.title = 'Make the panel wider';
  wider.innerHTML = ICON.wider;
  wider.addEventListener('click', () => stepPanelWidth(1));
  widthGroup.append(narrower, wider);
  head.append(icon('robot', 'icon'), el('span', 'ap-title', 'Sub-agents'),
    el('span', 'ap-count', String(agents.length)), el('div', 'top-spacer'), widthGroup, close);
  head.querySelector('.icon').style.cssText = 'width:16px;height:16px;color:var(--accent)';
  panel.append(head);

  if (agents.length > 1) {
    const tabs = el('div', 'ap-tabs');
    for (const item of agents) {
      const tab = el('button', `ap-tab${item.id === agent.id ? ' selected' : ''}`);
      tab.title = item.task || item.role;
      tab.append(el('span', `agent-dot ${agentState(item)}`), el('span', null, item.role));
      tab.addEventListener('click', () => openPanel(item.id));
      tabs.append(tab);
    }
    panel.append(tabs);
  }

  const body = el('div', 'ap-body');
  const card = el('div', 'ap-card');
  const role = el('div', 'ap-role');
  const state = agentState(agent);
  role.append(icon('robot'), el('span', null, agent.role),
    el('span', `ap-state ${state}`, AGENT_STATE_LABELS[state] || state));
  card.append(role);
  const meta = el('div', 'ap-meta');
  if (agent.model) meta.append(el('span', null, agent.model));
  if (agent.credits != null) meta.append(el('span', null, `${fmtNum(agent.credits)} ${Number(agent.credits) === 1 ? 'credit' : 'credits'}`));
  if (meta.childNodes.length) card.append(meta);
  if (agent.task) {
    card.append(el('div', 'ap-label', 'Task'));
    const task = el('div', `ap-task${agent.taskOpen ? ' open' : ''}`, agent.task);
    card.append(task);
    if (agent.task.length > 280) {
      const toggle = el('button', 'ap-task-toggle', agent.taskOpen ? 'Show less' : 'Show all');
      toggle.addEventListener('click', () => {
        agent.taskOpen = !agent.taskOpen;
        renderPanel();
      });
      card.append(toggle);
    }
  }
  body.append(card);

  if (!agent.loaded) {
    body.append(el('div', 'ap-empty', 'Loading…'));
  } else {
    for (const item of agent.items) body.append(renderItem(item));
    if (!agent.items.length && agent.status !== 'running') {
      body.append(el('div', 'ap-empty', 'This sub-agent left no transcript.'));
    }
  }
  if (agent.status === 'running') {
    const working = el('div', 'ap-working');
    working.append(el('span', 'spinner'), el('span', 'shimmer',
      state === 'waiting' ? 'Waiting for your approval…' : (agent.statusText || 'Working…')));
    body.append(working);
  }
  if (agent.summary && agent.status !== 'running') body.append(el('div', 'ap-summary', agent.summary));
  panel.append(body);
  body.scrollTop = !sameAgent || wasAtBottom ? body.scrollHeight : oldTop;
}

function onAgentEvent(sessionId, event, data) {
  const agentId = data.agent_id;
  if (!agentId) return;
  const agents = agentsOf(sessionId);
  const opening = !agents.has(agentId);
  switch (event) {
    case 'subagent.started': {
      const agent = ensureAgent(sessionId, agentId, {
        role: data.role || 'Sub-agent', task: data.task || '', model: data.model || null,
        callId: data.call_id || null, status: 'running',
      });
      const parent = parentToolOf(agent);
      if (parent) {
        parent.agentId = agentId;
        refreshItem(sessionId, parent.group);
      }
      // As in the web chat: the panel opens when a sub-agent starts.
      if (sessionId === S.current && (opening && (!S.panel.open || !agents.get(S.panel.agentId)))) openPanel(agentId);
      break;
    }
    case 'subagent.text':
      agentAppendText(ensureAgent(sessionId, agentId), data.text || '');
      break;
    case 'subagent.status': {
      const agent = ensureAgent(sessionId, agentId);
      agent.statusText = data.state === 'started' ? (STATUS_LABELS[data.kind] || null) : null;
      break;
    }
    case 'subagent.done': {
      const agent = ensureAgent(sessionId, agentId);
      Object.assign(agent, {
        status: data.cancelled ? 'cancelled' : data.ok === false ? 'failed' : 'done',
        credits: data.credits != null ? data.credits : agent.credits,
        summary: data.summary || '',
        model: data.model || agent.model,
        statusText: null,
      });
      break;
    }
    case 'tool.call': {
      const agent = ensureAgent(sessionId, agentId);
      if (!findTool(sessionId, data.id)) {
        agentAddTool(agent, {
          id: data.id, name: data.name, arguments: data.arguments || {},
          status: data.executor === 'client' ? 'queued' : 'running',
          ...S.running.get(sessionId)?.replayTools?.get(data.id),
        });
      }
      break;
    }
    case 'tool.result': {
      const tool = findTool(sessionId, data.id);
      if (tool) {
        tool.status = tool.status === 'denied' ? 'denied' : data.ok ? 'done' : 'failed';
        tool.output = data.output;
      }
      break;
    }
    default:
      return;
  }
  agentChanged(sessionId, agentId);
}

// ── Tool calls, grouped ────────────────────────────────────────────────────
const VERBS = {
  run_command: (a) => ['Run', a.command],
  execute_code: (a) => [a.command ? 'Run' : 'Write', a.filename || a.command],
  fs_read: (a) => ['Read', a.path],
  fs_write: (a) => ['Write', a.path],
  fs_edit: (a) => ['Edit', a.path],
  fs_glob: (a) => ['Search files', a.pat],
  web_search: (a) => ['Search the web', a.query || a.q],
  spawn_agent: (a) => ['Delegate', a.role ? `${a.role}: ${a.task || ''}` : a.task],
  get_url_content: (a) => ['Fetch', a.url || (Array.isArray(a.urls) ? a.urls.join(', ') : '')],
  retrieve_chat_context: (a) => ['Search past chats', a.query],
  update_memory: () => ['Update memory', ''],
  credit_status: () => ['Check credits', ''],
  view_image: (a) => ['View image', a.source],
  take_screenshot: (a) => ['Take a screenshot', a.window ? `window: ${a.window}` : 'the screen'],
  generate_image: (a) => ['Generate image', a.prompt],
  read_file: (a) => ['Read attachment', a.path || a.file_id],
};

// verb, singular, plural, and whether repeat calls on one path count once.
const GROUP_WORDS = {
  fs_read: ['Read', 'file', 'files', true],
  fs_write: ['Wrote', 'file', 'files', true],
  fs_edit: ['Edited', 'file', 'files', true],
  fs_glob: ['Searched', 'pattern', 'patterns'],
  run_command: ['Ran', 'command', 'commands'],
  execute_code: ['Ran', 'script', 'scripts'],
  get_url_content: ['Fetched', 'page', 'pages'],
  web_search: ['Searched the web', 'time', 'times'],
  spawn_agent: ['Delegated', 'task', 'tasks'],
};

// "Allow all ... this session" covers the REASON a call was held, not the one
// tool that asked: someone who allows file changes means fs_write, fs_edit and
// a script that writes a file alike. The main process keeps it with the
// session, so it still holds on the next run and after a restart.
const ALLOW_LABELS = {
  'runs a command': 'Allow all commands this session',
  'changes files': 'Allow all file changes this session',
  'reads outside the project folder': 'Allow reads outside the folder this session',
  'takes a picture of your screen': 'Allow screenshots this session',
  'uses a local MCP tool': 'Allow local MCP tools this session',
};

const REASONS = {
  'runs a command': 'wants to run a command',
  'changes files': 'wants to change a file',
  'reads outside the project folder': 'wants to read outside the project folder',
  'takes a picture of your screen': 'wants to take a picture of your screen',
  'uses a local MCP tool': 'wants to use a tool from a local MCP server',
};

const ACTIVE = ['queued', 'running', 'waiting'];

function toolSummary(tool) {
  const args = tool.arguments || {};
  if (VERBS[tool.name]) return VERBS[tool.name](args);
  const firstString = Object.values(args).find((v) => typeof v === 'string');
  if (tool.name.startsWith('local_')) return [`Local MCP: ${tool.name.slice(6).replace(/_/g, ' ')}`, firstString || ''];
  return [tool.name.replace(/_/g, ' '), firstString || ''];
}

function groupSummary(tools) {
  const buckets = new Map();
  for (const tool of tools) {
    const words = GROUP_WORDS[tool.name] || ['Used', 'tool', 'tools'];
    const key = words[0] + words[1];
    if (!buckets.has(key)) buckets.set(key, { words, count: 0, paths: new Set() });
    const bucket = buckets.get(key);
    const target = tool.arguments && tool.arguments.path;
    if (words[3] && target) {
      if (bucket.paths.has(target)) continue;
      bucket.paths.add(target);
    }
    bucket.count++;
  }
  return [...buckets.values()].map(({ words, count }, index) => {
    const verb = index === 0 ? words[0] : words[0].toLowerCase();
    if (words[1] === 'time') return count === 1 ? verb : `${verb} ${count} times`;
    return `${verb} ${count} ${count === 1 ? words[1] : words[2]}`;
  }).join(', ');
}

// A sub-agent waiting for approval makes its spawn_agent row wait too.
function toolWaits(tool) {
  if (tool.status === 'waiting') return true;
  if (tool.name !== 'spawn_agent' || !tool.agentId || !tool.group) return false;
  const agent = agentsOf(tool.group.sessionId).get(tool.agentId);
  return Boolean(agent && agent.status === 'running' && agentWaiting(agent));
}

function groupStatus(tools) {
  if (tools.some(toolWaits)) return 'waiting';
  if (tools.some((t) => t.status === 'running' || t.status === 'queued')) return 'running';
  if (tools.every((t) => t.status === 'cancelled')) return 'cancelled';
  if (tools.every((t) => t.status === 'failed' || t.status === 'denied')) return 'failed';
  return 'done';
}

function statusIcon(status) {
  const box = el('span', 'tool-status');
  if (status === 'running' || status === 'queued') box.append(el('span', 'spinner'));
  else if (status === 'done') box.innerHTML = ICON.check;
  else if (status === 'failed' || status === 'denied') box.innerHTML = ICON.x;
  else if (status === 'cancelled') box.innerHTML = ICON.minus;
  else box.innerHTML = ICON.dot;
  return box;
}

function allTools(sessionId) {
  const main = transcriptOf(sessionId).filter((i) => i.type === 'tools').flatMap((g) => g.tools);
  const nested = [...agentsOf(sessionId).values()]
    .flatMap((a) => a.items.filter((i) => i.type === 'tools').flatMap((g) => g.tools));
  return [...main, ...nested];
}

function findTool(sessionId, id) {
  return allTools(sessionId).find((t) => t.id === id);
}

function addTool(sessionId, tool) {
  const items = transcriptOf(sessionId);
  const last = items[items.length - 1];
  if (last && last.type === 'tools' && !last.history) {
    tool.group = last;
    last.tools.push(tool);
    refreshItem(sessionId, last);
    return;
  }
  assistantStamp(sessionId);
  const group = { type: 'tools', sessionId, tools: [tool], open: false };
  tool.group = group;
  addItem(sessionId, group);
}

function updateTool(sessionId, id, patch) {
  const tool = findTool(sessionId, id);
  if (!tool) return;
  Object.assign(tool, patch);
  refreshItem(sessionId, tool.group);
  if (tool.group.agentId) agentChanged(sessionId, tool.group.agentId);
}

function toolMeta(tool) {
  const args = tool.arguments || {};
  const meta = el('span', 'tool-meta');
  const agent = tool.name === 'spawn_agent' && tool.agentId ? agentsOf(tool.group.sessionId).get(tool.agentId) : null;
  if (agent) {
    if (agentWaiting(agent)) {
      meta.append(el('span', 'waiting-note', 'Needs approval'));
    } else if (agent.status === 'running') {
      meta.textContent = agent.statusText || 'Working…';
    } else {
      const bits = [];
      if (agent.model) bits.push(agent.model);
      if (agent.credits != null) bits.push(`${fmtNum(agent.credits)} ${Number(agent.credits) === 1 ? 'credit' : 'credits'}`);
      meta.textContent = bits.join(' · ');
    }
    return meta;
  }
  if (tool.status === 'waiting') meta.textContent = 'Needs approval';
  else if (tool.status === 'denied') meta.textContent = 'Declined';
  else if (tool.status === 'cancelled') meta.textContent = 'Cancelled';
  else if (tool.name === 'fs_edit' && tool.status !== 'failed') {
    meta.append(el('span', 'add', `+${lineCount(args.new)}`), ' ', el('span', 'del', `−${lineCount(args.old)}`));
  } else if (tool.name === 'fs_write' && typeof args.content === 'string') {
    meta.textContent = `${lineCount(args.content)} lines`;
  } else if (tool.output && typeof tool.output === 'object' && tool.output.exit_code != null && tool.output.exit_code !== 0) {
    meta.append(el('span', 'bad', `exit ${tool.output.exit_code}`));
  }
  return meta;
}

function renderTool(tool) {
  if (tool.name === 'spawn_agent' && tool.agentId) return renderAgentTool(tool);
  const node = el('div', `tool ${tool.status}${tool.open ? ' open' : ''}`);
  const head = el('button', 'tool-head');
  const [verb, target] = toolSummary(tool);
  head.append(statusIcon(tool.status), el('span', 'tool-verb', verb), el('span', 'tool-target', firstLine(target)), toolMeta(tool), chevron());
  head.addEventListener('click', () => {
    tool.open = !tool.open;
    refreshItem(tool.group.sessionId, tool.group);
  });
  node.append(head);
  if (tool.open) node.append(toolBody(tool));
  if (tool.status === 'waiting') node.append(approvalBar(tool));
  return node;
}

function renderGroup(group) {
  if (group.tools.length === 1) return renderTool(group.tools[0]);
  const status = groupStatus(group.tools);
  const open = group.open || status === 'waiting';
  const node = el('div', `tool-group ${status}${open ? ' open' : ''}`);
  const head = el('button', 'tool-head');
  head.append(statusIcon(status), el('span', 'group-summary', groupSummary(group.tools)));
  if (status === 'running' || status === 'waiting') {
    const live = [...group.tools].reverse().find((t) => ACTIVE.includes(t.status));
    if (live) {
      const [verb, target] = toolSummary(live);
      head.append(el('span', 'tool-target', `${verb} ${firstLine(target)}`));
    }
  }
  const meta = el('span', 'tool-meta');
  const failed = group.tools.filter((t) => t.status === 'failed' || t.status === 'denied').length;
  if (status === 'waiting') meta.textContent = 'Needs approval';
  else if (failed && status !== 'failed') meta.append(el('span', 'bad', `${failed} failed`));
  else meta.textContent = `${group.tools.length} steps`;
  head.append(meta, chevron());
  head.addEventListener('click', () => {
    group.open = !open;
    refreshItem(group.sessionId, group);
  });
  node.append(head);
  if (open) {
    const body = el('div', 'group-body');
    for (const tool of group.tools) body.append(renderTool(tool));
    node.append(body);
  }
  return node;
}

function codeBlock(text) {
  const block = el('pre', 'code');
  block.textContent = clipText(text);
  return block;
}

function outputBlock(output) {
  if (output == null) return null;
  if (typeof output === 'string') return codeBlock(output);
  if (typeof output === 'object' && ('stdout' in output || 'stderr' in output)) {
    const block = el('pre', 'code');
    if (output.stdout) block.append(document.createTextNode(clipText(output.stdout)));
    if (output.stderr) {
      if (output.stdout) block.append('\n');
      block.append(el('span', 'err', clipText(output.stderr)));
    }
    if (!output.stdout && !output.stderr) {
      block.append(el('span', 'quiet', output.exit_code === 0 ? '(no output)' : `(exit ${output.exit_code})`));
    }
    return block;
  }
  return codeBlock(JSON.stringify(output, null, 2));
}

// What view_image looked at, shown where the agent looked at it: a file in the
// folder, read through the main process, or a picture on the web.
function toolImage(source) {
  const src = String(source == null ? '' : source);
  if (!src) return null;
  const img = el('img', 'tool-image');
  img.decoding = 'async';
  img.setAttribute('src', src);
  img.alt = src;
  img.title = src;
  if (adoptLocalImage(img)) return img;
  if (!/^https?:\/\//i.test(src)) return null;
  img.addEventListener('load', () => img.classList.add('ready'), { once: true });
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

// A picture already in hand, shown in a tool step.
function shownImage(url, name) {
  const img = el('img', 'tool-image ready');
  img.decoding = 'async';
  img.src = url;
  img.alt = name || 'Screenshot';
  return img;
}

function toolBody(tool) {
  const body = el('div', 'tool-body');
  const args = tool.arguments || {};
  const section = (label, node) => {
    if (node) body.append(el('div', 'tool-label', label), node);
  };
  switch (tool.name) {
    case 'run_command':
      section('Command', codeBlock(args.command));
      break;
    case 'execute_code':
      if (args.code) section(args.filename || 'Code', codeBlock(args.code));
      if (args.command) section('Command', codeBlock(args.command));
      break;
    case 'fs_edit': {
      const diff = el('pre', 'code');
      for (const line of String(args.old == null ? '' : args.old).split('\n')) diff.append(el('span', 'del', `- ${line}\n`));
      for (const line of String(args.new == null ? '' : args.new).split('\n')) diff.append(el('span', 'add', `+ ${line}\n`));
      section(args.path || 'Edit', diff);
      break;
    }
    case 'fs_write':
      section(args.path || 'File', codeBlock(args.content));
      break;
    case 'fs_read':
    case 'fs_glob':
      break;
    case 'view_image':
      section(args.source || 'Image', toolImage(args.source));
      break;
    case 'take_screenshot':
      // The picture comes from the main process when the call runs, so there
      // is nothing to show for a past run.
      if (tool.image) section(tool.imageTitle || 'Screenshot', shownImage(tool.image));
      break;
    default:
      if (Object.keys(args).length) section('Arguments', codeBlock(JSON.stringify(args, null, 2)));
  }
  if (tool.output !== undefined) section('Result', outputBlock(tool.output));
  else if (tool.history) body.append(el('div', 'tool-label', 'Results are not kept for past runs'));
  else body.append(el('div', 'tool-label', 'Waiting for the result…'));
  return body;
}

function approvalBar(tool) {
  const bar = el('div', 'approval');
  bar.append(el('span', 'approval-text', `CodingFleet ${REASONS[tool.reason] || 'wants to use a tool'}.`));
  const decide = (decision) => async () => {
    tool.status = decision === 'deny' ? 'denied' : 'queued';
    refreshItem(tool.group.sessionId, tool.group);
    if (tool.group.agentId) agentChanged(tool.group.sessionId, tool.group.agentId);
    await cf.decide({ callId: tool.id, decision });
  };
  const deny = el('button', 'btn danger', 'Deny');
  deny.addEventListener('click', decide('deny'));
  const always = el('button', 'btn', ALLOW_LABELS[tool.reason] || 'Allow all calls this session');
  always.addEventListener('click', decide('allow-session'));
  const allow = el('button', 'btn primary', 'Allow');
  allow.addEventListener('click', decide('allow'));
  bar.append(deny, always, allow);
  return bar;
}

// ── Edited files ───────────────────────────────────────────────────────────
// Undo puts every file in this card back to the version from before the run.
// A file touched since the run is kept: the second press is the one that
// overwrites it, and it says so first.
function undoButton(item) {
  const button = el('button', 'btn small undo-button', 'Undo');
  button.title = 'Put these files back the way they were before this run';
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const count = item.files.length;
    const ok = await confirmDialog({
      title: `Undo ${count} file change${count === 1 ? '' : 's'}?`,
      text: 'Each file goes back to the version from before this run. Anything you edited '
        + 'since the run is left alone.',
      confirm: 'Undo the run',
    });
    if (!ok) return;
    await runUndo(item, false);
  });
  return button;
}

async function runUndo(item, force) {
  try {
    const result = await call(cf.undoRun, { runId: item.runId, force });
    const done = result.restored.length;
    const conflicts = result.skipped.filter((s) => s.conflict);
    const other = result.skipped.filter((s) => !s.conflict);
    if (done) item.undone = `Undone (${done} file${done === 1 ? '' : 's'})`;
    refreshItem(item.sessionId, item);

    if (conflicts.length) {
      const names = conflicts.map((s) => s.path).join(', ');
      const force2 = await confirmDialog({
        title: `Keep your later edits to ${conflicts.length} file${conflicts.length === 1 ? '' : 's'}?`,
        text: `${names} changed after the run, so ${conflicts.length === 1 ? 'it was' : 'they were'} left alone. `
          + 'Undoing anyway overwrites what you did since.',
        confirm: 'Overwrite anyway',
        danger: true,
      });
      if (force2) return runUndo(item, true);
    }
    if (other.length) {
      showBanner(`Could not undo ${other.map((s) => `${s.path} (${s.reason})`).join(', ')}.`);
    } else if (done && !conflicts.length) {
      hideBanner();
    }
  } catch (err) {
    showBanner(err.message);
  }
}

function renderFiles(item) {
  const node = el('div', 'files-card');
  const added = item.files.reduce((sum, f) => sum + f.added, 0);
  const removed = item.files.reduce((sum, f) => sum + f.removed, 0);
  const head = el('div', 'files-head');
  const count = item.files.length;
  head.append(icon('file'), el('span', 'files-title', `Edited ${count} file${count === 1 ? '' : 's'}`),
    el('span', 'add', `+${added}`), el('span', 'del', `−${removed}`));
  if (item.runId && !item.undone) head.append(el('span', 'bar-spacer'), undoButton(item));
  if (item.undone) head.append(el('span', 'bar-spacer'), el('span', 'files-undone', item.undone));
  node.append(head);

  item.files.forEach((file, index) => {
    const open = item.open.has(index);
    const row = el('button', `file-row${open ? ' open' : ''}`);
    const slash = file.path.lastIndexOf('/');
    const name = el('span', 'file-name');
    if (slash >= 0) name.append(el('span', 'file-dir', file.path.slice(0, slash + 1)));
    name.append(file.path.slice(slash + 1));
    row.append(name);
    if (file.created) row.append(el('span', 'file-badge', 'new'));
    if (file.binary) row.append(el('span', 'file-badge', 'no diff'));
    const stats = el('span', 'file-stats');
    stats.append(el('span', 'add', `+${file.added}`), el('span', 'del', `−${file.removed}`));
    row.append(stats, chevron());
    row.addEventListener('click', () => {
      if (open) item.open.delete(index);
      else item.open.add(index);
      refreshItem(item.sessionId, item);
    });
    node.append(row);
    if (open) node.append(renderDiff(file));
  });
  return node;
}

function renderDiff(file) {
  const box = el('div', 'diff');
  if (file.binary) {
    box.append(el('div', 'diff-note', 'A binary or very large file: no line diff.'));
    return box;
  }
  file.hunks.forEach((hunk, index) => {
    if (index > 0) box.append(el('div', 'diff-gap', '⋯'));
    for (const line of hunk.lines) {
      const kind = line.t === '+' ? 'add' : line.t === '-' ? 'del' : 'ctx';
      const row = el('div', `dl ${kind}`);
      row.append(
        el('span', 'ln', line.old == null ? '' : line.old),
        el('span', 'ln', line.new == null ? '' : line.new),
        el('span', 'sign', line.t === '+' ? '+' : line.t === '-' ? '−' : ''),
        el('span', 'dtext', line.text),
      );
      box.append(row);
    }
  });
  if (file.truncated) box.append(el('div', 'diff-note', 'The diff is cut here: the change is too long to show.'));
  return box;
}

// ── Run events ─────────────────────────────────────────────────────────────
function onRunEvent({ sessionId, event, data }) {
  const run = S.running.get(sessionId);
  if (event.startsWith('subagent.') || (data && data.agent_id && (event === 'tool.call' || event === 'tool.result'))) {
    if (run && data?.agent_id) {
      if (!run.agentIds) run.agentIds = new Set();
      run.agentIds.add(data.agent_id);
    }
    onAgentEvent(sessionId, event, data || {});
    return;
  }
  switch (event) {
    case 'context.compacted':
      if (data.agent_id) break;
      closeLiveText(sessionId);
      addItem(sessionId, {
        type: 'compaction', before: data.before_tokens, after: data.after_tokens, manual: false, at: nowIso(),
      });
      setContextTokens(sessionId, data.after_tokens);
      break;
    case 'run.started':
      if (run) run.runId = data.run_id;
      break;
    case 'run.meta':
      if (run) run.model = data.model;
      break;
    case 'status':
      if (run) {
        if (data.state === 'started') run.status = data.kind;
        else if (run.status === data.kind) run.status = null;
        updateWorkingLabel(sessionId);
      }
      break;
    case 'notice':
      assistantStamp(sessionId);
      addItem(sessionId, { type: 'notice', text: data.message });
      break;
    case 'text.delta':
      if (run && run.status === 'thinking') {
        run.status = null;
        updateWorkingLabel(sessionId);
      }
      appendText(sessionId, data.text || '');
      break;
    case 'tool.call':
      closeLiveText(sessionId);
      if (!findTool(sessionId, data.id)) {
        addTool(sessionId, {
          id: data.id,
          name: data.name,
          arguments: data.arguments || {},
          status: data.executor === 'client' ? 'queued' : 'running',
          ...run?.replayTools?.get(data.id),
        });
      }
      break;
    case 'client.approval': {
      updateTool(sessionId, data.id, { status: 'waiting', reason: data.reason });
      const tool = findTool(sessionId, data.id);
      if (tool && tool.group.agentId && sessionId === S.current) openPanel(tool.group.agentId);
      notifyApproval(sessionId);
      break;
    }
    case 'client.tool_running':
      updateTool(sessionId, data.id, { status: 'running' });
      break;
    case 'client.tool_denied':
      updateTool(sessionId, data.id, { status: 'denied' });
      break;
    // The picture take_screenshot just took, so the step shows what the agent saw.
    case 'client.tool_image':
      updateTool(sessionId, data.id, { image: data.url, imageTitle: data.title, open: true });
      break;
    case 'tool.result': {
      const tool = findTool(sessionId, data.id);
      if (tool) {
        const status = tool.status === 'denied' ? 'denied' : data.ok ? 'done' : 'failed';
        const patch = { status, output: data.output };
        if (data.subagent && data.subagent.id) {
          patch.agentId = data.subagent.id;
          const agent = ensureAgent(sessionId, data.subagent.id, { callId: data.id });
          if (agent.status === 'running') {
            Object.assign(agent, {
              status: data.subagent.error ? 'failed' : 'done',
              credits: data.subagent.credits, summary: data.subagent.summary || agent.summary,
              model: data.subagent.model || agent.model, role: data.subagent.role || agent.role,
            });
          }
        }
        updateTool(sessionId, data.id, patch);
      }
      break;
    }
    case 'session.title': {
      const session = S.sessions.find((s) => s.id === sessionId);
      if (session && data.title) {
        session.title = data.title;
        renderSidebar();
        if (sessionId === S.current) renderTopbar();
      }
      break;
    }
    case 'usage': {
      if (run) run.usage = data;
      const session = S.sessions.find((s) => s.id === sessionId);
      if (session && data.context_tokens) {
        session.context = { ...(session.context || {}), tokens: data.context_tokens };
        if (sessionId === S.current) renderAccount();
      }
      break;
    }
    case 'run.ended':
      if (run) run.ended = data;
      break;
    case 'client.files_changed':
      if (run) {
        run.files = data.files || [];
        run.filesRunId = data.run_id || run.runId || null;
      }
      break;
    case 'client.reconnecting':
      // The whole run is about to be replayed: drop what this turn drew so far.
      if (run) {
        // Approval requests and local progress are not in the server replay.
        // Keep them, or reconnecting would hide an unanswered approval forever.
        if (!run.replayTools) run.replayTools = new Map();
        const remember = (items) => {
          for (const item of items) {
            for (const tool of item.tools || []) {
              const { status, reason, image, imageTitle } = tool;
              run.replayTools.set(tool.id, { status, reason, image, imageTitle });
            }
          }
        };
        remember(transcriptOf(sessionId).slice(run.turnStart));
        for (const id of run.agentIds || []) {
          const agent = agentsOf(sessionId).get(id);
          if (agent) remember(agent.items);
          agentsOf(sessionId).delete(id);
        }
        transcriptOf(sessionId).length = run.turnStart;
        run.stamped = false;
        if (sessionId === S.current) renderTranscript();
      }
      break;
    case 'client.error':
      addItem(sessionId, { type: 'error', text: data.message });
      break;
    case 'client.finished':
      finishRun(sessionId);
      break;
    default:
      break;
  }
}

function finishRun(sessionId) {
  const run = S.running.get(sessionId);
  S.running.delete(sessionId);
  closeLiveText(sessionId);
  for (const group of transcriptOf(sessionId).filter((i) => i.type === 'tools')) {
    let changed = false;
    for (const tool of group.tools) {
      if (ACTIVE.includes(tool.status)) {
        tool.status = 'cancelled';
        changed = true;
      }
    }
    if (changed) refreshItem(sessionId, group);
  }
  for (const agent of agentsOf(sessionId).values()) {
    for (const tool of agent.items.filter((i) => i.type === 'tools').flatMap((g) => g.tools)) {
      if (ACTIVE.includes(tool.status)) tool.status = 'cancelled';
    }
    if (agent.status === 'running') agent.status = 'cancelled';
    agentChanged(sessionId, agent.id);
  }
  if (sessionId === S.current) {
    const working = document.querySelector('.working');
    if (working) working.remove();
  }

  const ended = run && run.ended;
  if (ended && ended.reason === 'error') addItem(sessionId, { type: 'error', text: ended.error || 'The run failed.' });
  if (run && run.files && run.files.length) {
    addItem(sessionId, {
      type: 'files', sessionId, files: run.files, open: new Set(), runId: run.runId || run.filesRunId || null,
    });
  }
  const note = ended && ended.reason === 'cancelled' ? 'Stopped'
    : ended && ended.reason === 'budget' ? 'Stopped at the spend limit' : null;
  const usage = run && run.usage;
  if (usage || note) {
    addItem(sessionId, { type: 'footer', model: (run && run.model) || (usage && usage.model), usage, note });
  }

  if (S.init.shotExpand) expandForScreenshot(sessionId);
  if (sessionId === S.current) {
    renderTopbar();
    renderComposer();
  }
  renderSidebar();
  loadCredits();
  loadSessions().then(() => {
    const known = S.sessions.find((x) => x.id === sessionId);
    if (known) S.seenAnswer.set(sessionId, known.last_message_at || null);
  });
}

function expandForScreenshot(sessionId) {
  for (const item of transcriptOf(sessionId)) {
    if (item.type === 'tools') item.open = true;
    if (item.type === 'files') item.open.add(0);
  }
  if (sessionId === S.current) {
    renderTranscript();
    const tip = [...document.querySelectorAll('.has-tip')].pop();
    if (tip) tip.classList.add('show');
  }
}

function notifyApproval(sessionId) {
  if (document.hasFocus()) return;
  try {
    // eslint-disable-next-line no-new
    new Notification('CodingFleet needs your approval', {
      body: sessionLabel(S.sessions.find((s) => s.id === sessionId)),
    });
  } catch { /* notifications are optional */ }
}

// ── Attachments ────────────────────────────────────────────────────────────
// Files join the message being written: from the + menu, a drop anywhere on
// the window, or a paste. Each uploads at once, so Send only waits for the
// stragglers. The server checks every file; the limits here only spare a
// pointless upload.
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
let attachmentSeq = 0;

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function roomFor(count) {
  const free = MAX_ATTACHMENTS - S.attachments.length;
  if (count > free) {
    showBanner(free > 0 ? `You can attach ${free} more file${free === 1 ? '' : 's'} to this message.`
      : `A message can carry at most ${MAX_ATTACHMENTS} files.`);
  }
  return Math.max(0, Math.min(count, free));
}

// Where a new attachment goes, which decides what adding one means:
//   folder session  -> the agent already works on this computer. A text or
//                      code file is handed over by its path (inside the folder
//                      it reads it at once; outside, it asks you first), and
//                      nothing is uploaded. Images and documents only the
//                      server can read (PDF, Office) are uploaded.
//   sandbox session -> files are uploaded into that session's sandbox; for a
//                      session that does not exist yet, when you send.
function attachTarget() {
  const session = currentSession();
  if (session) {
    return session.executor === 'client'
      ? { mode: 'folder', cwd: local(session.id).cwd || null, key: `folder:${session.id}` }
      : { mode: 'sandbox', sessionId: session.id, key: `sandbox:${session.id}` };
  }
  if (S.draftSandbox) return { mode: 'sandbox', sessionId: null, draft: true, key: 'sandbox:new' };
  return { mode: 'folder', cwd: S.draftCwd || null, key: `folder:new:${S.draftCwd || ''}` };
}

function addAttachment(info, upload, target = attachTarget()) {
  const item = {
    key: ++attachmentSeq, name: info.name, size: info.size || 0, kind: info.kind || 'file',
    preview: info.preview || null, status: 'uploading', fileId: null, error: null,
    target: target.key, location: target.mode === 'sandbox' ? 'sandbox' : 'server',
  };
  if (item.size > MAX_ATTACHMENT_BYTES) {
    item.status = 'error';
    item.error = 'Larger than 20 MB';
  }
  S.attachments.push(item);
  if (item.status !== 'error' && upload) {
    item.start = (sessionId) => {
      item.status = 'uploading';
      item.promise = upload(sessionId).then((data) => {
        item.status = 'ready';
        item.fileId = data.id;
        item.kind = data.kind || item.kind;
        if (item.preview && item.kind === 'image') S.images.set(data.id, item.preview);
      }, (err) => {
        item.status = 'error';
        item.error = err.message;
      }).finally(() => {
        renderAttachments();
        updateSendButton();
      });
      return item.promise;
    };
    if (target.draft) item.status = 'queued';
    else item.start(target.sessionId || null);
  }
  renderAttachments();
  updateSendButton();
}

// A file the agent reads where it is: its path goes with the message.
function addReference(info, target) {
  S.attachments.push({
    key: ++attachmentSeq, name: info.name, size: info.size || 0, kind: 'path', status: 'ready',
    path: info.path, ref: info.inside ? info.relative : info.path, inside: info.inside, target: target.key,
  });
  renderAttachments();
  updateSendButton();
}

function attachInfos(infos) {
  const target = attachTarget();
  for (const info of infos.slice(0, roomFor(infos.length))) {
    if (target.mode === 'folder' && info.text) addReference(info, target);
    else addAttachment(info, (sessionId) => call(cf.uploadPath, { path: info.path, sessionId }), target);
  }
}

async function attachPaths(paths) {
  if (!paths.length) return;
  try {
    attachInfos(await call(cf.describeFiles, { paths, cwd: attachTarget().cwd || null }));
  } catch (err) {
    showBanner(err.message);
  }
}

async function pickAttachments() {
  closeMenus();
  try {
    attachInfos(await call(cf.pickFiles, { cwd: attachTarget().cwd || null }));
  } catch (err) {
    showBanner(err.message);
  }
}

function attachBytes(name, type, bytes, preview) {
  if (!roomFor(1)) return;
  addAttachment({ name, size: bytes.byteLength, kind: IMAGE_TYPES.includes(type) ? 'image' : 'file', preview },
    (sessionId) => call(cf.uploadData, { name, type, data: new Uint8Array(bytes), sessionId }));
}

function blobPreview(blob) {
  return new Promise((resolve) => {
    if (!IMAGE_TYPES.includes(blob.type) || blob.size > MAX_ATTACHMENT_BYTES) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function attachBlobs(blobs, fallbackName) {
  const take = roomFor(blobs.length);
  for (const blob of blobs.slice(0, take)) {
    const ext = (blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const name = blob.name || `${fallbackName}.${ext}`;
    const preview = await blobPreview(blob);
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      addAttachment({ name, size: blob.size, kind: 'file' }, null);
      continue;
    }
    attachBytes(name, blob.type, await blob.arrayBuffer(), preview);
  }
}

// A screenshot, attached so the model can see it. `mode` is 'region' (the user
// drags a rectangle), 'window' (one open window) or a screen.
async function takeScreenshot(mode, id) {
  closeMenus();
  if (!roomFor(1)) return;
  try {
    const shot = await call(cf.screenshot, { mode, id });
    if (!shot) return;   // the region was cancelled with Esc
    addAttachment({ name: shot.name, size: shot.data.length, kind: 'image', preview: shot.preview },
      (sessionId) => call(cf.uploadData, { name: shot.name, type: shot.type, data: shot.data, sessionId }));
  } catch (err) {
    showBanner(err.message);
  }
}

// One open window, chosen from its picture. Resolves to a source id, or null.
function pickWindowDialog(windows) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay');
    const modal = el('div', 'modal shot-picker');
    modal.setAttribute('role', 'dialog');
    const head = el('div', 'modal-head');
    head.append(el('h2', null, 'Which window?'));
    modal.append(head, el('p', 'modal-intro', 'The picture is taken of the whole window, even where '
      + 'something covers it.'));
    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    };
    if (windows.length) {
      const grid = el('div', 'shot-grid');
      for (const item of windows) {
        const card = el('button', 'shot-card');
        card.type = 'button';
        const frame = el('div', 'shot-frame');
        if (item.thumbnail) {
          const img = el('img');
          img.src = item.thumbnail;
          img.alt = '';
          frame.append(img);
        } else {
          frame.append(icon('monitor'));
        }
        const name = el('div', 'shot-name');
        if (item.icon) {
          const badge = el('img', 'shot-icon');
          badge.src = item.icon;
          badge.alt = '';
          name.append(badge);
        }
        name.append(el('span', null, item.name));
        card.title = item.name;
        card.append(frame, name);
        card.addEventListener('click', () => close(item.id));
        grid.append(card);
      }
      modal.append(grid);
    } else {
      modal.append(el('p', 'confirm-text', 'No other window is open.'));
    }
    const cancel = el('button', 'btn', 'Cancel');
    cancel.addEventListener('click', () => close(null));
    const actions = el('div', 'modal-actions');
    actions.append(el('div', 'bar-spacer'), cancel);
    modal.append(actions);
    overlay.append(modal);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    setTimeout(() => cancel.focus(), 0);
  });
}

async function pickWindowShot() {
  closeMenus();
  if (!roomFor(1)) return;
  let targets;
  try {
    targets = await call(cf.screenTargets);
  } catch (err) {
    showBanner(err.message);
    return;
  }
  const id = await pickWindowDialog(targets.windows || []);
  if (id) takeScreenshot('window', id);
}

// The screenshot choices, in the place the attach menu was.
async function openScreenshotMenu() {
  const menu = $('attachMenu');
  const list = $('attachList');
  list.replaceChildren();
  const note = el('div', 'attach-note');
  note.append(el('strong', null, 'Screenshot.'),
    el('span', null, ' It is uploaded with your message, so the model can see it.'));
  list.append(note);
  menuOption(list, 'crop', 'Select a region', 'Drag a rectangle on any screen. Esc cancels.',
    () => takeScreenshot('region'));
  menuOption(list, 'monitor', 'A window', 'Pick one open window, covered or not', pickWindowShot);
  const screens = el('div', 'menu-rows');
  list.append(screens);
  menu.hidden = false;
  let targets = null;
  try {
    targets = await call(cf.screenTargets);
  } catch { /* the screen row still works without the list */ }
  if (menu.hidden) return;
  const found = (targets && targets.screens) || [];
  if (found.length < 2) {
    menuOption(screens, 'monitor', 'The whole screen', 'The screen CodingFleet is on',
      () => takeScreenshot('screen'));
    return;
  }
  for (const item of found) {
    menuOption(screens, 'monitor', item.label,
      [`${item.width} × ${item.height}`, item.current ? 'where CodingFleet is' : '', item.primary ? 'main' : '']
        .filter(Boolean).join(' · '),
      () => takeScreenshot('screen', item.id));
  }
}

function removeAttachment(key) {
  const index = S.attachments.findIndex((a) => a.key === key);
  if (index === -1) return;
  const [item] = S.attachments.splice(index, 1);
  // An upload nobody will send is removed from the account too.
  const drop = (id) => { if (id) cf.deleteFile(id); };
  if (item.fileId) drop(item.fileId);
  else if (item.promise) item.promise.then(() => drop(item.fileId));
  renderAttachments();
  updateSendButton();
}

// Moving to another session: what was added for this one does not apply there.
function discardAttachments() {
  for (const item of [...S.attachments]) removeAttachment(item.key);
}

function attachmentChip(item, { removable }) {
  const chip = el('div', `att${item.status === 'error' ? ' error' : ''}`);
  chip.title = item.error ? `${item.name}: ${item.error}` : item.name;
  if (item.kind === 'path') chip.classList.add('ref');
  if (item.preview) {
    const img = el('img', 'att-thumb');
    img.alt = '';
    img.src = item.preview;
    chip.append(img);
  } else {
    const box = el('span', 'att-icon');
    box.innerHTML = item.kind === 'image' ? ICON.image : item.kind === 'path' ? ICON.folder : ICON.file;
    chip.append(box);
  }
  const text = el('span', 'att-text');
  const sub = item.status === 'uploading' ? 'Uploading…'
    : item.status === 'queued' ? 'Uploads to the sandbox when you send'
    : item.status === 'error' ? (item.error || 'Could not upload')
    : item.kind === 'path' ? (item.inside ? 'In the folder · not uploaded' : 'On this computer · read after you approve')
    : [item.kind === 'image' ? 'Image' : 'File', item.location === 'sandbox' ? 'in the sandbox' : '',
      item.size ? fmtSize(item.size) : ''].filter(Boolean).join(' · ');
  if (item.kind === 'path') chip.title = `${item.path}\n${item.inside
    ? 'The agent reads it from your folder.'
    : 'Outside the folder: the agent asks before reading it.'}`;
  text.append(el('span', 'att-name', item.name), el('span', 'att-sub', sub));
  chip.append(text);
  if (item.status === 'uploading') {
    const busy = el('span', 'att-busy');
    busy.append(el('span', 'spinner'));
    chip.append(busy);
  }
  if (removable) {
    const remove = el('button', 'att-remove');
    remove.title = 'Remove';
    remove.innerHTML = ICON.x;
    remove.addEventListener('click', () => removeAttachment(item.key));
    chip.append(remove);
  }
  return chip;
}

function renderAttachments() {
  const box = $('attachments');
  box.replaceChildren(...S.attachments.map((item) => attachmentChip(item, { removable: true })));
  box.hidden = S.attachments.length === 0;
}

// One row of the attach menu: an icon, a name and a line about it.
function menuOption(list, iconName, name, sub, run) {
  const row = el('button', 'menu-item');
  const main = el('div', 'mi-main');
  main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
  row.append(icon(iconName), main);
  row.addEventListener('click', run);
  list.append(row);
  return row;
}

function openAttachMenu() {
  closeMenus();
  const menu = $('attachMenu');
  menu.style.left = `${$('attachButton').offsetLeft}px`;
  const list = $('attachList');
  list.replaceChildren();
  const option = (iconName, name, sub, run) => menuOption(list, iconName, name, sub, run);
  const target = attachTarget();
  if (target.mode === 'folder') {
    const where = target.cwd ? baseName(target.cwd) : 'your project folder';
    const note = el('div', 'attach-note');
    note.append(el('strong', null, 'CodingFleet already works on your files.'),
      el('span', null, ` It reads and edits everything in ${where} — just name the file in your message.`));
    list.append(note);
    option('file', 'Add files', 'Passed by path, nothing uploaded. Files outside the folder need your approval.',
      pickAttachments);
    option('monitor', 'Screenshot', 'A region, a window or a whole screen', openScreenshotMenu);
    list.append(el('div', 'menu-empty', 'Images and PDF or Office documents are uploaded; the model reads them on CodingFleet.'));
  } else {
    option('upload', 'Upload to the sandbox', 'Any file: code, pages, data, images', pickAttachments);
    option('monitor', 'Screenshot', 'A region, a window or a whole screen', openScreenshotMenu);
    list.append(el('div', 'menu-empty', target.draft
      ? 'Files go into the new session\'s sandbox when you send. Or drop them anywhere, or paste an image.'
      : 'Or drop files anywhere, or paste an image.'));
  }
  menu.hidden = false;
}

// Checked before anything is sent: nothing failed, and nothing was added for
// another place (the sandbox, when the message now goes to a folder session).
function checkAttachments(targetKey = attachTarget().key) {
  const failed = S.attachments.find((a) => a.status === 'error');
  if (failed) throw new Error(`${failed.name} could not be attached (${failed.error}). Remove it to send.`);
  const elsewhere = S.attachments.find((a) => a.target !== targetKey);
  if (elsewhere) throw new Error(`${elsewhere.name} was added for another session or place. Remove it and add it again.`);
}

// The attachments a message is sent with: starts the uploads that waited for
// a session, and waits for all of them.
async function readyAttachments(sessionId, targetKey = attachTarget().key) {
  checkAttachments(targetKey);
  for (const item of S.attachments.filter((a) => a.status === 'queued')) item.start(sessionId);
  const pending = S.attachments.filter((a) => a.promise && a.status === 'uploading').map((a) => a.promise);
  if (pending.length) await Promise.allSettled(pending);
  checkAttachments(targetKey);
  return S.attachments.filter((a) => a.status === 'ready');
}

// What the model gets for files passed by path.
const REFERENCES_HEADER = '\n\nFiles for this message, on this computer (read them with your file tools):\n';
const OUTSIDE_NOTE = ' (outside the working folder)';

function withReferences(text, items) {
  const refs = items.filter((a) => a.kind === 'path');
  if (!refs.length) return text;
  const lines = refs.map((a) => `- \`${a.ref}\`${a.inside ? '' : OUTSIDE_NOTE}`);
  return `${text}${REFERENCES_HEADER}${lines.join('\n')}`;
}

// The reverse of withReferences, for a message read back from the server.
function splitReferences(text) {
  const value = String(text || '');
  const at = value.lastIndexOf(REFERENCES_HEADER);
  if (at === -1) return { text: value, refs: [] };
  const refs = [];
  for (const line of value.slice(at + REFERENCES_HEADER.length).split('\n')) {
    let body = line.trim();
    const inside = !body.endsWith(OUTSIDE_NOTE);
    if (!inside) body = body.slice(0, -OUTSIDE_NOTE.length);
    if (!body.startsWith('- `') || !body.endsWith('`') || body.length < 5) return { text: value, refs: [] };
    const ref = body.slice(3, -1);
    refs.push({ kind: 'path', status: 'ready', name: ref.split(/[\\/]/).pop(), path: ref, ref, inside });
  }
  return { text: value.slice(0, at), refs };
}

const uploadedIds = (items) => items.filter((a) => a.fileId).map((a) => a.fileId);

function clearAttachments() {
  S.attachments = [];
  renderAttachments();
}

// ── Drag and drop, paste ───────────────────────────────────────────────────
let dragDepth = 0;
const draggingFiles = (event) => [...(event.dataTransfer && event.dataTransfer.types || [])].includes('Files');

function wireDrop() {
  window.addEventListener('dragenter', (event) => {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    const target = attachTarget();
    $('dropTitle').textContent = target.mode === 'folder' ? 'Drop to add' : 'Drop to upload to the sandbox';
    $('dropSub').textContent = target.mode === 'folder'
      ? 'The agent reads text and code where they are — nothing is uploaded. Images and documents are.'
      : 'Any file, up to 20 MB each';
    $('dropOverlay').hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!draggingFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!draggingFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('dropOverlay').hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    $('dropOverlay').hidden = true;
    const files = [...(event.dataTransfer ? event.dataTransfer.files : [])];
    if (!files.length) return;
    if (!S.settings.hasKey) {
      openSettings(true);
      return;
    }
    const paths = [];
    const blobs = [];
    for (const file of files) {
      const where = cf.pathForFile(file);
      if (where) paths.push(where);
      else blobs.push(file);
    }
    if (paths.length) attachPaths(paths);
    if (blobs.length) attachBlobs(blobs, 'dropped');
    $('prompt').focus();
  });
  $('prompt').addEventListener('paste', (event) => {
    const images = [...(event.clipboardData ? event.clipboardData.items : [])]
      .filter((item) => item.kind === 'file' && IMAGE_TYPES.includes(item.type))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!images.length) return;
    event.preventDefault();
    attachBlobs(images, 'pasted-image');
  });
}

// ── Compaction ─────────────────────────────────────────────────────────────
// Older messages summarized to make room in the context: by the button, or on
// its own when the conversation nears the limit.
const MIN_COMPACT_TOKENS = 20_000;
const compacting = new Set();

function compactionChip(item) {
  const node = el('div', 'compaction');
  node.append(icon('compress', 'icon'));
  const text = el('span', 'compaction-text');
  text.append(el('strong', null, item.manual ? 'Compacted the conversation' : 'Compacted the conversation automatically'));
  if (item.before && item.after != null) {
    text.append(el('span', 'compaction-stats', `${fmtCompact(item.before)} → ${fmtCompact(item.after)} tokens`));
  }
  node.append(text);
  node.title = item.manual
    ? 'Older messages were summarized on request. The newest ones are kept as they are.'
    : 'The conversation neared its context limit, so older messages were summarized. '
      + 'The newest ones are kept as they are.';
  if (item.before && item.after != null) {
    node.title += `\nBefore: ${Number(item.before).toLocaleString()} tokens. Now: ${Number(item.after).toLocaleString()} tokens.`;
  }
  return node;
}

function setContextTokens(sessionId, tokens) {
  const session = S.sessions.find((s) => s.id === sessionId);
  if (!session || tokens == null) return;
  session.context = { ...(session.context || {}), tokens };
  if (sessionId === S.current) renderAccount();
}

function compactButton(session) {
  const button = el('button', 'compact-button');
  const busy = compacting.has(session.id);
  const running = S.running.has(session.id);
  const small = ((session.context || {}).tokens || 0) < MIN_COMPACT_TOKENS;
  button.append(icon('compress', 'icon'), el('span', null, busy ? 'Compacting…' : 'Compact'));
  button.disabled = busy || running || small;
  button.title = running ? 'Wait for the run to finish, then compact.'
    : small ? 'The conversation is still small: there is nothing worth compacting.'
      : 'Summarize the older messages now, to free context. The newest messages stay as they are.';
  button.addEventListener('click', () => compactSession(session.id));
  return button;
}

async function compactSession(sessionId) {
  if (compacting.has(sessionId)) return;
  compacting.add(sessionId);
  renderAccount();
  try {
    const data = await call(cf.compactSession, sessionId);
    const c = data.compaction || {};
    addItem(sessionId, { type: 'compaction', before: c.before_tokens, after: c.after_tokens, manual: true, at: c.at });
    if (data.context) {
      const session = S.sessions.find((s) => s.id === sessionId);
      if (session) session.context = data.context;
    }
  } catch (err) {
    showBanner(`The conversation could not be compacted: ${err.message}`);
  } finally {
    compacting.delete(sessionId);
    renderAccount();
  }
}

// ── Voice input ────────────────────────────────────────────────────────────
// Click the microphone to record, click again to stop; the text is typed into
// the composer where the cursor is. The recording goes to CodingFleet to be
// transcribed and is not kept.
const MAX_RECORDING_MS = 120_000;
const voice = {
  recorder: null, stream: null, chunks: [], state: 'idle', started: 0, timer: null, cancelled: false,
  sendAfter: false, // Send was pressed while recording: send once the words are in
};

function renderMic() {
  const button = $('micButton');
  if (!button) return;
  button.classList.toggle('recording', voice.state === 'recording');
  button.classList.toggle('busy', voice.state === 'transcribing');
  button.disabled = voice.state === 'transcribing';
  if (voice.state === 'recording') {
    const secs = Math.floor((Date.now() - voice.started) / 1000);
    button.replaceChildren(el('span', 'rec-dot'), el('span', 'rec-time',
      `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`));
    button.title = 'Stop and type what you said (Esc cancels)';
  } else if (voice.state === 'transcribing') {
    button.replaceChildren(el('span', 'spinner small'));
    button.title = 'Turning your recording into text…';
  } else {
    button.replaceChildren(icon('mic'));
    button.title = 'Voice input';
  }
}

async function toggleVoice() {
  if (voice.state === 'recording') return stopVoice();
  if (voice.state !== 'idle') return undefined;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showBanner(err && err.name === 'NotFoundError'
      ? 'No microphone was found.'
      : 'The microphone could not be used. Check that Windows lets apps use it (Settings → Privacy → Microphone).');
    return undefined;
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  Object.assign(voice, { recorder, stream, chunks: [], state: 'recording', started: Date.now(), cancelled: false });
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size) voice.chunks.push(event.data); });
  recorder.addEventListener('stop', finishVoice);
  recorder.start(1000);
  updateSendButton();
  voice.timer = setInterval(() => {
    if (Date.now() - voice.started >= MAX_RECORDING_MS) stopVoice();
    else renderMic();
  }, 500);
  renderMic();
  return undefined;
}

function stopVoice(cancel = false) {
  if (voice.state !== 'recording') return;
  voice.cancelled = cancel;
  if (cancel) voice.sendAfter = false;
  clearInterval(voice.timer);
  voice.recorder.stop();
  for (const track of voice.stream.getTracks()) track.stop();
}

async function finishVoice() {
  const { chunks, recorder, cancelled } = voice;
  Object.assign(voice, { recorder: null, stream: null, chunks: [], state: cancelled ? 'idle' : 'transcribing' });
  renderMic();
  updateSendButton();
  if (cancelled || !chunks.length) {
    voice.state = 'idle';
    voice.sendAfter = false;
    renderMic();
    updateSendButton();
    return;
  }
  let heard = false;
  const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
  try {
    const data = new Uint8Array(await blob.arrayBuffer());
    const result = await call(cf.transcribe, { data, type: blob.type });
    heard = Boolean(insertIntoPrompt((result && result.text) || ''));
  } catch (err) {
    showBanner(`Your recording could not be turned into text: ${err.message}`);
  } finally {
    voice.state = 'idle';
    renderMic();
    updateSendButton();
  }
  const send = voice.sendAfter;
  voice.sendAfter = false;
  if (send && heard) sendMessage();
  else if (send) showBanner('Nothing was heard in your recording, so nothing was sent.');
}

// Send while recording: stop, type the words, then send. While the words
// are still on their way, it sends once they arrive.
function sendAfterVoice() {
  if (voice.state === 'idle') return false;
  voice.sendAfter = true;
  if (voice.state === 'recording') stopVoice();
  updateSendButton();
  return true;
}

function insertIntoPrompt(text) {
  text = text.trim();
  if (!text) return false;
  const prompt = $('prompt');
  const start = prompt.selectionStart ?? prompt.value.length;
  const end = prompt.selectionEnd ?? prompt.value.length;
  const before = prompt.value.slice(0, start);
  const after = prompt.value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const tail = after && !/^\s/.test(after) ? ' ' : '';
  prompt.value = before + lead + text + tail + after;
  const caret = (before + lead + text).length;
  prompt.focus();
  prompt.setSelectionRange(caret, caret);
  rememberDraft();
  autosize();
  updateSendButton();
  return true;
}

// ── What a run will cost ───────────────────────────────────────────────────
// An estimate, not a quote. An agentic run makes several model calls, each
// re-sending the conversation, and nobody knows in advance how many. Two ways
// to guess, best first:
//   history  what this session's earlier runs on this model actually cost,
//            scaled by how much the conversation has grown since
//   model    the model's published price times an assumed number of steps
// Above WARN_CREDITS the composer stops and offers cheaper models instead.
// The arithmetic lives in cost.js, which has no state and its own tests.
// Kept behind COST: app.js has its own fromHistory, for transcripts.
const COST = window.CF_COST;
const { WARN_CREDITS, ASSUMED_STEPS } = COST;
const roundCredits = COST.round;

const modelById = (id) => S.models.find((m) => m.id === id) || null;

// What a model costs here: nothing when the plan covers it or it is free.
function effectiveRate(model) {
  if (!model) return null;
  if (planIncludes(model)) return 0;
  return model.credits_per_20k_tokens || 0;
}

function contextTokensOf(sessionId) {
  const session = sessionId ? S.sessions.find((s) => s.id === sessionId) : null;
  return (session && session.context && session.context.tokens) || 0;
}

// What this session's past runs on this model really cost, scaled to the
// conversation's size now. Nothing to say until a run has finished.
// modelId null means any model: on Auto the server picks per message, so what
// the session has cost so far is the only honest guide.
function historyEstimate(sessionId, modelId, contextNow) {
  if (!sessionId) return null;
  const sameModel = (i) => !modelId || !i.model || i.model === modelId
    || modelLabel(i.model) === modelLabel(modelId);
  const past = transcriptOf(sessionId)
    .filter((i) => i.type === 'footer' && i.usage && Number(i.usage.credits) > 0 && sameModel(i))
    .slice(-3)
    .map((i) => ({ credits: Number(i.usage.credits), contextTokens: i.usage.context_tokens || 0 }));
  return COST.fromHistory(past, contextNow);
}

/** @returns {{known: boolean, credits?: number, basis?: string, model?: object}} */
function estimateRun({ sessionId, modelId, promptText }) {
  // "Auto" is the server's choice, made per message, so there is no price list
  // to read. What this session has already cost is the one honest guide.
  if (!modelId || modelId === 'auto') {
    const past = historyEstimate(sessionId, null, contextTokensOf(sessionId));
    return past ? { known: true, ...past, model: null } : { known: false, basis: 'auto' };
  }
  const model = modelById(modelId);
  if (!model) return { known: false, basis: 'unknown' };
  const contextNow = contextTokensOf(sessionId);
  if (effectiveRate(model) === 0) {
    return { known: true, credits: 0, basis: planIncludes(model) ? 'plan' : 'free', model };
  }
  const guess = historyEstimate(sessionId, modelId, contextNow)
    || COST.fromModelPrice({ rate: effectiveRate(model), contextTokens: contextNow, promptText });
  return guess ? { known: true, ...guess, model } : { known: false, basis: 'unknown' };
}

// The smartest models that cost less than this one. Plan-covered models count
// as free, so they come out on top when the plan includes something good.
function cheaperAlternatives(model, limit = 2) {
  return COST.rankAlternatives(S.models, model, effectiveRate, limit);
}

// The pill beside the model button: what this run looks likely to cost. It
// sits next to the model because that is what it depends on, and it stays put
// when the sub-agent panel opens.
function updateCostHint() {
  const pill = $('costPill');
  if (!pill) return;
  const estimate = estimateRun({
    sessionId: S.current, modelId: S.model, promptText: $('prompt').value,
  });
  // Nothing to say yet: Auto before its first run, or a model we do not know.
  if (!estimate.known) {
    pill.hidden = true;
    return;
  }
  const n = roundCredits(estimate.credits);
  pill.hidden = false;
  pill.classList.toggle('high', estimate.credits >= WARN_CREDITS);
  // The pill is a price and nothing else. A word like "Included" took the place
  // of the number, which is the one thing this is here to say.
  if (!estimate.credits) {
    pill.textContent = '0 cr';
    pill.title = estimate.basis === 'plan'
      ? 'Your plan covers this model: this run costs no credits.'
      : 'A free model: this run costs no credits.';
    return;
  }
  pill.textContent = n < 1 ? '≈ <1 cr' : `≈ ${fmtNum(n)} cr`;
  pill.title = `${estimate.basis === 'history'
    ? `A rough estimate from this session's last ${estimate.runs === 1 ? 'run' : `${estimate.runs} runs`}`
    : "A rough estimate from the model's price and a run of about 5 steps"}`
    + ', scaled to how long the conversation is now. The real cost depends on how much '
    + 'work the agent does.';
}

// Above the threshold, offer the smartest cheaper models before spending.
// Resolves 'send', 'cancel', or a model id to switch to and then send.
function costDialog({ estimate, alternatives }) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay confirm-overlay');
    const modal = el('div', 'modal cost-modal');
    modal.setAttribute('role', 'alertdialog');
    const credits = roundCredits(estimate.credits);
    modal.append(el('h2', 'confirm-title', `This run could cost about ${fmtNum(credits)} credits`));
    const runs = estimate.runs === 1 ? 'run' : `${estimate.runs} runs`;
    const why = estimate.basis === 'history'
      ? `Based on what this session's last ${runs} cost${estimate.model ? ` on ${modelLabel(estimate.model.id)}` : ''}, `
        + 'and how long the conversation has grown.'
      : `Based on ${modelLabel(estimate.model.id)}'s price and a run of about ${ASSUMED_STEPS} steps.`;
    const pickOne = estimate.model ? '' : ' Choose a model instead of Auto to see cheaper ones suggested here.';
    modal.append(el('p', 'confirm-text',
      `${why} The real cost depends on how much work the agent does.${pickOne}`));

    if (alternatives.length) {
      modal.append(el('div', 'cost-lead', alternatives.length === 1
        ? 'A cheaper model that is nearly as capable:'
        : 'Cheaper models that are nearly as capable:'));
      const list = el('div', 'cost-options');
      for (const alt of alternatives) {
        const row = el('button', 'menu-item cost-option');
        const main = el('div', 'mi-main');
        // The same run, priced at this model instead: the whole point is the gap.
        const ownRate = effectiveRate(estimate.model);
        const would = ownRate ? roundCredits(estimate.credits * (effectiveRate(alt) / ownRate)) : null;
        const less = ownRate ? Math.round((1 - effectiveRate(alt) / ownRate) * 100) : 0;
        main.append(
          el('div', 'mi-name', alt.name),
          el('div', 'mi-sub', would == null ? alt.id
            : `≈ ${fmtNum(would)} credits instead of ${fmtNum(roundCredits(estimate.credits))} — ${less}% less`),
        );
        row.append(main, modelColumns(
          alt.supports_vision,
          alt.intelligence_index || 0,
          planIncludes(alt) ? includedPill() : creditRange([alt]),
        ));
        row.addEventListener('click', () => close(alt.id));
        list.append(row);
      }
      modal.append(list);
    }

    const cancel = el('button', 'btn', 'Cancel');
    const send = el('button', 'btn primary', 'Send anyway');
    const actions = el('div', 'modal-actions');
    actions.append(el('div', 'bar-spacer'), cancel, send);
    modal.append(actions);
    overlay.append(modal);

    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close('cancel');
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close('cancel'));
    send.addEventListener('click', () => close('send'));
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close('cancel'); });
    document.body.append(overlay);
    setTimeout(() => send.focus(), 0);
  });
}

/** False when the person decided not to send after seeing the price. */
async function clearedToSpend(sessionId, promptText) {
  const estimate = estimateRun({ sessionId, modelId: S.model, promptText });
  if (!estimate.known || estimate.credits < WARN_CREDITS) return true;
  // On Auto there is no chosen model to be dearer than, so there is nothing to
  // recommend: the warning still stands, without a list.
  const answer = await costDialog({
    estimate, alternatives: estimate.model ? cheaperAlternatives(estimate.model) : [],
  });
  if (answer === 'cancel') return false;
  if (answer !== 'send') {
    chooseModel(answer);
    $('prompt').value = promptText;
    autosize();
  }
  return true;
}

// ── Composer ───────────────────────────────────────────────────────────────
// Each session keeps the message typed but not sent, and so does the new
// session. They are kept on this computer, across restarts.
const DRAFTS_KEY = 'cf.drafts';
const drafts = (() => {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY)) || {}; } catch { return {}; }
})();
let draftTimer = null;
const draftKey = (id) => id || 'new';

function storeDrafts() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch { /* kept for this run only */ }
  }, 300);
}

// Keeps what the composer holds now as the draft of session `id`.
function rememberDraft(id = S.current) {
  const text = $('prompt').value;
  if (text.trim()) drafts[draftKey(id)] = text;
  else delete drafts[draftKey(id)];
  storeDrafts();
}

function forgetDraft(id) {
  delete drafts[draftKey(id)];
  storeDrafts();
}

function restoreDraft() {
  $('prompt').value = drafts[draftKey(S.current)] || '';
  autosize();
  updateSendButton();
}

function autosize() {
  const prompt = $('prompt');
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 240)}px`;
}

function renderComposer() {
  const session = currentSession();
  const running = Boolean(S.current && S.running.has(S.current));
  const prompt = $('prompt');
  prompt.placeholder = running
    ? 'Send a message to steer the agent while it works…'
    : session ? 'Reply to CodingFleet…' : 'Ask CodingFleet to build, fix or explain something…';

  const sandbox = session ? session.executor !== 'client' : S.draftSandbox;
  const cwd = session ? local(session.id).cwd : (sandbox ? null : S.draftCwd);
  const folder = $('folderButton');
  folder.replaceChildren(
    icon(sandbox ? 'sparkle' : 'folder'),
    el('span', null, sandbox ? 'Cloud sandbox' : cwd ? baseName(cwd) : 'Choose folder'),
    icon('caret', 'icon caret'),
  );
  folder.title = sandbox ? "Tools run on CodingFleet's servers" : (cwd || 'Choose where this session runs');

  const modelButton = $('modelButton');
  modelButton.replaceChildren(...modelButtonParts(S.model));
  modelButton.title = 'Model';

  const effortParts = effortButtonParts(S.model);
  const effortButton = $('effortButton');
  effortButton.hidden = !effortParts;
  if (effortParts) {
    effortButton.replaceChildren(...effortParts);
    effortButton.title = 'Thinking effort';
  }

  $('attachButton').replaceChildren(icon('plus'));
  $('attachButton').setAttribute('aria-label', 'Attach');
  $('permButton').replaceChildren(
    icon(S.permission === 'auto' ? 'bolt' : 'shield'),
    el('span', null, S.permission === 'auto' ? 'Auto-approve' : 'Ask before changes'),
    icon('caret', 'icon caret'),
  );

  $('hint').textContent = running ? 'Enter to steer' : '';
  updateCostHint();
  updateSendButton();
}

function updateSendButton() {
  updateCostHint();
  const running = Boolean(S.current && S.running.has(S.current));
  const hasText = Boolean($('prompt').value.trim());
  const uploading = S.attachments.some((a) => a.status === 'uploading');
  const send = $('send');
  if (voice.state !== 'idle') {
    // Recording: Send stops it, types the words, and sends them.
    send.classList.remove('stop');
    send.innerHTML = ICON.arrowUp;
    send.disabled = voice.sendAfter;
    send.title = voice.sendAfter ? 'Sends as soon as your words are typed'
      : voice.state === 'recording' ? 'Stop recording and send what you said' : 'Send once your words are typed';
    return;
  }
  const stop = running && !hasText;
  send.classList.toggle('stop', stop);
  send.innerHTML = stop ? ICON.stop : ICON.arrowUp;
  send.title = stop ? 'Stop' : running ? 'Steer (Enter)' : 'Send (Enter)';
  send.disabled = (!stop && !hasText) || S.sending;
  send.title = uploading && !stop ? 'Sends once the files finish uploading' : send.title;
}

function showBanner(text, actions = []) {
  const banner = $('banner');
  banner.replaceChildren(el('span', null, text));
  for (const action of actions) {
    const button = el('button', 'btn', action.label);
    button.addEventListener('click', action.run);
    banner.append(button);
  }
  const close = el('button', 'btn', 'Dismiss');
  close.addEventListener('click', hideBanner);
  banner.append(close);
  banner.hidden = false;
}

function hideBanner() {
  $('banner').hidden = true;
}

async function pickFolder() {
  const dir = await call(cf.pickFolder);
  if (!dir) return null;
  S.draftCwd = dir;
  S.init.state.lastCwd = dir;
  cf.setState({ lastCwd: dir });
  renderMain();
  return dir;
}

async function sendMessage() {
  if (sendAfterVoice()) return;
  const prompt = $('prompt');
  const text = prompt.value.trim();
  if (!text || S.sending) return;
  const typedIn = S.current;
  if (!S.settings.hasKey) {
    openSettings(true);
    return;
  }
  hideBanner();

  if (S.current && S.running.has(S.current)) {
    const id = S.current;
    if (S.attachments.some((a) => a.kind === 'file')) {
      showBanner('Only images can be sent while the agent works. Attach other files to your next message.');
      return;
    }
    prompt.value = '';
    forgetDraft(typedIn);
    autosize();
    updateSendButton();
    let steerFiles = [];
    try {
      steerFiles = await readyAttachments(id);
      if (uploadedIds(steerFiles).length > 3) throw new Error('At most 3 images can be sent while the agent works.');
      await call(cf.steerRun, {
        sessionId: id, message: withReferences(text, steerFiles), files: uploadedIds(steerFiles),
      });
      clearAttachments();
      addItem(id, { type: 'user', text, steer: true, at: nowIso(), files: steerFiles });
    } catch (err) {
      prompt.value = text;
      rememberDraft();
      autosize();
      showBanner(err.message);
    }
    updateSendButton();
    return;
  }

  // A costly run says so before it starts, and offers cheaper models.
  if (!(await clearedToSpend(S.current, text))) return;

  S.sending = true;
  updateSendButton();
  let id = S.current;
  let started = false;
  let sentFiles = [];
  const sendTarget = attachTarget().key;
  try {
    checkAttachments(sendTarget);
    if (!id) {
      // No folder means a cloud sandbox: the tools run on CodingFleet instead.
      const cwd = S.draftSandbox ? null : (S.draftCwd || (await pickFolder()));
      if (!cwd && !S.draftSandbox) return;
      const session = await call(cf.createSession, { cwd, model: S.model, label: text });
      S.init.state.sessions[session.id] = { cwd: cwd || null, label: text.slice(0, 80) };
      S.sessions.unshift(session);
      S.transcripts.set(session.id, []);
      S.loaded.add(session.id);
      id = session.id;
      S.current = id;
      if (session.agentsFile) {
        transcriptOf(id).push({
          type: 'note',
          text: `Following ${session.agentsFile} from this folder.`,
        });
      }
    } else {
      const session = currentSession();
      if (session && session.executor === 'client' && !local(id).cwd) {
        const cwd = await call(cf.pickFolder);
        if (!cwd) return;
        await call(cf.setFolder, { sessionId: id, cwd });
        S.init.state.sessions[id] = { ...local(id), cwd };
      }
    }

    sentFiles = await readyAttachments(id, sendTarget);
    prompt.value = '';
    forgetDraft(typedIn);
    autosize();
    transcriptOf(id).push({ type: 'user', text, at: nowIso(), files: sentFiles });
    clearAttachments();
    S.running.set(id, { runId: null, started: Date.now(), turnStart: transcriptOf(id).length });
    started = true;
    const session = S.sessions.find((s) => s.id === id);
    if (session) {
      session.status = 'active';
      session.last_used_at = nowIso();
    }
    renderSidebar();
    renderMain();
    await call(cf.startRun, {
      sessionId: id, message: withReferences(text, sentFiles), model: S.model,
      executor: session ? session.executor : 'client', files: uploadedIds(sentFiles),
    });
    S.init.state.sessions[id] = { ...local(id), model: S.model };
    loadCredits(); // the run now holds one of the account's run slots
  } catch (err) {
    if (started) {
      S.running.delete(id);
      const items = transcriptOf(id);
      if (items.length && items[items.length - 1].type === 'user') items.pop();
      // Back into the composer, to send again.
      if (sentFiles.length && !S.attachments.length) {
        S.attachments = sentFiles;
        renderAttachments();
      }
      renderMain();
    }
    if (!prompt.value) {
      prompt.value = text;
      rememberDraft();
      autosize();
    }
    showBanner(err.message);
  } finally {
    S.sending = false;
    renderComposer();
  }
}

async function stopRun() {
  const id = S.current;
  const run = id && S.running.get(id);
  if (!run) return;
  run.stopping = true;
  const label = document.querySelector('.working .shimmer');
  if (label) label.textContent = 'Stopping…';
  const res = await cf.cancelRun(id);
  if (!res.ok) {
    run.stopping = false;
    if (label) label.textContent = 'Working…';
    showBanner(res.error.message);
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────
function newSession() {
  closeMenus();
  hideBanner();
  if (S.current !== null) discardAttachments();
  S.current = null;
  restoreDraft();
  S.model = S.init.state.model || 'auto';
  S.panel.open = false;
  renderPanel();
  renderSidebar();
  renderAccount();
  renderMain();
  $('prompt').focus();
}

const showsAsImage = (file) => file.kind === 'image' && !file.deleted && Boolean(file.preview || file.fileId);

// A sent image: its preview, fetched again for a reopened session; click to see it whole.
function imageCard(file) {
  const img = el('img', 'msg-image');
  img.alt = file.name || 'Image';
  img.title = file.name || '';
  img.decoding = 'async';
  img.addEventListener('load', () => img.classList.add('ready'), { once: true });
  img.addEventListener('click', () => openViewer({ src: img.src, fileId: file.fileId, name: file.name }));
  const preview = file.preview || S.images.get(file.fileId);
  if (preview) {
    img.src = preview;
  } else {
    img.classList.add('pending');
    call(cf.image, { fileId: file.fileId }).then((src) => {
      S.images.set(file.fileId, src);
      file.preview = src;
      img.src = src;
    }, () => {
      img.replaceWith(attachmentChip({ ...file, status: 'ready' }, { removable: false }));
    }).finally(() => img.classList.remove('pending'));
  }
  return img;
}

// The whole image over the app. Esc, or a click anywhere, closes it.
// `full` is a promise of a larger copy, shown as soon as it arrives.
function openViewer({ src, fileId, name, full }) {
  if (!src && !fileId && !full) return;
  closeViewer();
  const overlay = el('div', 'viewer');
  overlay.id = 'viewer';
  const img = el('img', 'viewer-image');
  img.alt = name || 'Image';
  img.addEventListener('load', () => img.classList.add('ready'));
  if (src) img.src = src;
  overlay.append(img);
  if (name) overlay.append(el('div', 'viewer-name', name));
  overlay.addEventListener('click', closeViewer);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const larger = fileId ? call(cf.image, { fileId, full: true }) : full;
  if (larger) {
    Promise.resolve(larger).then((url) => {
      if (url && overlay.isConnected) img.src = url;
    }, () => {});
  }
}

function closeViewer() {
  const overlay = document.getElementById('viewer');
  if (overlay) overlay.remove();
}

function fromHistory(sessionId, messages, compactions = []) {
  const items = [];
  // A compaction goes before the first message that came after it: an
  // automatic one lands between the prompt and the answer it made room for.
  const pending = [...compactions].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const flushCompactions = (until) => {
    while (pending.length && (!until || Date.parse(pending[0].at) <= Date.parse(until))) {
      const c = pending.shift();
      items.push({ type: 'compaction', before: c.before_tokens, after: c.after_tokens, manual: c.manual, at: c.at });
    }
  };
  for (const message of messages) {
    if (message.created_at) flushCompactions(message.created_at);
    if (message.role === 'user') {
      const { text, refs } = splitReferences(message.text);
      items.push({
        type: 'user', text, at: message.created_at,
        files: [...refs, ...(message.files || []).map((file) => ({
          name: file.filename || file.id, size: file.size, kind: file.kind, deleted: file.deleted,
          fileId: file.id, preview: S.images.get(file.id) || null,
        }))],
      });
      for (const steer of message.steers || []) {
        const parts = splitReferences(String(steer));
        items.push({ type: 'user', text: parts.text, files: parts.refs, steer: true });
      }
      continue;
    }
    if (message.created_at) items.push({ type: 'stamp', at: message.created_at });
    // Tools sit between the paragraphs they came between (text_offset); tools
    // called together, with no text between them, share one group. An older
    // turn has no offsets: its tools come first, in one group.
    const text = message.text || '';
    let cursor = 0;
    let group = null;
    const pushText = (upTo) => {
      const chunk = text.slice(cursor, upTo).trim();
      cursor = upTo;
      if (!chunk) return;
      items.push({ type: 'assistant', text: chunk });
      group = null;
    };
    for (const tool of message.tools || []) {
      const at = Number.isInteger(tool.text_offset) ? Math.min(tool.text_offset, text.length) : cursor;
      if (at > cursor) pushText(at);
      if (!group) {
        group = { type: 'tools', sessionId, tools: [], open: false, history: true };
        items.push(group);
      }
      const entry = {
        id: null, group, name: tool.name, arguments: tool.arguments || {},
        status: tool.ok ? 'done' : 'failed', history: true,
      };
      if (tool.subagent && tool.subagent.id) {
        entry.agentId = tool.subagent.id;
        const known = agentsOf(sessionId).get(tool.subagent.id);
        if (!known || !known.items.length) {
          ensureAgent(sessionId, tool.subagent.id, {
            role: tool.subagent.role || 'Sub-agent', model: tool.subagent.model || null,
            task: (tool.arguments && tool.arguments.task) || '', credits: tool.subagent.credits,
            summary: tool.subagent.summary || '', status: tool.subagent.error ? 'failed' : 'done',
            loaded: false,
          });
        }
      }
      group.tools.push(entry);
    }
    pushText(text.length);
    if (message.model || message.usage) {
      items.push({ type: 'footer', model: message.model, usage: message.usage || null });
    }
  }
  flushCompactions(null);
  return items;
}

async function selectSession(id) {
  closeMenus();
  hideBanner();
  if (S.current !== id) discardAttachments();
  S.current = id;
  restoreDraft();
  S.model = sessionModel(currentSession()) || newSessionModel();
  S.panel.open = false;
  renderPanel();
  renderSidebar();
  renderAccount();
  renderMain();
  $('prompt').focus();
  if (S.loaded.has(id) || S.loading.has(id)) return;
  S.loading.add(id);
  await loadSessionHistory(id);
}

// A session whose history could not be read, and when it is tried again.
const loadFailures = new Map(); // session id -> { message, attempts, next }

async function loadSessionHistory(id) {
  S.loading.add(id);
  const pending = transcriptOf(id).filter((item) => item.type !== 'load-error');
  let failed = null;
  try {
    const data = await call(cf.messages, id);
    S.transcripts.set(id, [...fromHistory(id, data.messages || [], data.compactions || []), ...pending]);
    const known = S.sessions.find((x) => x.id === id);
    S.seenAnswer.set(id, (known && known.last_message_at) || null);
    S.loaded.add(id);
    loadFailures.delete(id);
  } catch (err) {
    failed = err;
  } finally {
    S.loading.delete(id);
  }
  if (failed) {
    const before = loadFailures.get(id);
    const attempts = before ? before.attempts + 1 : 1;
    // A lost connection or a busy server passes: try again, more slowly each
    // time. Anything else (a deleted session, a refused key) is final.
    const retry = failed.transient || failed.status === 0 || failed.status == null;
    const wait = Math.min(30, 5 * 2 ** (attempts - 1));
    loadFailures.set(id, { message: failed.message, attempts, next: retry ? Date.now() + wait * 1000 : null });
    S.transcripts.set(id, [{ type: 'load-error', sessionId: id }, ...pending]);
    if (!retry) S.loaded.add(id);
  }
  if (S.current === id) renderMain();
  renderSidebar();
  if (!failed) checkCurrentSession();
}

// Called every second while a failed session is open: the countdown, then the retry.
function tickLoadRetry() {
  const failure = S.current && loadFailures.get(S.current);
  if (!failure || failure.next == null || S.loading.has(S.current)) return;
  if (Date.now() >= failure.next) {
    loadSessionHistory(S.current);
    return;
  }
  const label = document.querySelector('.load-error .retry-in');
  if (label) label.textContent = retryText(failure);
}

function retryText(failure) {
  if (failure.next == null) return '';
  const seconds = Math.max(0, Math.ceil((failure.next - Date.now()) / 1000));
  return seconds ? `Trying again in ${seconds}s` : 'Trying again…';
}

function retryNow(id) {
  const failure = loadFailures.get(id);
  if (failure) failure.next = Date.now();
  if (!S.loading.has(id)) loadSessionHistory(id);
  const label = document.querySelector('.load-error .retry-in');
  if (label) label.textContent = 'Trying again…';
}

// ── Menus ──────────────────────────────────────────────────────────────────
function closeMenus() {
  $('sessionMenu').hidden = true;
  for (const menu of document.querySelectorAll('.pref-menu')) menu.hidden = true;
  for (const open of document.querySelectorAll('.session-more.open')) open.classList.remove('open');
  for (const open of document.querySelectorAll('.session.menu-open')) open.classList.remove('menu-open');
  $('attachMenu').hidden = true;
  $('folderMenu').hidden = true;
  $('modelMenu').hidden = true;
  $('effortMenu').hidden = true;
  $('permMenu').hidden = true;
}

// Where a new session runs: a folder on this computer, or a cloud sandbox.
// A session that exists keeps what it was created with, so this only offers to
// open the folder then.
function openFolderMenu() {
  closeMenus();
  const session = currentSession();
  const menu = $('folderMenu');
  menu.style.left = `${$('folderButton').offsetLeft}px`;
  const list = $('folderList');
  list.replaceChildren();

  const option = (iconName, name, sub, selected, run) => {
    const row = el('button', `menu-item${selected ? ' selected' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
    row.append(icon(iconName), main);
    row.addEventListener('click', () => {
      closeMenus();
      run();
    });
    return row;
  };

  if (session) {
    const cwd = local(session.id).cwd;
    list.append(el('div', 'menu-group', 'This session'));
    list.append(option(
      session.executor === 'client' ? 'folder' : 'sparkle',
      session.executor === 'client' ? (cwd ? baseName(cwd) : 'Another computer') : 'Cloud sandbox',
      session.executor === 'client'
        ? (cwd || 'This session was started on another computer')
        : "Tools run on CodingFleet's servers",
      true,
      () => { if (cwd) cf.openFolder(cwd); },
    ));
    list.append(el('div', 'menu-group', 'New session'));
  }

  const sandbox = !session && S.draftSandbox;
  list.append(option('sparkle', 'Cloud sandbox', "Runs on CodingFleet's servers. Nothing here is read or changed.",
    sandbox, () => {
      S.draftSandbox = true;
      S.draftCwd = null;
      if (session) newSession();
      else renderMain();
    }));
  const folder = !session && !S.draftSandbox && S.draftCwd;
  list.append(option('folder', S.draftCwd && !session ? baseName(S.draftCwd) : 'A folder on this computer',
    S.draftCwd && !session ? S.draftCwd : 'CodingFleet reads, edits and runs code inside it',
    Boolean(folder), async () => {
      if (session) newSession();
      S.draftSandbox = false;
      await pickFolder();
    }));
  if (S.init.state.lastCwd && S.init.state.lastCwd !== S.draftCwd) {
    list.append(option('folder', baseName(S.init.state.lastCwd), S.init.state.lastCwd, false, () => {
      if (session) newSession();
      S.draftSandbox = false;
      S.draftCwd = S.init.state.lastCwd;
      renderMain();
    }));
  }
  menu.hidden = false;
}

function openModelMenu() {
  closeMenus();
  ensureModels();
  const menu = $('modelMenu');
  menu.style.left = `${$('modelButton').offsetLeft}px`;
  menu.hidden = false;
  $('modelSearch').value = '';
  renderModelList('');
  $('modelSearch').focus();
  const selected = menu.querySelector('.menu-item.selected');
  if (selected) selected.scrollIntoView({ block: 'center' });
}

// Vision, intelligence and price, each in its own fixed column so every row
// of a picker lines up; an empty cell keeps its place.
function modelColumns(vision, iq, price) {
  const cols = el('span', 'model-cols');
  const eyeCell = el('span', 'mc-vision');
  if (vision) {
    eyeCell.append(icon('eye', 'icon model-vision'));
    eyeCell.title = 'Vision: this model can read images you attach';
  }
  const iqCell = el('span', 'mc-iq');
  if (iq) {
    const pill = el('span', 'pill iq', String(iq));
    pill.title = `Intelligence Index: ${iq}/100 (higher is smarter)`;
    iqCell.append(pill);
  }
  const priceCell = el('span', 'mc-price');
  if (price) {
    const { text, cls, title } = typeof price === 'string' ? { text: price } : price;
    const pill = el('span', `pill${cls ? ` ${cls}` : ''}`, text);
    pill.title = title || 'Credits per 20k tokens';
    priceCell.append(pill);
  }
  cols.append(eyeCell, iqCell, priceCell);
  return cols;
}

// The account's plan covers this model: it costs no credits here.
function planIncludes(variant) {
  return Boolean(variant && variant.unlimited && S.credits && S.credits.plan && S.credits.plan.unlimited_models);
}

function includedPill() {
  const plan = (S.credits && S.credits.plan && S.credits.plan.name) || 'your';
  return {
    text: 'Unlimited',
    cls: 'unl',
    title: `Included in your ${plan} plan: no credits in this app and on the web (fair use applies).`,
  };
}

function priceLabel(variants) {
  if (variants.length && variants.every(planIncludes)) return includedPill();
  return creditRange(variants);
}

function creditRange(variants) {
  const costs = variants.map((v) => v.credits_per_20k_tokens).filter((c) => c != null);
  if (!costs.length) return null;
  const low = Math.min(...costs);
  const high = Math.max(...costs);
  return low === high ? `${fmtNum(low)} cr` : `${fmtNum(low)}–${fmtNum(high)} cr`;
}

// The session picker's list. A picker other than the composer's passes its own
// list element, selected model and choice handler.
const composerPicker = () => ({ list: $('modelList'), selected: S.model, choose: chooseModel });

function renderModelList(query, picker = composerPicker()) {
  const list = picker.list;
  list.replaceChildren();
  const q = query.trim().toLowerCase();
  const matches = (...parts) => !q || parts.some((p) => p && String(p).toLowerCase().includes(q));
  let shown = 0;

  const row = (id, name, sub, selected, extra = []) => {
    const button = el('button', `menu-item${selected ? ' selected' : ''}${shown === 0 && q ? ' focus' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
    button.append(main, ...extra);
    button.addEventListener('click', () => picker.choose(id));
    shown++;
    return button;
  };

  if (matches('auto', 'auto select')) {
    list.append(row('auto', 'Auto', 'Picks a model for each message', picker.selected === 'auto'));
  }

  let provider;
  for (const entry of modelEntries()) {
    const providerName = entry.provider ? entry.provider.name : null;
    if (!matches(entry.name, providerName, ...entry.variants.map((v) => v.name), ...entry.variants.map((v) => v.id))) continue;
    if (providerName !== provider) {
      provider = providerName;
      const header = el('div', 'menu-group');
      if (entry.provider) header.append(providerLogo(entry.provider));
      header.append(el('span', null, providerName || 'Other models'));
      list.append(header);
    }
    const selected = entry.variants.some((v) => v.id === picker.selected);
    const lead = entry.variants.find((v) => v.id === entry.defaultId) || entry.variants[0];
    const pills = [modelColumns(
      entry.variants.some((v) => v.supports_vision),
      Math.max(0, ...entry.variants.map((v) => v.intelligence_index || 0)),
      priceLabel(entry.variants),
    )];
    const sub = entry.variants.length > 1
      ? entry.variants.map((v) => (v.effort ? v.effort.label : v.name)).join(' · ')
      : lead.id;
    list.append(row(selected ? picker.selected : lead.id, entry.name, sub, selected, pills));
  }
  if (!shown) {
    list.append(el('div', 'menu-empty', S.models.length ? 'No model matches.' : S.modelsError || 'Loading models…'));
  }
}

function openEffortMenu() {
  closeMenus();
  const entry = entryOf(S.model);
  if (!entry || entry.variants.length < 2) return;
  const menu = $('effortMenu');
  menu.style.left = `${$('effortButton').offsetLeft}px`;
  fillEffortList($('effortList'), S.model, chooseModel);
  menu.hidden = false;
}

function fillEffortList(list, selectedId, choose) {
  const entry = entryOf(selectedId);
  list.replaceChildren(el('div', 'menu-group', `${entry.name} · thinking effort`));
  for (const variant of entry.variants) {
    const button = el('button', `menu-item${variant.id === selectedId ? ' selected' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', variant.effort ? variant.effort.label : variant.name), el('div', 'mi-sub', variant.name));
    button.append(main);
    button.append(modelColumns(
      variant.supports_vision,
      variant.intelligence_index || 0,
      planIncludes(variant) ? includedPill()
        : variant.credits_per_20k_tokens != null ? `${fmtNum(variant.credits_per_20k_tokens)} cr` : null,
    ));
    button.addEventListener('click', () => choose(variant.id));
    list.append(button);
  }
}

// The composer's model and effort buttons, for any model id.
function modelButtonParts(id) {
  const selected = findModel(id);
  return [
    (selected && providerLogo(selected.provider, 'plogo small')) || icon(id === 'auto' ? 'sparkle' : 'model'),
    el('span', null, modelName(id)),
    icon('caret', 'icon caret'),
  ];
}

function effortButtonParts(id) {
  const entry = id === 'auto' ? null : entryOf(id);
  if (!entry || entry.variants.length < 2) return null;
  const variant = entry.variants.find((v) => v.id === id);
  return [icon('gauge'), el('span', null, (variant && variant.effort && variant.effort.label) || 'Effort'),
    icon('caret', 'icon caret')];
}

function chooseModel(id) {
  S.model = id;
  // The choice is this session's own. New sessions start on the default model
  // from Settings, Preferences.
  if (S.current) {
    S.init.state.sessions[S.current] = { ...local(S.current), model: id };
    cf.setSessionModel({ sessionId: S.current, model: id });
  }
  closeMenus();
  renderComposer();
  $('prompt').focus();
}

function openPermMenu() {
  closeMenus();
  const menu = $('permMenu');
  menu.style.left = `${$('permButton').offsetLeft}px`;
  const list = $('permList');
  list.replaceChildren();
  const options = [
    ['ask', 'shield', 'Ask before changes', 'Reads inside the project folder run at once. Commands and file changes wait for you.'],
    ['auto', 'bolt', 'Auto-approve', 'Every tool call runs without asking. Use it only in folders you trust.'],
  ];
  for (const [value, iconName, name, sub] of options) {
    const row = el('button', `menu-item${S.permission === value ? ' selected' : ''}`);
    const main = el('div', 'mi-main');
    main.append(el('div', 'mi-name', name), el('div', 'mi-sub', sub));
    row.append(icon(iconName), main);
    row.addEventListener('click', () => {
      S.permission = value;
      cf.setState({ permissionMode: value });
      closeMenus();
      renderComposer();
    });
    list.append(row);
  }
  menu.hidden = false;
}

// ── Settings ───────────────────────────────────────────────────────────────
let settingsRequired = false;

function openSettings(required = false, tab = 'account') {
  closeMenus();
  settingsRequired = required;
  const settings = S.settings;
  $('settings').hidden = false;
  // Without a key there is only the account to set up.
  $('settingsTabs').hidden = required || !settings.hasKey;
  localChecked = false;
  billingData = null; // billing changes on the website too: read it again
  invoicesOpen.clear();
  for (const pane of document.querySelectorAll('.settings-pane')) pane.statusNote = null;
  showSettingsTab(required || !settings.hasKey ? 'account' : tab);
  $('settingsClose').hidden = required;
  $('settingsCancel').hidden = required;
  $('settingsIntro').textContent = required
    ? 'Paste your CodingFleet API key to start.'
    : settings.hasKey ? '' : 'Your API key, and the server this app talks to.';
  $('settingsIntro').hidden = !required && settings.hasKey;
  renderSignedIn(!required && settings.hasKey);
  const input = $('keyInput');
  input.value = '';
  input.type = 'password';
  $('keyShow').textContent = 'Show';
  input.placeholder = settings.hasKey ? `Saved: ${settings.keyHint}` : 'cf_sk_…';
  $('baseInput').value = settings.apiBase;
  $('advanced').open = settings.apiBase !== settings.defaultApiBase;
  const link = $('keyLink');
  link.href = `${originOf(settings.apiBase)}/agent-api/`;
  link.textContent = `${originOf(settings.apiBase).replace(/^https?:\/\//, '')}/agent-api`;
  // Signed in: the card says so and has Sign out; the key field is for switching.
  $('keyRemove').hidden = true;
  setSettingsStatus(settings.fromEnv
    ? 'An environment variable sets the key or the server. It overrides these settings when the app starts.'
    : '', 'info');
  $('settingsSave').disabled = false;
  setTimeout(() => input.focus(), 0);
}

function closeSettings() {
  if (settingsRequired && !S.settings.hasKey) return;
  $('settings').hidden = true;
}

function setSettingsStatus(text, kind = 'info') {
  const status = $('settingsStatus');
  status.textContent = text;
  status.className = `modal-status ${kind}`;
}

function resetAccountView() {
  S.transcripts.clear();
  S.loaded.clear();
  S.sessions = [];
  S.credits = null;
  S.current = null;
}

// The account the app works as has changed: forget what the old one loaded.
async function applyNewAccount(data) {
  resetAccountView();
  S.settings = data.settings;
  S.credits = data.credits;
  settingsRequired = false;
  $('settings').hidden = true;
  renderAccount();
  renderSidebar();
  renderMain();
  await loadAll();
}

// Sign in through the browser: no key is typed, and the password never comes
// near this app. The main process waits for the approval on codingfleet.com.
async function signInWithBrowser() {
  const button = $('browserSignIn');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Waiting for your browser…';
  setSettingsStatus('Approve this app in the browser, then come back.', 'info');
  const res = await cf.signIn({ apiBase: $('baseInput').value });
  button.disabled = false;
  button.textContent = label;
  if (!res.ok) {
    setSettingsStatus(res.error.message, 'error');
    return;
  }
  await applyNewAccount(res.data);
}

async function saveSettings() {
  const save = $('settingsSave');
  save.disabled = true;
  setSettingsStatus('Checking the key…', 'info');
  const res = await cf.saveSettings({ apiKey: $('keyInput').value, apiBase: $('baseInput').value });
  save.disabled = false;
  if (!res.ok) {
    setSettingsStatus(res.error.message, 'error');
    return;
  }
  resetAccountView();
  S.settings = res.data.settings;
  S.credits = res.data.credits;
  settingsRequired = false;
  $('settings').hidden = true;
  renderAccount();
  renderSidebar();
  renderMain();
  await loadAll();
}

// Who this app is signed in as, and a way to switch or sign out. Shown instead
// of the sign-in form when a key is saved.
function renderSignedIn(show) {
  const card = $('signedIn');
  $('signInBlock').hidden = show;
  card.hidden = !show;
  if (!show) return;
  const credits = S.credits || {};
  const account = credits.account || {};
  const key = credits.key || {};
  const plan = credits.plan;
  card.replaceChildren();
  const badge = el('span', 'signed-in-badge');
  badge.innerHTML = ICON.check;
  const text = el('div', 'signed-in-text');
  const title = el('div', 'signed-in-title');
  title.append(el('span', null, 'Signed in'));
  if (plan) title.append(el('span', 'pill signed-in-plan', `${plan.name} plan`));
  text.append(title);
  const who = account.email || account.username;
  text.append(el('div', 'signed-in-who', who
    ? `as ${account.username && account.email ? `${account.username} (${account.email})` : who}`
    : S.creditsError ? 'Could not reach your account just now.' : 'Loading your account…'));
  const keyName = key.name ? `${key.name} · ` : '';
  text.append(el('div', 'signed-in-key', `Key: ${keyName}${key.hint || S.settings.keyHint || ''}`
    + (S.settings.apiBase !== S.settings.defaultApiBase ? ` · ${S.settings.apiBase}` : '')));
  const actions = el('div', 'signed-in-actions');
  const other = el('button', 'btn', 'Use another account');
  other.addEventListener('click', () => {
    $('signInBlock').hidden = false;
    other.hidden = true;
    $('keyInput').focus();
  });
  const out = el('button', 'btn danger', 'Sign out');
  out.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Sign out of CodingFleet?',
      text: 'The key is removed from this computer. Your sessions stay in your account; sign in again to see them.',
      confirm: 'Sign out',
      danger: true,
    });
    if (ok) removeKey();
  });
  actions.append(other, out);
  card.append(badge, text, actions);
  if (!credits.account && !S.creditsError) loadCredits().then(() => { if (!card.hidden) renderSignedIn(true); });
}

async function removeKey() {
  const res = await cf.removeKey();
  if (!res.ok) {
    setSettingsStatus(res.error.message, 'error');
    return;
  }
  resetAccountView();
  S.settings = res.data;
  S.models = [];
  renderAccount();
  renderSidebar();
  renderMain();
  openSettings(true);
}

// ── Settings tabs ──────────────────────────────────────────────────────────
let settingsTab = 'account';

function showSettingsTab(tab) {
  settingsTab = tab;
  for (const button of document.querySelectorAll('#settingsTabs [data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const pane of document.querySelectorAll('.settings-pane')) pane.hidden = pane.dataset.pane !== tab;
  if (tab === 'privacy') renderPrivacyPane();
  if (tab === 'preferences') renderPreferencesPane();
  if (tab === 'mcp') renderMcpPane();
  if (tab === 'keys') renderKeysPane();
  if (tab === 'billing') renderBillingPane();
}

// A pane's last message is kept on the pane, so it survives the pane's redraw.
function paneStatus(pane, text, kind = 'info') {
  pane.statusNote = { text, kind, at: Date.now() };
  applyStatus(pane);
}

function applyStatus(pane) {
  const status = pane.querySelector('.pane-status');
  if (!status) return;
  const note = pane.statusNote;
  const age = note ? Date.now() - note.at : 0;
  const fresh = note && (note.kind !== 'ok' || age < 2200);
  status.textContent = fresh ? note.text : '';
  status.className = `pane-status ${fresh ? note.kind : ''}`;
  clearTimeout(pane.statusTimer);
  if (fresh && note.kind === 'ok') pane.statusTimer = setTimeout(() => applyStatus(pane), 2300 - age);
}

function switchRow({ title, desc, checked, disabled = false, sub = false, warn = false, onChange }) {
  const row = el('label', `set-row${sub ? ' sub' : ''}${disabled ? ' disabled' : ''}${warn ? ' warn' : ''}`);
  const text = el('div', 'set-text');
  text.append(el('div', 'set-title', title));
  if (desc) text.append(el('div', 'set-desc', desc));
  const toggle = el('span', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked, input));
  toggle.append(input, el('span', 'switch-track'));
  row.append(text, toggle);
  return row;
}

function paneHead(title, intro) {
  const head = el('div', 'pane-head');
  head.append(el('h3', null, title));
  if (intro) head.append(el('p', null, intro));
  return head;
}

function accountPane(id, title, intro) {
  const pane = $(id);
  pane.replaceChildren(paneHead(title, intro));
  if (!S.account) {
    pane.append(el('div', 'pane-empty', S.accountError || 'Loading your settings…'));
    if (!S.accountError) loadAccountSettings().then(() => showSettingsTab(settingsTab));
    return null;
  }
  return pane;
}

async function saveAccountSettings(pane, change, { reloadModels = false } = {}) {
  paneStatus(pane, 'Saving…');
  try {
    S.account = await call(cf.updateSettings, change);
    paneStatus(pane, 'Saved', 'ok');
    if (reloadModels) {
      S.models = [];
      await loadModels();
    }
    applyDefaultModel();
  } catch (err) {
    paneStatus(pane, err.message, 'error');
  }
  showSettingsTab(settingsTab);
}

function renderPrivacyPane() {
  const pane = accountPane('privacyPane', 'Data privacy',
    'How your prompts are routed and stored. These settings belong to your CodingFleet account: they are the '
    + 'same as on codingfleet.com, and they apply to every run, from any app.');
  if (!pane) return;
  const privacy = S.account.privacy;
  const save = (change, options) => saveAccountSettings(pane, { privacy: change }, options);
  pane.append(switchRow({
    title: 'Privacy-focused models',
    desc: 'Only models that do not use your data for training, through providers that do not collect prompts. '
      + 'Other models are hidden from the picker.',
    checked: privacy.privacy_models,
    onChange: (on) => save({ privacy_models: on }, { reloadModels: true }),
  }));
  pane.append(switchRow({
    title: 'Enforce zero data retention',
    desc: 'Only providers that keep nothing: your prompts and answers are never stored by them. '
      + 'Your sessions are still saved to your CodingFleet account.',
    checked: privacy.zero_data_retention,
    disabled: !privacy.privacy_models,
    sub: true,
    onChange: (on) => save({ zero_data_retention: on }, { reloadModels: true }),
  }));
  if (privacy.data_region_available) {
    const row = el('div', `set-row sub${privacy.privacy_models ? '' : ' disabled'}`);
    const text = el('div', 'set-text');
    text.append(el('div', 'set-title', 'Data residency'),
      el('div', 'set-desc', 'Requests are served only inside the region you choose. The United States region is set on your account page.'));
    const seg = el('div', 'seg');
    for (const [value, label] of [['', 'Global'], ['eu', 'EU'], ['us', 'US']]) {
      const button = el('button', `seg-btn${privacy.data_region === value ? ' active' : ''}`, label);
      button.disabled = !privacy.privacy_models || (value === 'us' && privacy.data_region !== 'us');
      button.addEventListener('click', () => save({ data_region: value }));
      seg.append(button);
    }
    row.append(text, seg);
    pane.append(row);
  }
  if (privacy.private_sessions) {
    const row = el('div', 'set-row warn static');
    const text = el('div', 'set-text');
    text.append(el('div', 'set-title', 'Private session mode is on'),
      el('div', 'set-desc', 'It is set on your account page. While it is on, nothing new is stored on CodingFleet, '
        + 'so this app cannot send messages: a session is its stored history. Turn it off on the account page to '
        + 'use the app.'));
    row.append(text);
    pane.append(row);
  }
  const foot = el('div', 'pane-foot');
  const link = el('a', null, 'Open your account page');
  link.href = `${originOf(S.settings.apiBase)}/account/`;
  foot.append(el('div', 'pane-status'), link);
  pane.append(foot);
  applyStatus(pane);
}

// ── Themes ─────────────────────────────────────────────────────────────────
const THEMES = [
  { id: 'dark', name: 'Dark', desc: 'Easy on the eyes' },
  { id: 'light', name: 'Light', desc: 'For bright rooms' },
  { id: 'hacker', name: 'Hacker', desc: 'Green on black terminal' },
];

function currentTheme() {
  return document.documentElement.dataset.theme || 'dark';
}

function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = 'dark';
  document.documentElement.dataset.theme = id;
  const link = $('hljsTheme');
  if (link && link.dataset[id]) link.href = link.dataset[id];
  if (S.init && S.init.state) S.init.state.theme = id;
  return cf.setTheme(id);
}

function themeSection() {
  const wrap = el('div', 'theme-section');
  wrap.append(el('div', 'pane-section first', 'Appearance'));
  const grid = el('div', 'theme-grid');
  for (const theme of THEMES) {
    const card = el('button', `theme-card${currentTheme() === theme.id ? ' active' : ''}`);
    card.type = 'button';
    card.dataset.preview = theme.id;
    const preview = el('span', 'theme-preview');
    const side = el('span', 'tp-side');
    side.append(el('span', 'tp-dot'), el('span', 'tp-line'), el('span', 'tp-line short'));
    const body = el('span', 'tp-body');
    body.append(el('span', 'tp-line wide'), el('span', 'tp-line'), el('span', 'tp-bubble'), el('span', 'tp-input'));
    preview.append(side, body);
    const label = el('span', 'theme-label');
    label.append(el('span', 'theme-name', theme.name), el('span', 'theme-desc', theme.desc));
    card.append(preview, label);
    card.addEventListener('click', () => {
      applyTheme(theme.id);
      for (const other of grid.children) other.classList.toggle('active', other === card);
    });
    grid.append(card);
  }
  wrap.append(grid);
  return wrap;
}

function renderPreferencesPane() {
  const pane = accountPane('prefsPane', 'Preferences',
    'How the app looks, your defaults for new sessions, and how much one message may spend.');
  // The theme is kept on this computer, so it shows even before the account loads.
  $('prefsPane').insertBefore(themeSection(), $('prefsPane').children[1] || null);
  if (!pane) return;
  pane.append(el('div', 'pane-section', 'New sessions'));
  const prefs = S.account.preferences;
  const save = (change, options) => saveAccountSettings(pane, { preferences: change }, options);

  const modelRow = el('div', 'set-row stack');
  const modelText = el('div', 'set-text');
  modelText.append(el('div', 'set-title', 'Default AI model'),
    el('div', 'set-desc', 'New sessions start on this model. You can still pick another one for each session.'));
  const current = prefs.default_model || 'auto';
  const choose = (id) => {
    closeMenus();
    S.init.state.model = id;
    cf.setState({ model: id });
    save({ default_model: id });
  };
  const field = el('div', 'pref-model');
  const modelButton = el('button', 'bar-button pref-toggle');
  modelButton.replaceChildren(...modelButtonParts(current));
  modelButton.title = 'Default model';
  const menu = el('div', 'menu model-menu pref-menu');
  menu.hidden = true;
  const search = el('input');
  search.placeholder = 'Search models or providers';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const list = el('div', 'menu-list');
  menu.append(search, list);
  const picker = { list, selected: current, choose };
  search.addEventListener('input', () => renderModelList(search.value, picker));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = list.querySelector('.menu-item');
      if (first) first.click();
    }
  });
  modelButton.addEventListener('click', () => {
    const open = !menu.hidden;
    closeMenus();
    if (open) return;
    ensureModels().then(() => { if (!menu.hidden) renderModelList(search.value, picker); });
    menu.hidden = false;
    search.value = '';
    renderModelList('', picker);
    search.focus();
    const selected = list.querySelector('.menu-item.selected');
    if (selected) selected.scrollIntoView({ block: 'center' });
  });
  field.append(modelButton, menu);

  const effortParts = effortButtonParts(current);
  if (effortParts) {
    const effortButton = el('button', 'bar-button pref-toggle');
    effortButton.replaceChildren(...effortParts);
    effortButton.title = 'Thinking effort';
    const effortMenu = el('div', 'menu effort-menu pref-menu');
    effortMenu.hidden = true;
    const effortList = el('div', 'menu-list');
    effortMenu.append(effortList);
    effortButton.addEventListener('click', () => {
      const open = !effortMenu.hidden;
      closeMenus();
      if (open) return;
      fillEffortList(effortList, current, choose);
      effortMenu.style.left = `${effortButton.offsetLeft}px`;
      effortMenu.hidden = false;
    });
    field.append(effortButton, effortMenu);
  }
  modelRow.append(modelText, field);
  if (!S.models.length) modelRow.append(el('div', 'set-desc', S.modelsError || 'Loading models…'));
  pane.append(modelRow);

  // Kept on this computer; they apply to sessions created from now on.
  const caps = S.init.state.capabilities || {};
  const setCapability = (key, on) => {
    S.init.state.capabilities = { ...caps, [key]: on };
    caps[key] = on;
    cf.setState({ capabilities: { [key]: on } });
    paneStatus(pane, 'Saved. New sessions use this.', 'ok');
  };
  pane.append(switchRow({
    title: 'Image generation',
    desc: 'The agent can create images from a description. Each image costs credits. '
      + 'Applies to new sessions.',
    checked: caps.image_generation,
    onChange: (on) => setCapability('image_generation', on),
  }));
  pane.append(switchRow({
    title: 'Notifications',
    desc: 'Tell me when a run finishes or waits for my approval while I am in another window.',
    checked: S.init.state.notifications !== false,
    onChange: (on) => {
      S.init.state.notifications = on;
      cf.setState({ notifications: on });
      paneStatus(pane, 'Saved.', 'ok');
    },
  }));
  pane.append(switchRow({
    title: 'Memory',
    desc: 'The agent can read and update your CodingFleet memory: what it knows about you and your work, '
      + 'shared with the web chat. Applies to new sessions.',
    checked: caps.memory,
    onChange: (on) => setCapability('memory', on),
  }));

  pane.append(switchRow({
    title: 'Show legacy models',
    desc: 'List older models in the picker. They may have reduced support.',
    checked: prefs.show_legacy_models,
    onChange: (on) => save({ show_legacy_models: on }, { reloadModels: true }),
  }));

  pane.append(el('div', 'pane-section', 'Spending control'));
  const capRow = el('div', 'set-row');
  const capText = el('div', 'set-text');
  capText.append(el('div', 'set-title', 'Credit cap per message'),
    el('div', 'set-desc', 'A message stops when it has spent this many credits, tool rounds included. '
      + '0 means no cap; the lowest cap applied is 20.'));
  const cap = el('input', 'set-number');
  cap.type = 'number';
  cap.min = '0';
  cap.max = '100000';
  cap.step = '1';
  cap.value = String(prefs.credit_cap_per_message || 0);
  const saveCap = () => {
    const value = Math.round(Number(cap.value));
    if (!Number.isFinite(value) || value < 0 || value > 100000) {
      paneStatus(pane, 'Enter a whole number from 0 to 100,000.', 'error');
      return;
    }
    if (value !== (prefs.credit_cap_per_message || 0)) save({ credit_cap_per_message: value });
  };
  cap.addEventListener('change', saveCap);
  cap.addEventListener('keydown', (event) => { if (event.key === 'Enter') cap.blur(); });
  capRow.append(capText, cap);
  pane.append(capRow);

  pane.append(switchRow({
    title: 'Economy mode',
    desc: 'Spend fewer credits on long sessions: the conversation is compacted at 40% of your context limit '
      + 'instead of 90%, so each tool round re-sends much less. Older details are summarized sooner.',
    checked: prefs.economy_mode,
    onChange: (on) => save({ economy_mode: on }),
  }));
  const foot = el('div', 'pane-foot');
  foot.append(el('div', 'pane-status'));
  pane.append(foot);
  applyStatus(pane);
}

// ── Billing ────────────────────────────────────────────────────────────────
// The website's billing page, here: plan, subscriptions, invoices, orders, and
// what can be done with a subscription. Paying for something new stays on the
// website, which the buttons open.
let billingData = null;
const invoicesOpen = new Map(); // subscription id -> invoices, or 'loading', or an Error

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2).replace(/\.00$/, '')}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const openLink = (url) => { if (url) window.open(url, '_blank'); };

const SUB_STATUS = {
  active: ['Active', 'good'], on_trial: ['Trial', 'good'], cancelled: ['Cancelled', 'warn'],
  past_due: ['Payment failed', 'bad'], unpaid: ['Unpaid', 'bad'], expired: ['Ended', ''], paused: ['Paused', ''],
};

function subWhen(sub) {
  if (sub.status === 'active') return `Renews on ${fmtDate(sub.renews_at)}`;
  if (sub.status === 'on_trial') return `Trial ends on ${fmtDate(sub.trial_ends_at)}`;
  if (sub.status === 'cancelled') return `Ends on ${fmtDate(sub.ends_at || sub.renews_at)}. Resume it before then to keep it.`;
  if (sub.status === 'expired') return `Ended on ${fmtDate(sub.ends_at)}`;
  if (sub.needs_payment) return 'The last payment failed. Update your card to keep the plan.';
  return '';
}

async function loadBilling() {
  billingData = await call(cf.billing);
  return billingData;
}

async function renderBillingPane() {
  const pane = $('billingPane');
  if (!billingData) {
    pane.replaceChildren(paneHead('Billing'), el('div', 'pane-empty', 'Loading…'));
    try {
      await loadBilling();
    } catch (err) {
      pane.replaceChildren(paneHead('Billing'), el('div', 'pane-empty', err.message));
      return;
    }
  }
  const scroll = pane.scrollTop;
  // Each list scrolls on its own; a redraw keeps where it was.
  const listScroll = Object.fromEntries([...pane.querySelectorAll('[data-list]')]
    .map((box) => [box.dataset.list, box.scrollTop]));
  const data = billingData;
  const plan = data.plan || {};
  const urls = plan.urls || {};
  pane.replaceChildren(paneHead('Billing', 'Your plan, subscriptions and purchases. Payments go through the '
    + 'website, which the buttons open in your browser.'));

  // The plan and what is left to spend.
  const credits = S.credits || {};
  const card = el('div', 'bill-plan');
  const left = el('div', 'bill-plan-main');
  left.append(el('div', 'bill-label', 'Current plan'), el('div', 'bill-plan-name', plan.name || '—'));
  const facts = el('div', 'bill-facts');
  const fact = (label, value) => {
    const f = el('div', 'bill-fact');
    f.append(el('span', null, label), el('strong', null, value));
    facts.append(f);
  };
  if (credits.weekly_total != null) fact('Weekly allowance', `${fmtNum(credits.weekly_remaining)} of ${fmtNum(credits.weekly_total)} left`);
  if (credits.credits != null) fact('Credits', fmtNum(credits.credits));
  if (plan.unlimited_models) fact('Unlimited models', 'Included');
  left.append(facts);
  const buttons = el('div', 'bill-plan-actions');
  const change = el('button', 'btn primary', plan.key && plan.key !== 'free' ? 'Change plan' : 'Upgrade');
  change.addEventListener('click', () => openLink(urls.plans));
  const buy = el('button', 'btn', 'Buy credits');
  buy.addEventListener('click', () => openLink(creditsUrl(urls)));
  const web = el('button', 'btn', 'Billing on the website');
  web.addEventListener('click', () => openLink(urls.billing));
  buttons.append(change, buy, web);
  card.append(left, buttons);
  pane.append(card);

  pane.append(el('div', 'pane-section', 'Subscriptions'));
  if (!data.subscriptions.length) {
    pane.append(el('div', 'set-desc bill-empty', 'No subscriptions.'));
  } else {
    const subs = el('div', 'bill-scroll bill-subs');
    subs.dataset.list = 'subs';
    for (const sub of data.subscriptions) subs.append(subscriptionRow(pane, sub));
    pane.append(subs);
  }

  pane.append(el('div', 'pane-section', 'Credit purchases'));
  if (!data.credit_orders.length) {
    pane.append(el('div', 'set-desc bill-empty', 'No credit purchases.'));
  } else {
    const table = el('div', 'bill-table bill-scroll');
    table.dataset.list = 'orders';
    for (const order of data.credit_orders) {
      const line = el('div', 'bill-order');
      const name = el('div', 'bill-order-name');
      name.append(el('strong', null, order.name), el('span', null, fmtDate(order.created_at)));
      const status = order.status === 'paid' ? ['Paid', 'good'] : [order.status, order.status === 'refunded' ? 'warn' : ''];
      line.append(name, el('span', `bill-badge ${status[1]}`, status[0]), el('span', 'bill-amount', money(order.total_cents)));
      table.append(line);
    }
    pane.append(table);
  }
  const foot = el('div', 'pane-foot');
  foot.append(el('div', 'pane-status'));
  pane.append(foot);
  applyStatus(pane);
  pane.scrollTop = scroll;
  for (const box of pane.querySelectorAll('[data-list]')) box.scrollTop = listScroll[box.dataset.list] || 0;
}

function subscriptionRow(pane, sub) {
  const row = el('div', 'set-row stack bill-sub');
  const head = el('div', 'bill-sub-head');
  const text = el('div', 'set-text');
  const title = el('div', 'set-title');
  const [label, tone] = SUB_STATUS[sub.status] || [sub.status, ''];
  title.append(el('span', null, sub.name), el('span', `bill-badge ${tone}`, label));
  if (sub.discount) title.append(el('span', 'bill-badge good', `${sub.discount.percent}% off next invoice`));
  text.append(title, el('div', 'set-desc', subWhen(sub)));
  if (sub.card) text.append(el('div', 'set-desc', `${sub.card.brand ? sub.card.brand[0].toUpperCase() + sub.card.brand.slice(1) : 'Card'} •••• ${sub.card.last4}`));
  head.append(text);
  const actions = el('div', 'bill-actions');
  const action = (labelText, cls, run) => {
    const b = el('button', `btn ${cls || ''}`, labelText);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await run(); } finally { b.disabled = false; }
    });
    actions.append(b);
  };
  action(invoicesOpen.has(sub.id) ? 'Hide invoices' : 'Invoices', '', async () => {
    if (invoicesOpen.has(sub.id)) {
      invoicesOpen.delete(sub.id);
      renderBillingPane();
      return;
    }
    invoicesOpen.set(sub.id, 'loading');
    renderBillingPane();
    try {
      invoicesOpen.set(sub.id, (await call(cf.billingAction, { id: sub.id, action: 'invoices', method: 'GET' })).invoices || []);
    } catch (err) {
      invoicesOpen.set(sub.id, err);
    }
    renderBillingPane();
  });
  action(sub.needs_payment ? 'Update payment' : 'Manage payment', sub.needs_payment ? 'primary' : '', async () => {
    paneStatus(pane, 'Opening the payment portal…');
    try {
      openLink((await call(cf.billingAction, { id: sub.id, action: 'portal' })).url);
      paneStatus(pane, 'The payment portal is open in your browser.', 'ok');
    } catch (err) {
      paneStatus(pane, err.message, 'error');
    }
  });
  if (sub.can_resume) {
    action('Resume', 'primary', async () => {
      try {
        await call(cf.billingAction, { id: sub.id, action: 'resume' });
        paneStatus(pane, 'Resumed. Your plan continues.', 'ok');
        await refreshBillingSoon();
      } catch (err) {
        paneStatus(pane, err.message, 'error');
      }
    });
  }
  if (sub.can_cancel) action(sub.status === 'on_trial' ? 'End trial' : 'Cancel', 'danger', () => cancelFlow(pane, sub));
  head.append(actions);
  row.append(head);

  const invoices = invoicesOpen.get(sub.id);
  if (invoices) {
    const box = el('div', 'bill-invoices');
    if (invoices === 'loading') box.append(el('div', 'set-desc', 'Loading invoices…'));
    else if (invoices instanceof Error) box.append(el('div', 'set-desc bad', invoices.message));
    else if (!invoices.length) box.append(el('div', 'set-desc', 'No invoices yet.'));
    else {
      for (const inv of invoices) {
        const line = el('div', 'bill-order');
        const name = el('div', 'bill-order-name');
        name.append(el('strong', null, fmtDate(inv.created_at)), el('span', null, (inv.billing_reason || '').replace(/_/g, ' ')));
        line.append(name, el('span', `bill-badge ${inv.status === 'paid' ? 'good' : ''}`, inv.status_formatted || inv.status || ''),
          el('span', 'bill-amount', inv.total_formatted || ''));
        if (inv.invoice_url) {
          const view = el('button', 'btn small', 'View');
          view.addEventListener('click', () => openLink(inv.invoice_url));
          line.append(view);
        }
        box.append(line);
      }
    }
    row.append(box);
  }
  return row;
}

// Billing changes arrive through the payment provider's webhook, a moment later.
async function refreshBillingSoon() {
  await new Promise((r) => setTimeout(r, 2500));
  try { await loadBilling(); } catch { /* the old view stays */ }
  loadCredits();
  if (settingsTab === 'billing') renderBillingPane();
}

const CANCEL_REASONS = [
  ['', 'Choose a reason (optional)'],
  ['too_expensive', 'It is too expensive'],
  ['unused', 'I do not use it enough'],
  ['missing_features', 'Features I need are missing'],
  ['low_quality', 'The results are not good enough'],
  ['too_complex', 'It is too hard to use'],
  ['switched_service', 'I use another service'],
  ['customer_service', 'Customer service'],
  ['other', 'Another reason'],
];

// Cancel: why (optional), the stay offer when there is one, then confirm.
async function cancelFlow(pane, sub) {
  const trial = sub.status === 'on_trial';
  const overlay = el('div', 'overlay confirm-overlay');
  const modal = el('div', 'modal confirm-modal bill-cancel');
  modal.setAttribute('role', 'dialog');
  modal.append(el('h2', 'confirm-title', trial ? 'End your free trial?' : 'Cancel your subscription?'));
  modal.append(el('p', 'confirm-text', trial
    ? 'Cancelling ends your trial now, not when it was due to end. You go back to the free plan today and are not charged. A trial can be used only once.'
    : `You keep everything you paid for until ${fmtDate(sub.renews_at)}, then you go back to the free plan. Your credits stay. You can resume before that date.`));
  const reason = el('select', 'set-select');
  for (const [value, text] of CANCEL_REASONS) {
    const option = el('option', null, text);
    option.value = value;
    reason.append(option);
  }
  const comment = el('textarea', 'bill-comment');
  comment.placeholder = 'Anything we could do better? (optional)';
  comment.maxLength = 1000;
  if (!trial) modal.append(reason, comment);
  const offer = el('div', 'bill-offer');
  offer.hidden = true;
  modal.append(offer);
  const keep = el('button', 'btn', trial ? 'Keep my trial' : 'Keep subscription');
  const confirm = el('button', 'btn danger-solid', trial ? 'End trial now' : 'Cancel subscription');
  const actions = el('div', 'modal-actions');
  actions.append(el('div', 'bar-spacer'), keep, confirm);
  modal.append(actions);
  overlay.append(modal);
  const close = () => overlay.remove();
  keep.addEventListener('click', close);
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);

  if (!trial) {
    call(cf.billingAction, { id: sub.id, action: 'offer', method: 'GET' }).then((o) => {
      if (!o || !o.eligible) return;
      const amounts = o.amount_due_cents && o.discounted_cents != null
        ? ` (${money(o.amount_due_cents)} → ${money(o.discounted_cents)})` : '';
      offer.append(el('div', 'bill-offer-title', 'Wait — here is a better deal'),
        el('p', null, `Stay, and your next ${o.interval || 'month'} is ${o.percent}% off${amounts}. `
          + 'One time only; it applies to your next invoice by itself.'));
      const claim = el('button', 'btn primary', `Claim ${o.percent}% off and stay`);
      claim.addEventListener('click', async () => {
        claim.disabled = true;
        try {
          const r = await call(cf.billingAction, { id: sub.id, action: 'offer', method: 'POST' });
          close();
          paneStatus(pane, `Done: your next invoice is ${r.percent}% off. Glad you are staying!`, 'ok');
          await refreshBillingSoon();
        } catch (err) {
          claim.disabled = false;
          paneStatus(pane, err.message, 'error');
        }
      });
      offer.append(claim);
      offer.hidden = false;
    }).catch(() => {});
  }

  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await call(cf.billingAction, {
        id: sub.id, action: 'cancel', body: { feedback: reason.value, comment: comment.value },
      });
      close();
      paneStatus(pane, trial ? 'Your trial has ended.' : `Cancelled. Your plan stays until ${fmtDate(sub.renews_at)}.`, 'ok');
      await refreshBillingSoon();
    } catch (err) {
      confirm.disabled = false;
      paneStatus(pane, err.message, 'error');
      close();
    }
  });
}

// ── Your API keys (BYOK) ───────────────────────────────────────────────────
let byokKeys = null;

async function renderKeysPane() {
  const pane = $('keysPane');
  const plan = S.credits && S.credits.plan;
  pane.replaceChildren(paneHead('Your API keys',
    "Use your own key with an AI provider. Runs on that provider's models then go through your key and "
    + 'cost no credits: you pay the provider directly.'));
  const where = el('div', 'set-row warnless static');
  const whereText = el('div', 'set-text');
  whereText.append(el('div', 'set-title', 'Where your keys are used'));
  const inSandbox = plan && plan.byok_in_sandbox;
  whereText.append(el('div', 'set-desc',
    'Sessions in a folder on this computer: on any plan. '
    + (inSandbox ? 'Cloud sandbox sessions: yes, on your plan.'
      : 'Cloud sandbox sessions: from the Unlimited plan up. Until then they use CodingFleet keys and credits.')));
  where.append(whereText);
  pane.append(where);
  const status = el('div', 'pane-status');
  if (!byokKeys) {
    pane.append(el('div', 'pane-empty', 'Loading…'));
    try {
      byokKeys = (await call(cf.byokList)).keys || [];
    } catch (err) {
      pane.lastChild.textContent = err.message;
      return;
    }
    renderKeysPane();
    return;
  }
  for (const key of byokKeys) pane.append(keyRow(pane, key));
  const foot = el('div', 'pane-foot');
  foot.append(status);
  pane.append(foot);
  applyStatus(pane);
}

function keyRow(pane, key) {
  const row = el('div', 'set-row stack byok-row');
  const head = el('div', 'byok-head');
  const text = el('div', 'set-text');
  text.append(el('div', 'set-title', key.name));
  let desc = key.configured ? `Saved: ${key.masked}` : 'Not set';
  if (key.configured && key.last_used_at) desc += ` · last used ${relTime(key.last_used_at)} ago`;
  text.append(el('div', 'set-desc', desc));
  if (key.last_error) text.append(el('div', 'set-desc bad', `The provider refused it: ${key.last_error}`));
  const link = el('a', 'byok-link', 'Get a key');
  link.href = key.key_url;
  link.target = '_blank';
  head.append(text, link);
  const form = el('div', 'byok-form');
  const input = el('input', 'set-number byok-input');
  input.type = 'password';
  input.placeholder = key.configured ? 'Paste a new key to replace it' : key.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const save = el('button', 'btn primary', key.configured ? 'Replace' : 'Save');
  const saveKey = async () => {
    const value = input.value.trim();
    if (!value) return;
    save.disabled = true;
    paneStatus(pane, 'Saving…');
    try {
      const updated = await call(cf.byokSave, { provider: key.provider, apiKey: value });
      byokKeys = byokKeys.map((k) => (k.provider === key.provider ? updated : k));
      paneStatus(pane, `${key.name} key saved.`, 'ok');
    } catch (err) {
      paneStatus(pane, err.message, 'error');
    }
    renderKeysPane();
  };
  save.addEventListener('click', saveKey);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveKey(); });
  form.append(input, save);
  if (key.configured) {
    const remove = el('button', 'btn', 'Remove');
    remove.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Remove your ${key.name} key?`,
        text: 'Runs on these models then use CodingFleet keys and cost credits again.',
        confirm: 'Remove',
        danger: true,
      });
      if (!ok) return;
      try {
        const updated = await call(cf.byokDelete, key.provider);
        byokKeys = byokKeys.map((k) => (k.provider === key.provider ? updated : k));
        paneStatus(pane, `${key.name} key removed.`, 'ok');
      } catch (err) {
        paneStatus(pane, err.message, 'error');
      }
      renderKeysPane();
    });
    form.append(remove);
  }
  row.append(head, form);
  return row;
}

// ── MCP integrations ───────────────────────────────────────────────────────
let mcpState = null;
let localChecked = false;
const mcpOpen = new Set(['local']);

async function renderMcpPane() {
  const pane = $('mcpPane');
  if (!mcpState) {
    pane.replaceChildren(paneHead('MCP integrations'), el('div', 'pane-empty', 'Loading…'));
    try {
      mcpState = await call(cf.mcpGet);
    } catch (err) {
      pane.replaceChildren(paneHead('MCP integrations'), el('div', 'pane-empty', err.message));
      return;
    }
  }
  const scroll = pane.scrollTop;
  pane.replaceChildren(paneHead('MCP integrations',
    'Give the agent more tools. Remote servers are called by CodingFleet during a run. Local servers run on this '
    + 'computer, for sessions in a folder. Tokens and environment values are stored encrypted here and sent only '
    + 'with your runs.'));
  const status = el('div', 'pane-status');
  pane.append(status);

  const catalog = window.MCP_CATALOG || { categories: [], connectors: {} };
  const byCatalog = new Map(mcpState.remote.filter((r) => r.catalog).map((r) => [r.catalog, r]));
  const onCount = (keys) => keys.filter((k) => (byCatalog.get(k) || {}).enabled).length;

  const section = (id, title, count, on, build) => {
    const details = el('details', 'mcp-cat');
    details.open = mcpOpen.has(id);
    details.addEventListener('toggle', () => {
      if (details.open) mcpOpen.add(id);
      else mcpOpen.delete(id);
    });
    const summary = el('summary');
    summary.append(chevron(), el('span', 'mcp-cat-name', title));
    if (on) summary.append(el('span', 'mcp-on', `${on} on`));
    if (count != null) summary.append(el('span', 'mcp-count', String(count)));
    details.append(summary);
    const body = el('div', 'mcp-cat-body');
    build(body);
    details.append(body);
    pane.append(details);
  };

  // Local servers
  const localOn = mcpState.local.filter((l) => l.enabled).length;
  section('local', 'Local servers (this computer)', mcpState.local.length, localOn, (body) => {
    if (!mcpState.local.length) {
      body.append(el('div', 'mcp-note', 'No local servers yet. Add one that starts with a command, such as '
        + '"npx -y @modelcontextprotocol/server-memory".'));
    }
    for (const server of mcpState.local) body.append(localServerItem(server, pane));
    body.append(localServerForm(null, pane));
  });

  // Built-in remote servers, by category
  for (const cat of catalog.categories) {
    const keys = Object.keys(catalog.connectors).filter((k) => catalog.connectors[k].category === cat.id);
    if (!keys.length) continue;
    section(cat.id, cat.name, keys.length, onCount(keys), (body) => {
      for (const key of keys) body.append(catalogItem(key, catalog.connectors[key], byCatalog.get(key), pane));
    });
  }

  // Custom remote servers
  const custom = mcpState.remote.filter((r) => !r.catalog);
  section('custom', 'Your remote servers', custom.length, custom.filter((r) => r.enabled).length, (body) => {
    for (const server of custom) body.append(customItem(server, pane));
    body.append(customForm(pane));
  });
  pane.scrollTop = scroll;
  applyStatus(pane);
  // Once per opening: say at once whether the local servers start.
  if (!localChecked && mcpState.local.some((l) => l.enabled)) {
    localChecked = true;
    checkLocalServers(pane);
  }
}

async function mcpAction(pane, fn, arg, okText = 'Saved') {
  paneStatus(pane, 'Saving…');
  try {
    mcpState = await call(fn, arg);
    paneStatus(pane, okText, 'ok');
    renderMcpPane();
    return true;
  } catch (err) {
    paneStatus(pane, err.message, 'error');
    return false;
  }
}

function mcpBadge(color, name) {
  const badge = el('span', 'mcp-badge', name.slice(0, 1).toUpperCase());
  badge.style.setProperty('--badge', color || 'var(--accent)');
  return badge;
}

function mcpSwitch(checked, onChange) {
  const toggle = el('label', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.addEventListener('change', () => onChange(input.checked, input));
  toggle.append(input, el('span', 'switch-track'));
  return toggle;
}

function catalogItem(key, info, saved, pane) {
  const item = el('div', 'mcp-item');
  const head = el('div', 'mcp-item-head');
  const text = el('div', 'mcp-item-text');
  const title = el('div', 'mcp-item-name', info.name);
  const auth = { none: 'No key needed', optional: 'Key optional', required: 'API key' }[info.authMode] || '';
  title.append(el('span', `mcp-pill${info.authMode === 'required' ? '' : ' free'}`, auth));
  text.append(title, el('div', 'mcp-item-desc', info.description));
  const base = () => ({
    id: saved && saved.id, catalog: key, key, name: info.name, url: info.url,
    authHeader: info.authHeaderName || null, tools: info.tools && info.tools.length ? info.tools : null,
  });
  const toggle = mcpSwitch(saved && saved.enabled, async (on, input) => {
    if (on && info.authMode === 'required' && !(saved && saved.hasToken)) {
      input.checked = false;
      tokenBox.hidden = false;
      paneStatus(pane, `${info.name} needs a token. Paste it below, then turn it on.`, 'error');
      tokenInput.focus();
      return;
    }
    await mcpAction(pane, cf.mcpSaveRemote, { ...base(), enabled: on });
  });
  head.append(mcpBadge(info.color, info.name), text, toggle);
  item.append(head);

  const tokenBox = el('div', 'mcp-token');
  tokenBox.hidden = info.authMode === 'none';
  const tokenInput = el('input');
  tokenInput.type = 'password';
  tokenInput.placeholder = saved && saved.hasToken ? 'Token saved. Paste a new one to replace it.' : (info.tokenPlaceholder || 'Token');
  tokenInput.autocomplete = 'off';
  const saveToken = el('button', 'btn small', 'Save token');
  saveToken.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token && info.authMode === 'required') {
      paneStatus(pane, 'Paste the token first.', 'error');
      return;
    }
    await mcpAction(pane, cf.mcpSaveRemote, { ...base(), token, enabled: Boolean(token) || (saved && saved.enabled) });
  });
  const row = el('div', 'mcp-token-row');
  row.append(tokenInput, saveToken);
  if (saved && saved.hasToken) {
    const clear = el('button', 'btn small', 'Remove');
    clear.addEventListener('click', () => mcpAction(pane, cf.mcpSaveRemote, {
      ...base(), token: '', enabled: info.authMode === 'required' ? false : saved.enabled,
    }));
    row.append(clear);
  }
  const help = el('div', 'mcp-help');
  help.innerHTML = DOMPurify.sanitize(info.tokenHelp || '', { ALLOWED_TAGS: ['a', 'strong', 'code'], ALLOWED_ATTR: ['href'] });
  tokenBox.append(row, help);
  item.append(tokenBox);
  return item;
}

function customItem(server, pane) {
  const item = el('div', 'mcp-item');
  const head = el('div', 'mcp-item-head');
  const text = el('div', 'mcp-item-text');
  const title = el('div', 'mcp-item-name', server.name);
  if (server.hasToken) title.append(el('span', 'mcp-pill free', 'Token saved'));
  text.append(title, el('div', 'mcp-item-desc mono', server.url));
  const remove = el('button', 'icon-button danger');
  remove.title = 'Remove this server';
  remove.innerHTML = ICON.trash;
  remove.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Remove this server?', text: `${server.name} and its token are removed from this computer.`, confirm: 'Remove', danger: true })) {
      mcpAction(pane, cf.mcpDeleteRemote, server.id, 'Removed');
    }
  });
  const toggle = mcpSwitch(server.enabled, (on) => mcpAction(pane, cf.mcpSaveRemote, { ...server, enabled: on }));
  head.append(mcpBadge(null, server.name), text, remove, toggle);
  item.append(head);
  return item;
}

function field(label, input, hint) {
  const box = el('label', 'mcp-field');
  box.append(el('span', 'mcp-field-label', label), input);
  if (hint) box.append(el('span', 'mcp-field-hint', hint));
  return box;
}

function textInput(placeholder, value = '', type = 'text') {
  const input = el('input');
  input.type = type;
  input.placeholder = placeholder;
  input.value = value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

function customForm(pane) {
  const form = el('details', 'mcp-form');
  form.append(el('summary', null, '+ Add a remote server'));
  const name = textInput('My server');
  const url = textInput('https://example.com/mcp');
  const token = textInput('Optional', '', 'password');
  const header = textInput('Authorization');
  const add = el('button', 'btn primary small', 'Add server');
  add.addEventListener('click', () => mcpAction(pane, cf.mcpSaveRemote, {
    name: name.value, url: url.value, token: token.value, authHeader: header.value.trim() || null, enabled: true,
  }, 'Added'));
  const grid = el('div', 'mcp-grid');
  grid.append(field('Name', name), field('Server URL', url, 'Streamable HTTP, https only.'),
    field('Token', token, 'Sent as "Authorization: Bearer <token>".'),
    field('Header name', header, 'Only if the server wants the token in its own header.'));
  const actions = el('div', 'mcp-actions');
  actions.append(add);
  form.append(grid, actions);
  return form;
}

// "npx -y pkg --flag 'a b'" as a list of arguments.
function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(line || '')))) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

const joinArgs = (args) => args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');

function localServerItem(server, pane) {
  const item = el('div', 'mcp-item');
  const head = el('div', 'mcp-item-head');
  const text = el('div', 'mcp-item-text');
  text.append(el('div', 'mcp-item-name', server.name),
    el('div', 'mcp-item-desc mono', [server.command, joinArgs(server.args)].filter(Boolean).join(' ')));
  const state = el('div', 'mcp-state');
  const known = localStatus.get(server.id);
  if (!server.enabled) state.textContent = 'Off';
  else if (!known) state.textContent = 'Not checked yet';
  else if (known.error) {
    state.textContent = known.error;
    state.classList.add('bad');
  } else {
    state.textContent = `${known.tools.length} tool${known.tools.length === 1 ? '' : 's'}: ${known.tools.slice(0, 8).join(', ')}${known.tools.length > 8 ? '…' : ''}`;
    state.classList.add('good');
  }
  text.append(state);
  const edit = el('button', 'icon-button');
  edit.title = 'Edit';
  edit.innerHTML = ICON.edit;
  const remove = el('button', 'icon-button danger');
  remove.title = 'Remove this server';
  remove.innerHTML = ICON.trash;
  remove.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Remove this server?', text: `${server.name} is stopped and removed from this computer.`, confirm: 'Remove', danger: true })) {
      localStatus.delete(server.id);
      mcpAction(pane, cf.mcpDeleteLocal, server.id, 'Removed');
    }
  });
  const toggle = mcpSwitch(server.enabled, async (on) => {
    if (await mcpAction(pane, cf.mcpSaveLocal, { ...server, enabled: on }) && on) checkLocalServers(pane);
  });
  head.append(mcpBadge('#3ecf8e', server.name), text, edit, remove, toggle);
  item.append(head);
  const form = localServerForm(server, pane);
  form.hidden = true;
  edit.addEventListener('click', () => { form.hidden = !form.hidden; });
  item.append(form);
  return item;
}

const localStatus = new Map();

async function checkLocalServers(pane) {
  paneStatus(pane, 'Starting local servers…');
  try {
    const results = await call(cf.mcpLocalStatus);
    for (const result of results) localStatus.set(result.id, result);
    const failed = results.filter((r) => r.error).length;
    paneStatus(pane, failed ? `${failed} local server${failed === 1 ? '' : 's'} could not start.` : 'Local servers are ready.',
      failed ? 'error' : 'ok');
  } catch (err) {
    paneStatus(pane, err.message, 'error');
  }
  renderMcpPane();
}

function localServerForm(server, pane) {
  const editing = Boolean(server);
  const form = editing ? el('div', 'mcp-form open') : el('details', 'mcp-form');
  if (!editing) form.append(el('summary', null, '+ Add a local server'));
  const name = textInput('memory', editing ? server.name : '');
  const command = textInput('npx', editing ? server.command : '');
  const args = textInput('-y @modelcontextprotocol/server-memory', editing ? joinArgs(server.args) : '');
  const env = el('textarea', 'mcp-env');
  env.rows = 3;
  env.spellcheck = false;
  env.placeholder = editing && server.envKeys.length
    ? `Saved: ${server.envKeys.join(', ')}. Type NAME=value lines to replace them.`
    : 'NAME=value, one per line';
  const save = el('button', 'btn primary small', editing ? 'Save' : 'Add server');
  save.addEventListener('click', async () => {
    const ok = await mcpAction(pane, cf.mcpSaveLocal, {
      id: editing ? server.id : undefined,
      name: name.value, command: command.value, args: splitArgs(args.value), env: env.value,
      enabled: editing ? server.enabled : true,
    }, editing ? 'Saved' : 'Added');
    if (ok) checkLocalServers(pane);
  });
  const grid = el('div', 'mcp-grid');
  grid.append(field('Name', name), field('Command', command, 'The program that starts the server.'),
    field('Arguments', args), field('Environment', env, 'Stored encrypted. Never shown again.'));
  const actions = el('div', 'mcp-actions');
  if (editing && server.envKeys.length) {
    const clear = el('button', 'btn small', 'Clear environment');
    clear.addEventListener('click', () => mcpAction(pane, cf.mcpSaveLocal, { ...server, clearEnv: true }));
    actions.append(clear);
  }
  if (!editing && mcpState.local.some((l) => l.enabled)) {
    const check = el('button', 'btn small', 'Check servers');
    check.addEventListener('click', () => checkLocalServers(pane));
    actions.append(check);
  }
  actions.append(save);
  form.append(grid, actions);
  return form;
}

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
    if (!event.target.closest('.menu, .session-more, .pref-toggle, #modelButton, #effortButton, #permButton, #attachButton, #folderButton')) closeMenus();
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
  });
  scheduleLiveRefresh();
  setInterval(() => { if (S.settings.hasKey) loadCredits({ quiet: true }); }, CREDITS_REFRESH_MS);
  window.addEventListener('focus', () => {
    if (S.settings.hasKey && Date.now() - creditsLoadedAt > 10_000) loadCredits({ quiet: true });
  });
  setInterval(renderSidebar, 60_000); // keeps the "5m" labels honest
  setInterval(tickLoadRetry, 1000);
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
  await loadAll();
  if (S.init.openSession) await selectSession(S.init.openSession);
  if (S.init.shotScroll === 'top') {
    $('transcript').scrollTop = 0;
    onTranscriptScroll();
  }
  if (S.init.shotModel) {
    S.model = S.init.shotModel; // for this window only; not saved
    renderComposer();
  }
  if (S.init.shotMenu === 'folder') openFolderMenu();
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
