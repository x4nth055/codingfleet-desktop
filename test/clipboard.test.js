'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { createClipboard } = require('../src/main/clipboard');

// Electron's clipboard as Electron 44 has it: promises, and write([ClipboardItem]).
function fake({ empty = false } = {}) {
  const written = [];
  class ClipboardItem {
    constructor(items) { this.items = items; }
  }
  const copying = createClipboard({
    clipboard: {
      writeText: async (text) => { written.push({ text }); },
      write: async (items) => { written.push({ items }); },
    },
    ClipboardItem,
    nativeImage: { createFromDataURL: () => ({ isEmpty: () => empty }) },
  });
  return { copying, written, ClipboardItem };
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;

test('text is written as text, and cut at 5 million characters', async () => {
  const { copying, written } = fake();
  assert.equal(await copying.writeText('C:\\work\\a.mp4'), true);
  await copying.writeText(null);
  await copying.writeText('x'.repeat(5_000_010));
  assert.equal(written[0].text, 'C:\\work\\a.mp4');
  assert.equal(written[1].text, '');
  assert.equal(written[2].text.length, 5_000_000);
});

test('a picture is written as a PNG clipboard item', async () => {
  const { copying, written, ClipboardItem } = fake();
  assert.equal(await copying.writeImage(PNG_URL), true);
  const [item] = written[0].items;
  assert.ok(item instanceof ClipboardItem);
  const blob = item.items['image/png'];
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), PNG);
});

test('anything but a PNG data URL is refused', async () => {
  const { copying, written } = fake();
  for (const bad of [null, 42, 'https://a.b/c.png', 'data:image/jpeg;base64,AAAA', 'data:text/html,<b>x</b>']) {
    await assert.rejects(copying.writeImage(bad), /Not an image/);
  }
  await assert.rejects(copying.writeImage(`data:image/png;base64,${'A'.repeat(60_000_001)}`), /Not an image/);
  assert.equal(written.length, 0);
});

test('a PNG that does not decode is refused', async () => {
  const { copying, written } = fake({ empty: true });
  await assert.rejects(copying.writeImage(PNG_URL), /could not be copied/);
  assert.equal(written.length, 0);
});
