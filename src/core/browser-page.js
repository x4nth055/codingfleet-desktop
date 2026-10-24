'use strict';
// The browser tool's pieces that are not Electron: what runs inside a page to
// read it and find what to act on, and the plain helpers (addresses, keys,
// page sizes). src/main/browser.js drives the page with them.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

// Pages on this computer: the user's own dev servers. Everything else is a site.
function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
}

/**
 * An address as the agent or the user typed it, made loadable: "localhost:3000"
 * and "example.com/docs" get a scheme. Only http(s) and about:blank; null for
 * anything else (file:, javascript:, data:...).
 */
function normalizeUrl(input) {
  let text = String(input || '').trim();
  if (!text) return null;
  if (text === 'about:blank') return text;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return null; // mailto:, javascript:, data:...
    const host = text.split(/[/:?#]/)[0];
    text = `${isLocalHost(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 'http' : 'https'}://${text}`;
  }
  let url;
  try { url = new URL(text); } catch { return null; }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

function isLocalUrl(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'about:' || isLocalHost(url.hostname);
  } catch {
    return false;
  }
}

// A site's name for an approval: "example.com", "docs.example.com:8443".
function siteOf(href) {
  try { return new URL(href).host; } catch { return ''; }
}

/**
 * A site as the user typed it into Preferences, made a plain host name:
 * "https://Docs.Example.com:8443/x" -> "docs.example.com", "*.example.com" ->
 * "example.com". Null for something that is not a site.
 */
function normalizeSite(input) {
  let text = String(input || '').trim().toLowerCase().replace(/^\*\./, '');
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = `https://${text}`;
  let host;
  try { host = new URL(text).hostname; } catch { return null; }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host.length > 253) return null;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host) || /^[0-9a-f:]+$/.test(host) ? host : null;
}

// Whether a page is on one of the user's sites: the site itself or under it
// ("example.com" covers docs.example.com, not notexample.com).
function onSiteList(href, sites) {
  let host;
  try { host = new URL(href).hostname.toLowerCase(); } catch { return false; }
  return (sites || []).some((site) => host === site || host.endsWith(`.${site}`));
}

const PRESETS = {
  mobile: { width: 390, height: 844, mobile: true },
  tablet: { width: 820, height: 1180, mobile: true },
  desktop: null, // the pane's own size
};

// Keys as the agent writes them ("Enter", "Control+A", "Shift+Tab") to
// Electron's input events: { keyCode, modifiers }.
const KEY_NAMES = {
  enter: 'Enter', return: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab', space: 'Space',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert',
};
const MODIFIERS = { control: 'control', ctrl: 'control', shift: 'shift', alt: 'alt', option: 'alt', meta: 'meta', cmd: 'meta', command: 'meta' };

function parseKeys(text) {
  const combos = String(text || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (const combo of combos) {
    const parts = combo.split('+').filter(Boolean);
    const modifiers = [];
    let key = null;
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (MODIFIERS[lower]) modifiers.push(MODIFIERS[lower]);
      else if (KEY_NAMES[lower]) key = KEY_NAMES[lower];
      else if (/^f([1-9]|1[0-2])$/i.test(part)) key = part.toUpperCase();
      else if (part.length === 1) key = part;
      else return { error: `Unknown key "${part}" in "${combo}".` };
    }
    if (!key) return { error: `No key in "${combo}".` };
    out.push({ keyCode: key, modifiers });
  }
  if (!out.length) return { error: 'No keys given.' };
  return { keys: out };
}

// ── In the page ──────────────────────────────────────────────────────────────
// Runs in an isolated world (the page's scripts cannot see or change it), so
// the refs it hands out live in its own globals and the page's DOM is never
// touched. Serialized with toString: everything it needs is inside it.
function pageOp(op, arg) {
  /* eslint-disable no-undef */
  const MAX_CHARS = 12000;
  const MAX_TEXT = 300;
  const S = window.__cfBrowser || (window.__cfBrowser = { refs: new Map(), ids: new WeakMap(), next: 1 });
  const refOf = (el) => {
    let ref = S.ids.get(el);
    if (!ref) {
      ref = `ref_${S.next++}`;
      S.ids.set(el, ref);
      S.refs.set(ref, new WeakRef(el));
    }
    return ref;
  };
  const elOf = (ref) => {
    const held = S.refs.get(String(ref || '').trim());
    const el = held && held.deref();
    return el && el.isConnected ? el : null;
  };
  const clean = (text, max = MAX_TEXT) => {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
  const quote = (s) => JSON.stringify(s);

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK']);
  const ROLE_OF_INPUT = {
    checkbox: 'checkbox', radio: 'radio', range: 'slider', button: 'button', submit: 'button', reset: 'button',
    image: 'button', file: 'file input', color: 'color input', search: 'searchbox',
  };
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'textbox', 'searchbox', 'combobox', 'slider', 'spinbutton',
    'treeitem', 'listbox']);

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').split(/\s+/)[0];
    if (explicit) return explicit;
    switch (el.tagName) {
      case 'A': return el.hasAttribute('href') ? 'link' : '';
      case 'BUTTON': case 'SUMMARY': return 'button';
      case 'SELECT': return el.multiple ? 'listbox' : 'combobox';
      case 'TEXTAREA': return 'textbox';
      case 'INPUT': {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'hidden') return '';
        return ROLE_OF_INPUT[type] || 'textbox';
      }
      default:
        if (el.isContentEditable && el.contentEditable !== 'inherit') return 'textbox';
        return '';
    }
  }

  function interactive(el) {
    const role = roleOf(el);
    if (INTERACTIVE_ROLES.has(role) || role === 'file input' || role === 'color input') return role;
    const tab = el.getAttribute('tabindex');
    if (tab !== null && Number(tab) >= 0 && el.tagName !== 'BODY') return role || 'focusable';
    return '';
  }

  function nameOf(el) {
    const label = el.getAttribute('aria-label');
    if (label) return clean(label, 120);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const text = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean)
        .map((n) => n.innerText || n.textContent).join(' ');
      if (clean(text)) return clean(text, 120);
    }
    if (el.labels && el.labels.length) return clean([...el.labels].map((l) => l.innerText).join(' '), 120);
    if (el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type)) return clean(el.value, 120);
    if (el.tagName === 'IMG') return clean(el.alt, 120);
    const text = clean(el.innerText || el.textContent, 120);
    if (text) return text;
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img && img.alt) return clean(img.alt, 120);
    return clean(el.getAttribute('title') || el.getAttribute('placeholder') || '', 120);
  }

  function shownHref(el) {
    const href = el.getAttribute('href') || '';
    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
    } catch {
      return href;
    }
  }

  function describe(el, role) {
    const parts = [role || roleOf(el) || el.tagName.toLowerCase()];
    const name = nameOf(el);
    if (name) parts.push(quote(name));
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (el.checked) parts.push('checked');
      } else if (type === 'password') {
        if (el.value) parts.push('value=(hidden)');
      } else if (el.value) {
        parts.push(`value=${quote(clean(el.value, 80))}`);
      }
      if (el.placeholder && el.placeholder !== name) parts.push(`placeholder=${quote(clean(el.placeholder, 60))}`);
    }
    if (el.tagName === 'SELECT') {
      const chosen = [...el.selectedOptions].map((o) => clean(o.text, 40)).join(', ');
      parts.push(`value=${quote(chosen)}`);
      const options = [...el.options].slice(0, 12).map((o) => clean(o.text, 30));
      parts.push(`options=${quote(options.join(' | '))}${el.options.length > 12 ? ` (+${el.options.length - 12})` : ''}`);
    }
    if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true') parts.push('checked');
    if (el.getAttribute('aria-expanded')) parts.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
    if (el.getAttribute('aria-selected') === 'true') parts.push('selected');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
    if (el.required) parts.push('required');
    if (el.tagName === 'A' && el.hasAttribute('href')) parts.push(`→ ${clean(shownHref(el), 100)}`);
    return parts.join(' ');
  }

  const blocks = new Map();
  function blockOf(el) {
    let node = el;
    while (node && node !== document.body) {
      if (blocks.has(node)) return blocks.get(node);
      const display = getComputedStyle(node).display;
      if (display !== 'inline' && display !== 'contents') {
        blocks.set(el, node);
        return node;
      }
      node = node.parentElement;
    }
    return document.body;
  }

  function hidden(el) {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (typeof el.checkVisibility === 'function') {
      return !el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    }
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  // The page as lines in reading order: elements to act on (with refs),
  // headings, images, and the text between them, one line per block.
  function lines(root) {
    const out = [];
    let text = '';
    let textBlock = null;
    const flush = () => {
      const t = clean(text);
      if (t) out.push(`text ${quote(t)}`);
      text = '';
      textBlock = null;
    };
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.data.trim()) {
          if (text) text += ' ';
          return;
        }
        const block = blockOf(node.parentElement);
        if (textBlock && block !== textBlock) flush();
        textBlock = block;
        text += node.data;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      if (SKIP.has(el.tagName) || hidden(el)) return;
      const role = interactive(el);
      if (role) {
        flush();
        out.push(`[${refOf(el)}] ${describe(el, role)}`);
        // A select's options and a field's text are in its line already.
        if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
        // A button or link that holds other controls: walk into them.
        if (!el.querySelector('a[href],button,input,select,textarea,[role=button],[role=link],[tabindex]')) return;
      } else if (/^H[1-6]$/.test(el.tagName) || el.getAttribute('role') === 'heading') {
        flush();
        const level = el.tagName[1] || el.getAttribute('aria-level') || '';
        out.push(`heading${level ? ` ${level}` : ''} ${quote(clean(el.innerText, 160))}`);
        return;
      } else if (el.tagName === 'IMG') {
        if (el.alt) {
          flush();
          out.push(`img ${quote(clean(el.alt, 120))}`);
        }
        return;
      } else if (el.tagName === 'IFRAME') {
        flush();
        out.push(`iframe ${quote(clean(el.title || el.src, 120))} (its content is not read)`);
        return;
      } else if (el.tagName === 'BR') {
        text += ' ';
        return;
      }
      for (const child of el.childNodes) visit(child);
      if (el.shadowRoot) for (const child of el.shadowRoot.childNodes) visit(child);
    };
    visit(root);
    flush();
    return out;
  }

  function header() {
    const scroll = Math.round(window.scrollY);
    const height = Math.round(document.documentElement.scrollHeight);
    return `Page ${quote(document.title || '')} ${location.href}\n`
      + `Viewport ${window.innerWidth}x${window.innerHeight}, scrolled to ${scroll} of ${height}.`;
  }

  function cut(list, note) {
    let size = 0;
    const kept = [];
    for (const line of list) {
      size += line.length + 1;
      if (size > MAX_CHARS) {
        kept.push(`… ${list.length - kept.length} more lines cut. ${note}`);
        break;
      }
      kept.push(line);
    }
    return kept.join('\n');
  }

  function target(el) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      label: describe(el),
    };
  }

  const missing = (ref) => ({ error: `No element ${ref || '(none given)'} on this page: read_page again, its refs change when the page does.` });

  switch (op) {
    case 'read': {
      const root = arg && arg.ref ? elOf(arg.ref) : document.body;
      if (!root) return missing(arg.ref);
      if (!document.body) return { text: `${header()}\n(The page is empty.)` };
      const list = lines(root);
      return {
        text: `${header()}\n${list.length ? cut(list, 'Use find, or read_page with a ref for one part.') : '(Nothing visible on the page.)'}`,
      };
    }
    case 'find': {
      const query = String(arg && arg.query || '').toLowerCase().trim();
      if (!query) return { error: 'find needs a query.' };
      const found = lines(document.body).filter((line) => line.toLowerCase().includes(query));
      if (!found.length) return { text: `Nothing on the page matches ${quote(query)}.` };
      return { text: `${found.length} match${found.length === 1 ? '' : 'es'} for ${quote(query)}:\n${cut(found.slice(0, 60), 'Make the query narrower.')}` };
    }
    case 'target': {
      const el = elOf(arg && arg.ref);
      return el ? target(el) : missing(arg && arg.ref);
    }
    case 'focus': {
      const el = elOf(arg && arg.ref);
      if (!el) return missing(arg && arg.ref);
      const spot = target(el);
      el.focus();
      if (typeof el.select === 'function' && /^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        el.select();
      } else if (el.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return { ...spot, focused: document.activeElement === el || el.contains(document.activeElement) };
    }
    case 'scroll': {
      const dir = arg && arg.direction === 'up' ? -1 : 1;
      window.scrollBy({ top: dir * Math.round(window.innerHeight * 0.8), behavior: 'instant' });
      return { text: `Scrolled ${dir < 0 ? 'up' : 'down'}: now at ${Math.round(window.scrollY)} of ${Math.round(document.documentElement.scrollHeight)}.` };
    }
    case 'state':
      return { title: document.title, url: location.href };
    default:
      return { error: `Unknown page operation ${op}.` };
  }
  /* eslint-enable no-undef */
}

// The code a page runs for one operation.
const pageCall = (op, arg) => `(${pageOp.toString()})(${JSON.stringify(op)}, ${JSON.stringify(arg || {})})`;

module.exports = {
  isLocalHost, isLocalUrl, normalizeUrl, siteOf, normalizeSite, onSiteList, parseKeys, PRESETS, pageOp, pageCall,
};
