'use strict';
// The files in a folder, for the composer's @ mentions. No Electron: the main
// process asks for it, the tests run it on a temporary folder.
//
// In a git repository git answers: it knows what is ignored, and it is fast
// on a big tree. Anywhere else the folder is walked, skipping the folders
// nobody means (dependencies, build output, caches) and stopping at a size
// that keeps a click on @ quick in a home directory.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_FILES = 30_000;
const MAX_DEPTH = 10;
const TIMEOUT_MS = 10_000;
const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'vendor', '__pycache__', '.venv', 'venv',
  'dist', 'build', 'target', '.next', '.nuxt', '.cache', 'coverage', '.idea', '.vs', '.gradle', '.terraform',
]);

function gitFiles(dir) {
  return new Promise((resolve) => {
    execFile('git', ['--no-optional-locks', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: dir, windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8',
    }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout || '').split('\0').filter(Boolean));
    });
  });
}

async function walkFiles(dir) {
  const files = [];
  let level = [''];
  for (let depth = 0; depth <= MAX_DEPTH && level.length && files.length < MAX_FILES; depth++) {
    const next = [];
    for (const rel of level) {
      let entries;
      try {
        entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true });
      } catch {
        continue; // unreadable: skipped, like a search would
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) next.push(child);
        } else if (entry.isFile()) {
          files.push(child);
          if (files.length >= MAX_FILES) break;
        }
      }
      if (files.length >= MAX_FILES) break;
    }
    level = next;
  }
  return files;
}

/** The folders that hold `files`, each once, ending in "/". */
function foldersOf(files) {
  const dirs = new Set();
  for (const file of files) {
    let at = file.lastIndexOf('/');
    while (at > 0) {
      const dir = file.slice(0, at + 1);
      if (dirs.has(dir)) break;
      dirs.add(dir);
      at = file.lastIndexOf('/', at - 1);
    }
  }
  return [...dirs];
}

/**
 * The files under `dir` and the folders that hold them, relative to `dir`,
 * with forward slashes. Folders end in "/".
 * @returns {Promise<{ files: string[], dirs: string[], truncated: boolean, source: 'git'|'walk' }>}
 */
async function listFiles(dir) {
  let files = await gitFiles(dir);
  const source = files ? 'git' : 'walk';
  if (!files) files = await walkFiles(dir);
  files = files.map((f) => f.replace(/\\/g, '/'));
  const truncated = files.length >= MAX_FILES;
  if (truncated) files = files.slice(0, MAX_FILES);
  return { files, dirs: foldersOf(files), truncated, source };
}

module.exports = { listFiles, foldersOf, walkFiles, MAX_FILES, SKIP_DIRS };
