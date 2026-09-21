'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const images = require('../src/core/images');

test('a relative image path in an answer is a file on this computer', () => {
  assert.equal(images.localImageSource('out/plot.png'), 'out/plot.png');
  assert.equal(images.localImageSource('./chart.JPG'), './chart.JPG');
  assert.equal(images.localImageSource('../shared/logo.svg'), '../shared/logo.svg');
  assert.equal(images.localImageSource('C:\\work\\demo\\shot.png'), 'C:\\work\\demo\\shot.png');
  assert.equal(images.localImageSource('/home/u/pics/a.webp'), '/home/u/pics/a.webp');
  assert.equal(images.localImageSource('  spaced name.png  '), 'spaced name.png');
  assert.equal(images.localImageSource('<out/plot.png>'), 'out/plot.png');
});

test('a URL, a data image and a file that is not an image are left alone', () => {
  assert.equal(images.localImageSource('https://codingfleet.com/a.png'), null);
  assert.equal(images.localImageSource('http://127.0.0.1:8000/a.png'), null);
  assert.equal(images.localImageSource('data:image/png;base64,AAAA'), null);
  assert.equal(images.localImageSource('blob:abc'), null);
  assert.equal(images.localImageSource('notes/report.md'), null);
  assert.equal(images.localImageSource('plot'), null);
  assert.equal(images.localImageSource(''), null);
  assert.equal(images.localImageSource(null), null);
  assert.equal(images.localImageSource(`bad${String.fromCharCode(0)}.png`), null);
  assert.equal(images.localImageSource(`${'a'.repeat(1200)}.png`), null);
});

test('a file URL and an escaped path become a plain path', () => {
  assert.equal(images.localImageSource('file:///C:/work/out/plot.png'), 'C:/work/out/plot.png');
  assert.equal(images.localImageSource('file:///home/u/p.png'), '/home/u/p.png');
  assert.equal(images.localImageSource('out/my%20plot.png'), 'out/my plot.png');
  assert.equal(images.localImageSource('out/plot.png?v=2'), 'out/plot.png');
  assert.equal(images.localImageSource('out/plot.png#top'), 'out/plot.png');
});

test('the media type follows the extension, and drawings are not re-encoded', () => {
  assert.equal(images.mimeOf('a/b.png'), 'image/png');
  assert.equal(images.mimeOf('a/b.JPEG'), 'image/jpeg');
  assert.equal(images.mimeOf('a/b.svg'), 'image/svg+xml');
  assert.equal(images.mimeOf('a/b.txt'), 'application/octet-stream');
  assert.equal(images.keepsAsIs('loop.gif'), true);
  assert.equal(images.keepsAsIs('logo.svg'), true);
  assert.equal(images.keepsAsIs('shot.png'), false);
});

test('a region is cut from the capture at the screen scale factor', () => {
  const bounds = { x: 0, y: 0, width: 1600, height: 900 };
  const size = { width: 3200, height: 1800 };   // a 2x screen
  assert.deepEqual(images.cropBox({ x: 10, y: 20, width: 100, height: 50 }, bounds, size),
    { x: 20, y: 40, width: 200, height: 100 });
  // A screen captured at its logical size needs no scaling.
  assert.deepEqual(images.cropBox({ x: 5, y: 5, width: 40, height: 30 }, bounds, { width: 1600, height: 900 }),
    { x: 5, y: 5, width: 40, height: 30 });
});

test('a region that runs off the screen is cut back, and a click selects nothing', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 800 };
  const size = { width: 1000, height: 800 };
  assert.deepEqual(images.cropBox({ x: 900, y: 700, width: 400, height: 400 }, bounds, size),
    { x: 900, y: 700, width: 100, height: 100 });
  assert.equal(images.cropBox({ x: 10, y: 10, width: 2, height: 3 }, bounds, size), null);
  assert.equal(images.cropBox(null, bounds, size), null);
});
