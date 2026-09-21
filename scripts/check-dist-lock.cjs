'use strict';
// electron-builder will wait -- forever -- when the file it wants to write is
// held open by the app you are running from that same folder. On Windows the
// portable launcher (dist/CodingFleet 0.2.0.exe) is the app itself, so a
// rebuild hangs on "output file is locked for writing (maybe by virus
// scanner)". Whoever is waiting on that build (a person, or an agent whose run
// is then cut off with "Generation stopped unexpectedly") learns nothing.
//
// Fail in a second, with the one instruction that fixes it.
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const build = pkg.build || {};
const output = (build.directories && build.directories.output) || 'dist';
const product = build.productName || pkg.productName || pkg.name;
const artifact = path.resolve(__dirname, '..', output, `${product} ${pkg.version}.exe`);

function isLocked(file) {
  // The file does not exist yet: nothing to overwrite, nothing to lock.
  if (!fs.existsSync(file)) return false;
  try {
    fs.closeSync(fs.openSync(file, 'r+'));
    return false;
  } catch (err) {
    // A running executable refuses a write handle: EBUSY (or EPERM/EACCES).
    return err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
  }
}

if (isLocked(artifact)) {
  const shown = path.relative(process.cwd(), artifact).replace(/\\/g, '/');
  console.error(
    `\nCannot build: ${shown} is locked, because the app is running from it.\n`
    + '  Close CodingFleet and build again, or build beside it:\n'
    + '    npm run dist:next      (writes to dist-next/, never touches the running app)\n',
  );
  process.exit(1);
}
