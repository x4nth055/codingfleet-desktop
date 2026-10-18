// One take of a scene, from a clean start: the demo projects reset, a fresh
// app with an empty profile, the scene played (and recorded), the app closed.
//   node scripts/promo/take.mjs 1-screenshot-fix [--record out.mp4] [--shots dir] [--theme light]
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ctl } from './ctl.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const args = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try { await ctl('quit'); await sleep(1500); } catch { /* none running */ }
execFileSync(process.execPath, [path.join(HERE, 'setup-projects.mjs')], { stdio: 'inherit' });

const electron = path.join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const themeAt = args.indexOf('--theme');
const app = spawn(electron, [path.join(HERE), ...(themeAt === -1 ? [] : [`--theme=${args[themeAt + 1]}`])], {
  cwd: REPO, stdio: 'ignore', env: { ...process.env },
});

const sceneArgs = themeAt === -1 ? args : args.filter((_, i) => i !== themeAt && i !== themeAt + 1);
const scene = spawn(process.execPath, [path.join(HERE, 'run-scene.mjs'), ...sceneArgs], { stdio: 'inherit' });
const code = await new Promise((resolve) => scene.on('close', resolve));
try { await ctl('quit'); } catch { app.kill(); }
process.exit(code);
