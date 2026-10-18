// Plays one scene in a running promo app (app.cjs), optionally recording it.
//   node scripts/promo/run-scene.mjs 1-screenshot-fix [--record out.mp4] [--shots dir]
// --record writes the window at 30 fps; marks.json beside it lists when each
// moment of the scene happened (seconds from the start), for the edit.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ctl } from './ctl.mjs';
import { setup, focus, sleep } from './drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [name, ...rest] = process.argv.slice(2);
const opt = (flag) => {
  const i = rest.indexOf(flag);
  return i === -1 ? null : rest[i + 1];
};
const record = opt('--record');
const shots = opt('--shots');
if (shots) fs.mkdirSync(shots, { recursive: true });

for (let i = 0; i < 100; i++) {
  try { if ((await ctl('ready')).ready) break; } catch { /* starting */ }
  await sleep(200);
}
await sleep(1500);
await focus();
await setup();

const { scene } = await import(pathToFileURL(path.join(HERE, 'scenes', `${name}.mjs`)).href);
let started = Date.now();
const marks = {};
const mark = async (label) => {
  marks[label] = (Date.now() - started) / 1000;
  console.log(`${marks[label].toFixed(1).padStart(6)}s  ${label}`);
  if (shots) await ctl('shot', { file: path.resolve(shots, `${name}-${label}.png`) });
};

if (record) {
  await ctl('record/start', { file: path.resolve(record), fps: 30 });
  started = Date.now();
}
try {
  await scene({ mark });
} finally {
  await ctl('clipboard/restore');
  const nudged = await ctl('eval', { js: 'JSON.stringify(window.__nudged || [])' });
  if (nudged !== '[]') console.log(`layout nudged (and put back): ${nudged}`);
  if (record) {
    const done = await ctl('record/stop');
    fs.writeFileSync(path.resolve(record).replace(/\.\w+$/, '.marks.json'), JSON.stringify(marks, null, 2));
    console.log(`recorded ${done.seconds.toFixed(1)}s to ${done.file}`);
  }
}
