'use strict';
// A QR code as an SVG picture. Always black on white, with the white margin
// the standard asks for: a phone's camera needs both, whatever the app's theme.
// Made in the main process; the window only shows the picture.
const qrcode = require('qrcode-generator');

// Modules of white around the code.
const QUIET_ZONE = 4;

/**
 * @param {string} text What the code holds.
 * @returns {string} An <svg> of (modules + 8) units a side: a white square, and one path of black modules.
 */
function qrSvg(text) {
  // 0: the smallest code that holds the text. M: readable with 15% of it hidden.
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  let d = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      // Black modules side by side are one rectangle.
      let run = 1;
      while (col + run < count && qr.isDark(row, col + run)) run++;
      d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`;
      col += run - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">`
    + `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}

module.exports = { qrSvg, QUIET_ZONE };
