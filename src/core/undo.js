'use strict';
// Undoing a run: putting back the files it changed, from the copies the Run
// kept while it worked. No Electron in here: the CLI can undo a run too.
//
// A run hands over one entry per file it touched, each with the version from
// before the run and the version it left behind:
//   { path, before: { exists, text }, after: { exists, text } }
// `text` is null for a binary or very large file, which was never read: there
// is no copy to put back, so those are reported as skipped, never guessed at.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Why this file cannot be put back, or null when it can.
function blocked(entry) {
  const { before, after } = entry || {};
  if (!before || !after) return 'the run did not finish writing this file';
  if (before.text === null || after.text === null) return 'a binary or very large file: no copy was kept';
  return null;
}

// What the file holds now, in the shape the Run records.
async function current(file) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return { exists: false, text: '' };
    return { exists: true, text: await fsp.readFile(file, 'utf8') };
  } catch {
    return { exists: false, text: '' };
  }
}

// Someone edited the file after the run: putting the old version back would
// throw their work away, so it is skipped unless the caller insists.
function changedSince(now, after) {
  if (now.exists !== after.exists) return true;
  return now.exists && now.text !== after.text;
}

async function revertOne(entry, { force = false } = {}) {
  const why = blocked(entry);
  if (why) return { path: entry.path, ok: false, reason: why };

  const { path: file, before, after } = entry;
  const now = await current(file);
  if (!force && changedSince(now, after)) {
    return { path: file, ok: false, reason: 'it changed after the run', conflict: true };
  }

  try {
    if (!before.exists) {
      // The run created this file: undoing it means removing it again.
      if (now.exists) await fsp.rm(file, { force: true });
      return { path: file, ok: true, action: 'deleted' };
    }
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, before.text, 'utf8');
    return { path: file, ok: true, action: now.exists ? 'restored' : 'recreated' };
  } catch (err) {
    return { path: file, ok: false, reason: err.message };
  }
}

/**
 * Put back every file a run changed.
 * @param {Array} entries from Run#restorePoints()
 * @param {{ force?: boolean }} options force: overwrite files edited since the run
 * @returns {Promise<{ restored: Array, skipped: Array, conflicts: number }>}
 */
async function revertRun(entries, options = {}) {
  const results = [];
  for (const entry of entries || []) results.push(await revertOne(entry, options));
  return {
    restored: results.filter((r) => r.ok),
    skipped: results.filter((r) => !r.ok),
    conflicts: results.filter((r) => r.conflict).length,
  };
}

module.exports = { revertRun, revertOne, blocked, changedSince };
