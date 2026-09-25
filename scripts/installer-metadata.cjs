'use strict';
// After the Windows installer is signed, its bytes change: the checksum in
// latest.yml (which installed copies check an update against) and the
// blockmap (for downloading only the changed parts) describe a file that no
// longer exists. This writes both again, for the file as it is now:
//
//   node scripts/installer-metadata.cjs dist/CodingFleet-Setup-0.3.0.exe
//
// It uses electron-builder's own blockmap code, so the output is what
// electron-builder itself would have written for a signed file.
const fs = require('fs');
const path = require('path');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

async function main() {
  const installer = process.argv[2];
  if (!installer || !fs.existsSync(installer)) {
    console.error('usage: node scripts/installer-metadata.cjs <path to the installer .exe>');
    process.exit(2);
  }
  const pkg = require('../package.json');
  const name = path.basename(installer);
  const info = await buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
  const yml = [
    `version: ${pkg.version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${info.sha512}`,
    `    size: ${info.size}`,
    `path: ${name}`,
    `sha512: ${info.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(path.dirname(installer), 'latest.yml'), yml);
  console.log(`latest.yml and ${name}.blockmap written: ${info.size} bytes, sha512 ${info.sha512}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
