'use strict';
// Images in a session's folder, as the window's cf-local: addresses get them:
// only inside the folder, made smaller when large, answered with a status.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createLocalImages, SCHEME } = require('../src/main/local-images');

// Electron's decoder, as far as these tests need it: a PNG is 3000x1500 and
// shrinks as asked; anything else is a format it does not read.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const fakeImage = (width, height) => ({
  isEmpty: () => false,
  getSize: () => ({ width, height }),
  resize: ({ width: w, height: h }) => fakeImage(w, h),
  toPNG: () => Buffer.concat([PNG_MAGIC, Buffer.alloc(w(width, height))]),
  toJPEG: () => Buffer.from([0xff, 0xd8, 0xff]),
});
const w = (width, height) => Math.round((width * height) / 1000);
const nativeImage = {
  createFromBuffer: (bytes) => (bytes.subarray(0, 4).equals(PNG_MAGIC) ? fakeImage(3000, 1500) : { isEmpty: () => true }),
};

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-local-images-'));
  const cwd = path.join(root, 'project');
  fs.mkdirSync(path.join(cwd, 'out'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'out', 'big.png'), Buffer.concat([PNG_MAGIC, Buffer.alloc(100)]));
  fs.writeFileSync(path.join(cwd, 'out', 'dance.gif'), Buffer.from('GIF89a....'));
  fs.writeFileSync(path.join(cwd, 'notes.txt'), 'not a picture');
  fs.writeFileSync(path.join(root, 'secret.png'), Buffer.concat([PNG_MAGIC, Buffer.alloc(10)]));
  const images = createLocalImages({ folderOf: (id) => (id === 's1' ? cwd : null), nativeImage });
  return { root, cwd, images };
}

const url = (query) => `${SCHEME}://image/?${new URLSearchParams(query)}`;

test('an image in the folder is described, then served at the size it is shown', async () => {
  const { cwd, images } = setup();
  const info = await images.info({ sessionId: 's1', path: 'out/big.png' });
  assert.equal(info.name, 'big.png');
  assert.equal(info.mtime, fs.statSync(path.join(cwd, 'out', 'big.png')).mtimeMs);
  const inline = await images.read({ sessionId: 's1', path: 'out/big.png' });
  assert.deepEqual([inline.width, inline.height, inline.type], [1400, 700, 'image/png']);
  const full = await images.read({ sessionId: 's1', path: 'out/big.png', full: true });
  assert.deepEqual([full.width, full.height], [2600, 1300]);
  // By its full path, as an answer can write it.
  const byPath = await images.read({ sessionId: 's1', path: path.join(cwd, 'out', 'big.png') });
  assert.equal(byPath.width, 1400);
});

test('an animation is served as it is', async () => {
  const { images } = setup();
  const gif = await images.read({ sessionId: 's1', path: 'out/dance.gif' });
  assert.equal(gif.type, 'image/gif');
  assert.equal(gif.data.toString(), 'GIF89a....');
  assert.match((await images.dataUrl({ sessionId: 's1', path: 'out/dance.gif' })).url, /^data:image\/gif;base64,/);
});

test('nothing outside the folder, missing, or not an image is read', async () => {
  const { root, images } = setup();
  await assert.rejects(images.info({ sessionId: 's1', path: '../secret.png' }), /outside the session folder/);
  await assert.rejects(images.read({ sessionId: 's1', path: path.join(root, 'secret.png') }), /outside the session folder/);
  await assert.rejects(images.info({ sessionId: 's1', path: 'out/gone.png' }), /is not there/);
  await assert.rejects(images.info({ sessionId: 's1', path: 'notes.txt' }), /Not an image file/);
  await assert.rejects(images.info({ sessionId: 's1', path: 'out' }), /Not an image file/);
  await assert.rejects(images.info({ sessionId: 'cloud', path: 'out/big.png' }), /no folder on this computer/);
});

test('a cf-local: request is answered with the picture, or a refusal', async () => {
  const { images } = setup();
  const ok = await images.respond({ url: url({ session: 's1', path: 'out/big.png', v: '1' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.match(ok.headers.get('cache-control'), /immutable/);
  assert.ok((await ok.arrayBuffer()).byteLength > 4);
  const outside = await images.respond({ url: url({ session: 's1', path: '../secret.png' }) });
  assert.equal(outside.status, 404);
  assert.match(await outside.text(), /outside the session folder/);
  assert.equal((await images.respond({ url: `${SCHEME}://other/?session=s1&path=out/big.png` })).status, 404);
  assert.equal((await images.respond({ url: url({ session: 'nobody', path: 'out/big.png' }) })).status, 404);
  assert.equal((await images.respond({ url: 'not a url' })).status, 400);
});
