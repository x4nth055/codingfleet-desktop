'use strict';
// Copying for the window, which has no clipboard permission of its own: text
// (a path, a code block, a link) and pictures (an image in the conversation,
// drawn again as a PNG there).
//
// Electron 44's clipboard is the W3C one: writeText and write([ClipboardItem])
// return promises, and there is no writeImage any more.

const MAX_TEXT = 5_000_000;
const MAX_IMAGE_URL = 60_000_000;
const PNG_URL = 'data:image/png;base64,';

/**
 * @param {object} deps
 * @param {object} deps.clipboard Electron's clipboard
 * @param {Function} deps.ClipboardItem Electron's ClipboardItem
 * @param {object} deps.nativeImage Electron's nativeImage, to check a picture is one
 */
function createClipboard({ clipboard, ClipboardItem, nativeImage }) {
  return {
    async writeText(text) {
      await clipboard.writeText(String(text ?? '').slice(0, MAX_TEXT));
      return true;
    },

    /** A PNG as a data: URL, onto the clipboard as an image other apps paste. */
    async writeImage(url) {
      if (typeof url !== 'string' || !url.startsWith(PNG_URL) || url.length > MAX_IMAGE_URL) {
        throw new Error('Not an image.');
      }
      if (nativeImage.createFromDataURL(url).isEmpty()) throw new Error('This image could not be copied.');
      const png = Buffer.from(url.slice(PNG_URL.length), 'base64');
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
      return true;
    },
  };
}

module.exports = { createClipboard };
