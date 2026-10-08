'use strict';
// The taskbar button: busy while a run goes, marked while an approval waits.
const assert = require('node:assert/strict');
const test = require('node:test');

const { createTaskbar, overlayDot } = require('../src/main/taskbar');

function fakes(platform) {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    setProgressBar: (value, options) => calls.push(['progress', value, options.mode]),
    setOverlayIcon: (image, text) => calls.push(['overlay', image ? 'dot' : null, text]),
  };
  const app = { setBadgeCount: (n) => calls.push(['badge', n]) };
  const nativeImage = { createFromBitmap: (data, size) => ({ data, ...size }) };
  return { calls, taskbar: createTaskbar({ app, nativeImage, getWindow: () => win, platform }) };
}

test('Windows: a moving bar while a run goes, an amber mark while one waits', () => {
  const { calls, taskbar } = fakes('win32');
  taskbar.sync({ running: 1, waiting: 0 });
  taskbar.sync({ running: 1, waiting: 0 }); // nothing new: nothing done
  taskbar.sync({ running: 1, waiting: 2 });
  taskbar.sync({ running: 0, waiting: 0 });
  assert.deepEqual(calls, [
    ['progress', 2, 'indeterminate'], ['overlay', null, ''],
    ['progress', 1, 'paused'], ['overlay', 'dot', '2 approvals waiting'],
    ['progress', -1, 'none'], ['overlay', null, ''],
  ]);
});

test('macOS and Linux: the number of approvals waiting, as a badge', () => {
  const { calls, taskbar } = fakes('darwin');
  taskbar.sync({ running: 1, waiting: 1 });
  taskbar.sync({ running: 0, waiting: 0 });
  assert.deepEqual(calls, [['progress', 1, 'paused'], ['badge', 1], ['progress', -1, 'none'], ['badge', 0]]);
});

test('the mark is a 16 by 16 picture, see-through at the corners', () => {
  const dot = overlayDot({ createFromBitmap: (data, size) => ({ data, ...size }) });
  assert.equal(dot.width, 16);
  assert.equal(dot.data.length, 16 * 16 * 4);
  assert.equal(dot.data[3], 0, 'corner is transparent');
  assert.equal(dot.data[(8 * 16 + 8) * 4 + 3], 255, 'middle is solid');
});
