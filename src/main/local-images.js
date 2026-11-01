'use strict';
// Images in a session's own folder, for the window. The agent writes
// ![a chart](out/plot.png) for a file it made there, and the window, which has
// no filesystem, shows it from a cf-local: address this process answers:
//   cf-local://image/?session=<id>&path=<path in the folder>&v=<mtime>[&full=1]
// The window then holds a short address rather than the picture as text, and
// the page keeps the decoded image in its own cache, which it can let go of.
// `v` changes when the file is written again, so an image redrawn after that
// is read again; `full` is the larger copy the viewer shows.
//
// Only files inside the session's folder: an answer that names another path is
// not a reason to read it, and the folder is the one this process holds for
// the session, never a folder the window names. Only the app's own window can
// ask: the browser pane has a session of its own, without this scheme.
const fs = require('fs');
const path = require('path');

const images = require('../core/images');
const tools = require('../core/tools');

const SCHEME = 'cf-local';
const INLINE_MAX_SIDE = 1400;     // shown in the conversation
const VIEWER_MAX_SIDE = 2600;     // opened over the app
const INLINE_MAX_BYTES = 4 * 1024 * 1024;
const VIEWER_MAX_BYTES = 12 * 1024 * 1024;
const MAX_FILE = 40 * 1024 * 1024;

/**
 * @param {{ folderOf: (sessionId: string) => string|null, nativeImage: object }} o
 */
function createLocalImages({ folderOf, nativeImage }) {
  async function locate({ sessionId, path: shown } = {}) {
    const src = images.localImageSource(shown);
    const cwd = folderOf(sessionId);
    if (!src) throw new Error('Not an image file.');
    if (!cwd) throw new Error('This session has no folder on this computer.');
    const file = tools.resolvePath(cwd, src);
    if (!tools.isInside(cwd, file)) throw new Error(`${src} is outside the session folder.`);
    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      throw new Error(`${src} is not there.`);
    }
    if (!stat.isFile()) throw new Error(`${src} is not a file.`);
    if (stat.size > MAX_FILE) throw new Error(`${src} is too large to show.`);
    return { src, file, stat };
  }

  /** What the window needs to name the image: its size and when it was written. */
  async function info(args) {
    const { file, stat } = await locate(args);
    return { name: path.basename(file), bytes: stat.size, mtime: stat.mtimeMs };
  }

  /**
   * The image as it is shown: a large one made smaller (`full`: the viewer's
   * size), an animation or a drawing as it is.
   * @returns {Promise<{ name, bytes, mtime, type, data: Buffer, width?, height? }>}
   */
  async function read(args = {}) {
    const { src, file, stat } = await locate(args);
    const limit = args.full ? VIEWER_MAX_BYTES : INLINE_MAX_BYTES;
    const bytes = await fs.promises.readFile(file);
    const found = { name: path.basename(file), bytes: stat.size, mtime: stat.mtimeMs };
    const untouched = () => ({ ...found, type: images.mimeOf(file), data: bytes });
    // An animation or a drawing: an image decoder would flatten the one and
    // rasterize the other, and the window draws both as they are.
    if (images.keepsAsIs(file)) {
      if (bytes.length > limit) throw new Error(`${src} is too large to show.`);
      return untouched();
    }
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) {
      // A format this decoder does not read. The window's is newer; let it try.
      if (bytes.length > limit) throw new Error(`${src} could not be read.`);
      return untouched();
    }
    const size = image.getSize();
    const side = args.full ? VIEWER_MAX_SIDE : INLINE_MAX_SIDE;
    const scale = Math.min(1, side / Math.max(size.width, size.height));
    const sized = scale < 1
      ? image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best',
      })
      : image;
    if (scale === 1 && bytes.length <= limit) return { ...untouched(), ...sized.getSize() };
    let data = sized.toPNG();
    for (const quality of [92, 80, 65]) {
      if (data.length <= limit) break;
      data = sized.toJPEG(quality);
    }
    if (data.length > limit) throw new Error(`${src} is too large to show.`);
    const type = data.length && data[0] === 0x89 ? 'image/png' : 'image/jpeg';
    return { ...found, ...sized.getSize(), type, data };
  }

  /** The image as a data: URL, for a copy drawn on a canvas (copying it). */
  async function dataUrl(args) {
    const { data, type, ...rest } = await read(args);
    return { ...rest, url: `data:${type};base64,${data.toString('base64')}` };
  }

  /** The answer to a cf-local: request. */
  async function respond(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Not an address.', { status: 400 });
    }
    if (url.hostname !== 'image') return new Response('Not found.', { status: 404 });
    try {
      const image = await read({
        sessionId: url.searchParams.get('session'),
        path: url.searchParams.get('path'),
        full: url.searchParams.get('full') === '1',
      });
      return new Response(image.data, {
        status: 200,
        // The address names the version (v): it never changes under it.
        headers: { 'Content-Type': image.type, 'Cache-Control': 'max-age=31536000, immutable' },
      });
    } catch (err) {
      return new Response(err.message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }

  return { info, read, dataUrl, respond };
}

module.exports = { createLocalImages, SCHEME };
