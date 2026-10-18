// Puts the three demo projects of the promo video back to their starting point,
// in C:\dev (or PROMO_DEV_DIR): node scripts/promo/setup-projects.mjs
//   wayfare         a trip page whose phone layout is broken
//   storefront-api  GET /orders, made slow by yesterday's commit (N+1 queries)
//   invoicely       a JavaScript codebase about to move to TypeScript
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(HERE, 'projects');
const ROOT = process.env.PROMO_DEV_DIR || 'C:\\dev';

const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
const commit = (cwd, message, author, date) => {
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', `user.name=${author[0]}`, '-c', `user.email=${author[1]}`, 'commit', '-qm', message],
    { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
};
const MAYA = ['Maya Chen', 'maya@example.com'];
const SAM = ['Sam Okafor', 'sam@example.com'];

function copyTree(from, to, skip = () => false) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (skip(entry.name)) continue;
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyTree(src, dst, skip);
    } else fs.copyFileSync(src, dst);
  }
}

function fresh(name) {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

// A dev server left from an earlier take holds its folder and its port.
if (process.platform === 'win32') {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      'Get-NetTCPConnection -LocalPort 5173,3000 -State Listen -ErrorAction SilentlyContinue | '
      + 'ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }'], { stdio: 'ignore' });
  } catch { /* none was running */ }
}

// ── wayfare ───────────────────────────────────────────────────────────────
{
  const dir = fresh('wayfare');
  copyTree(path.join(SOURCES, 'wayfare'), dir);
  commit(dir, 'Lisbon trip page', MAYA, days(2));
  console.log(`wayfare         ${dir}`);
}

// ── storefront-api ────────────────────────────────────────────────────────
{
  const dir = fresh('storefront-api');
  const src = path.join(SOURCES, 'storefront-api');
  copyTree(src, dir, (name) => name === 'history');
  const route = path.join(dir, 'src', 'routes', 'orders.js');
  const test = path.join(dir, 'test', 'orders.test.js');
  const slow = [fs.readFileSync(route), fs.readFileSync(test)];
  fs.copyFileSync(path.join(src, 'history', 'orders.v1.js'), route);
  fs.copyFileSync(path.join(src, 'history', 'orders.test.v1.js'), test);
  commit(dir, 'Orders API with load test', MAYA, days(4));
  fs.writeFileSync(route, slow[0]);
  fs.writeFileSync(test, slow[1]);
  commit(dir, 'Include customer and items in /orders for the mobile app', SAM, days(1));
  console.log(`storefront-api  ${dir}`);
}

// ── invoicely ─────────────────────────────────────────────────────────────
{
  const dir = fresh('invoicely');
  const src = path.join(SOURCES, 'invoicely');
  copyTree(src, dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(dir, '.npmrc'), 'loglevel=warn\n');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'pipe', shell: true });
  // The starting point is the code without its types: plain JavaScript.
  const ts = createRequire(path.join(dir, 'package.json'))('typescript');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(path.join(dir, 'src')).filter((f) => f.endsWith('.ts'))) {
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText;
    fs.writeFileSync(file.replace(/\.ts$/, '.js'), js);
    fs.unlinkSync(file);
  }
  commit(dir, 'Invoicely 1.9', MAYA, days(6));
  console.log(`invoicely       ${dir}`);
}
