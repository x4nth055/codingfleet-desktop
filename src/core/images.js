'use strict';
// Which image link in an answer means a file on this computer.
//
// An agent working in a folder makes images there — a chart it plotted, a
// screenshot it took, a diagram it rendered — and writes them into its answer
// as ![a chart](out/plot.png). Nothing serves that path, so the window asks
// the main process for the file and shows the bytes it gets back.
//
// No Node and no DOM here: the window loads this as a script, the main process
// requires it, and the tests call it directly.
(function (root) {
  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg'];
  // A scheme needs two characters at least, so "C:\out\plot.png" is a path and
  // "data:…" is not.
  const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
  const MAX_PATH = 1024;

  const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
  };

  function extensionOf(value) {
    const name = String(value).split(/[\\/]/).pop() || '';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
  }

  function decode(value) {
    if (!value.includes('%')) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // file:///C:/out/plot.png -> C:/out/plot.png, file:///home/u/p.png -> /home/u/p.png
  function fromFileUrl(value) {
    let rest = value.replace(/^file:\/\/[^/]*/i, '');
    if (/^\/[a-z]:/i.test(rest)) rest = rest.slice(1);
    return decode(rest.split('#')[0].split('?')[0]);
  }

  /**
   * The path a markdown image link points at on this computer, or null when it
   * is a URL, a data: image or not an image at all.
   */
  function localImageSource(raw) {
    let src = String(raw == null ? '' : raw).trim();
    if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1).trim();
    if (!src || src.includes('\0') || src.length > MAX_PATH) return null;
    if (/^file:\/\//i.test(src)) src = fromFileUrl(src);
    else if (SCHEME.test(src)) return null;
    else src = decode(src.split('#')[0].split('?')[0]);
    src = src.trim();
    if (!src || !IMAGE_EXTS.includes(extensionOf(src))) return null;
    return src;
  }

  const mimeOf = (file) => MIME_BY_EXT[extensionOf(file)] || 'application/octet-stream';

  // Animation and vector: re-encoding these through an image decoder loses the
  // animation or the text, and the window draws them by itself anyway.
  const keepsAsIs = (file) => ['.gif', '.svg', '.avif', '.bmp', '.ico'].includes(extensionOf(file));

  /**
   * The part of a screen capture that a drag on the region overlay selected.
   * The rectangle is in the screen's logical pixels and the capture is in real
   * ones, so both sides are scaled. null for a click, or for nothing left.
   */
  function cropBox(rect, bounds, size, minSide = 6) {
    const box = rect || {};
    const width = Math.round(Number(box.width) || 0);
    const height = Math.round(Number(box.height) || 0);
    if (width < minSide && height < minSide) return null;
    const scaleX = size.width / Math.max(1, bounds.width);
    const scaleY = size.height / Math.max(1, bounds.height);
    const x = Math.min(Math.max(0, Math.round((Number(box.x) || 0) * scaleX)), size.width - 1);
    const y = Math.min(Math.max(0, Math.round((Number(box.y) || 0) * scaleY)), size.height - 1);
    const cut = {
      x,
      y,
      width: Math.min(Math.max(1, Math.round(width * scaleX)), size.width - x),
      height: Math.min(Math.max(1, Math.round(height * scaleY)), size.height - y),
    };
    return cut.width >= 1 && cut.height >= 1 ? cut : null;
  }

  const api = { IMAGE_EXTS, extensionOf, localImageSource, mimeOf, keepsAsIs, cropBox };
  root.CF_IMAGES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
