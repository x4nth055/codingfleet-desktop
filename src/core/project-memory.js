'use strict';
// Project memory: what the agent keeps about one project folder between
// sessions. It is a folder of Markdown files — MEMORY.md, the index, and one
// file per entry — which the agent reads and writes with its ordinary file
// tools. A new session gets the index in its system message; the entries stay
// on disk until the agent opens one.
//
// The same shape as the web chat's memory (an index of `name: description`
// lines, the text behind each name read on demand), kept as files here because
// a folder session has a disk and the files stay readable by other tools.
//
// No Electron in this file: the CLI can use it as it is.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const INDEX_FILE = 'MEMORY.md';
// The index goes into the system message of every new session in the folder.
const INDEX_MAX_CHARS = 12_000;
const DESCRIPTION_MAX = 150;
// Where the memory is kept: the app's own data folder (the default), inside
// each project folder, or under a folder the user chose.
const LOCATIONS = ['app', 'project', 'custom'];
const IN_PROJECT = path.join('.codingfleet', 'memory');
const GIT_EXCLUDE_LINE = '.codingfleet/';

const INDEX_HEADER = [
  '# Project memory',
  '',
  'What the CodingFleet agent keeps about this project between sessions.',
  'One line per entry: `- [name](name.md): what the entry holds`. Each entry is the file beside this one.',
  '',
].join('\n');

// The link's target ends at ".md)": a file name may hold brackets itself.
const ENTRY_LINE = /^\s*[-*]\s*\[(.+?)\]\((.+?\.md)\)\s*(?:[:—-]\s*(.*))?$/i;
// Windows and macOS (as it is set up by default) take Shop and shop for one folder.
const FOLDS_CASE = process.platform === 'win32' || process.platform === 'darwin';

const isInside = (dir, target) => {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** A name for the folder's memory in a shared place: readable, and unique to the path. */
function folderKey(cwd) {
  const full = path.resolve(String(cwd));
  const identity = FOLDS_CASE ? full.toLowerCase() : full;
  const hash = crypto.createHash('sha1').update(identity).digest('hex').slice(0, 8);
  const slug = path.basename(full).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'project'}-${hash}`;
}

/** The memory folder of the project at `cwd`, for these settings. */
function memoryDir(cwd, { location, customDir, appDir } = {}) {
  if (location === 'project') {
    const dir = path.join(path.resolve(cwd), IN_PROJECT);
    // A repository can carry .codingfleet, or the folder in it, as a link to
    // anywhere. The notes of such a project stay in the app's folder: nothing
    // is read, made or deleted at the link's end.
    if (!appDir || !throughLink(cwd, dir)) return dir;
  }
  if (location === 'custom' && customDir) return path.join(path.resolve(customDir), folderKey(cwd));
  return path.join(appDir, 'projects', folderKey(cwd), 'memory');
}

const samePath = (a, b) => (FOLDS_CASE ? a.toLowerCase() === b.toLowerCase() : a === b);

// Whether `target`, written below `folder`, is reached through a link: its
// real place is not the one its name gives. (realPath is defined further down.)
function throughLink(folder, target) {
  const rel = path.relative(path.resolve(folder), path.resolve(target));
  return !samePath(realPath(target), path.join(realPath(folder), rel));
}

function descriptionOf(text) {
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^[\s>#*\-\d.]+/, '').trim();
    if (line) return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1)}…` : line;
  }
  return '';
}

/** The entry files of a memory folder: [{ name, file, size, mtime }]. */
function entryFiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const file of names) {
    if (!/\.md$/i.test(file) || file.toLowerCase() === INDEX_FILE.toLowerCase()) continue;
    try {
      // lstat: a link is not an entry, wherever it leads. Its target's first
      // line would otherwise be copied into the index, and so into a prompt.
      const stat = fs.lstatSync(path.join(dir, file));
      if (stat.isFile()) out.push({ name: file.replace(/\.md$/i, ''), file, size: stat.size, mtime: stat.mtimeMs });
    } catch { /* gone between the two calls */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// An entry file with nothing but white space: how the agent deletes an entry.
function isBlank(dir, entry) {
  if (entry.size === 0) return true;
  if (entry.size > 4096) return false; // a longer file of only spaces is not worth the read
  try { return !fs.readFileSync(path.join(dir, entry.file), 'utf8').trim(); } catch { return false; }
}

/**
 * Bring MEMORY.md in step with the entry files, and return its text. An entry
 * file with no line gets one (described by its first line); a line whose file
 * is gone is dropped; an empty entry file is how the agent deletes an entry,
 * so it is removed. Lines the agent wrote are kept as they are.
 */
function syncIndex(dir) {
  const indexPath = path.join(dir, INDEX_FILE);
  for (const entry of entryFiles(dir)) {
    if (!isBlank(dir, entry)) continue;
    try { fs.unlinkSync(path.join(dir, entry.file)); } catch { /* left as it is */ }
  }
  const files = new Map(entryFiles(dir).map((entry) => [entry.file.toLowerCase(), entry]));
  let current = null;
  try { current = fs.readFileSync(indexPath, 'utf8'); } catch { /* no index yet */ }

  const kept = [];
  const listed = new Set();
  for (const line of (current === null ? INDEX_HEADER : current).split(/\r?\n/)) {
    const match = ENTRY_LINE.exec(line);
    if (!match) { kept.push(line); continue; }
    const file = path.basename(match[2].trim()).toLowerCase();
    if (!files.has(file) || listed.has(file)) continue; // its file is gone, or a second line for it
    listed.add(file);
    kept.push(line);
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const missing = [...files.values()].filter((entry) => !listed.has(entry.file.toLowerCase()));
  if (missing.length && kept.length && ENTRY_LINE.exec(kept[kept.length - 1]) === null) kept.push('');
  for (const entry of missing) {
    let description = '';
    try { description = descriptionOf(fs.readFileSync(path.join(dir, entry.file), 'utf8')); } catch { /* unreadable */ }
    kept.push(`- [${entry.name}](${entry.file}): ${description || entry.name}`);
  }
  const text = `${kept.join('\n')}\n`;
  if (text !== current) fs.writeFileSync(indexPath, text, 'utf8');
  return text;
}

/** Make the folder and its index if they are not there. Returns the index text. */
function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return syncIndex(dir);
}

/** The entries of a memory folder with the description its index gives each. */
function listEntries(dir) {
  const described = new Map();
  try {
    for (const line of fs.readFileSync(path.join(dir, INDEX_FILE), 'utf8').split(/\r?\n/)) {
      const match = ENTRY_LINE.exec(line);
      if (match) described.set(path.basename(match[2].trim()).toLowerCase(), (match[3] || '').trim());
    }
  } catch { /* no index */ }
  // An emptied file is an entry the agent deleted: the next sync removes it.
  return entryFiles(dir).filter((entry) => !isBlank(dir, entry))
    .map((entry) => ({ ...entry, description: described.get(entry.file.toLowerCase()) || '' }));
}

// Forward slashes: a model writes them reliably in a JSON argument, and Node
// resolves them on Windows.
const shown = (dir) => path.resolve(dir).replace(/\\/g, '/');

/** The part of a new session's system message that gives the agent its project memory. */
function instructions(dir, index) {
  let text = String(index || '').trim();
  if (text.length > INDEX_MAX_CHARS) {
    text = `${text.slice(0, INDEX_MAX_CHARS)}\n...[the index is longer: read ${INDEX_FILE} for the rest, and merge or delete entries]`;
  }
  const folder = shown(dir);
  return [
    '# Project memory',
    '',
    'You keep a memory of this project between sessions. It is a folder of Markdown files:',
    `${folder}/`,
    `- ${INDEX_FILE} is the index, one line per entry: \`- [name](name.md): what the entry holds\`.`,
    '- Each entry is one file, <name>.md, about one topic.',
    '',
    'The index as it was when this session started is below. Only the index is in your context:',
    'read an entry with fs_read before you rely on it.',
    '',
    'When you learn something that a later session in this project needs, save it without being asked:',
    'how to build, test and run the project; decisions and the reasons for them; conventions; known',
    'problems and their fixes; what the user wants from this project. Write or edit the entry file',
    `with fs_write or fs_edit, then add or correct its line in ${INDEX_FILE}. Use one topic per file and a`,
    'short kebab-case name. Change an existing entry rather than adding a near-duplicate. To delete an',
    `entry, write its file with empty content and remove its line from ${INDEX_FILE}.`,
    'Reading and writing .md files in this folder needs no approval. Use absolute paths for them.',
    '',
    'Do not save secrets (passwords, keys, tokens), personal data, one-off task details, or what the',
    'code and the git history already say. Facts about the user, not about this project, do not belong',
    'here: save those with update_memory when you have that tool.',
    '',
    `--- ${INDEX_FILE} ---`,
    text || '(no entries yet)',
    `--- end of ${INDEX_FILE} ---`,
  ].join('\n');
}

// The real place of a path that may not exist yet: its nearest existing
// parent, with links followed, plus the part below it.
function realPath(target) {
  let existing = path.resolve(target);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), ...rest.reverse());
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return path.resolve(target);
      rest.push(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * Whether a file-tool call stays inside a memory folder, so that it needs no
 * approval: reading, writing or editing a .md file there, or listing the
 * folder. A link that leads out of the folder does not count as inside.
 */
function allows(name, args, cwd, dirs) {
  args = args || {};
  const folders = (Array.isArray(dirs) ? dirs : [dirs]).filter(Boolean);
  if (!folders.length) return false;
  const resolve = (p) => path.resolve(cwd || process.cwd(), String(p));
  const within = (target) => folders.some((dir) => {
    if (!isInside(dir, target)) return false;
    // A memory folder in the project that is reached through a link is not one.
    if (cwd && isInside(cwd, dir) && throughLink(cwd, dir)) return false;
    return isInside(realPath(dir), realPath(target));
  });
  if (name === 'fs_read' || name === 'fs_write' || name === 'fs_edit') {
    if (!args.path) return false;
    const target = resolve(args.path);
    return /\.md$/i.test(target) && within(target);
  }
  if (name === 'fs_glob') {
    const pattern = String(args.pat || '').replace(/\\/g, '/');
    if (!args.path || path.isAbsolute(pattern) || /(^|[/{,])\.\.([/},]|$)/.test(pattern)) return false;
    return within(resolve(args.path));
  }
  return false;
}

/**
 * Keep an in-project memory folder out of git, without touching the project's
 * own .gitignore: one line in the repository's private exclude file. True when
 * the line is there afterwards. A folder that is not a repository is left alone.
 */
function excludeFromGit(cwd) {
  let file;
  try {
    file = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return false; // not a git repository, or no git
  }
  if (!file) return false;
  file = path.resolve(cwd, file);
  try {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* no exclude file yet */ }
    if (text.split(/\r?\n/).some((line) => line.trim() === GIT_EXCLUDE_LINE)) return true;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${GIT_EXCLUDE_LINE}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

// To a name that is free. A rename is one step and leaves no half-written
// copy; it cannot cross to another drive, so there the file is copied.
function moveFile(source, target) {
  try {
    fs.renameSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
}

/**
 * Move a memory folder's files to another place (the user changed where
 * memory is kept). An entry that is already at the new place is not replaced:
 * the one that moves gets a number after its name, unless the two are the same
 * text. Returns how many files moved.
 */
function moveMemory(from, to) {
  // The same folder under two spellings (another letter case, a link, a
  // mapped drive) is one place: moving it onto itself would delete its index.
  if (!from || !to || samePath(realPath(from), realPath(to))) return 0;
  let names;
  try { names = fs.readdirSync(from).filter((file) => /\.md$/i.test(file)); } catch { return 0; }
  if (!names.length) return 0;
  fs.mkdirSync(to, { recursive: true });
  const isIndex = (file) => file.toLowerCase() === INDEX_FILE.toLowerCase();
  let moved = 0;
  for (const file of names) {
    const source = path.join(from, file);
    const target = path.join(to, file);
    try {
      if (!fs.statSync(source).isFile()) continue;
      if (isIndex(file) && fs.existsSync(target)) {
        // Two indexes: the old one's lines go after the new one's, so the
        // entries that move keep the descriptions the agent wrote for them.
        const lines = fs.readFileSync(source, 'utf8').split(/\r?\n/).filter((line) => ENTRY_LINE.test(line));
        if (lines.length) fs.appendFileSync(target, `\n${lines.join('\n')}\n`, 'utf8');
      } else if (fs.existsSync(target)) {
        // An entry of the same name is there already. Both are kept, unless
        // they say the same: nothing stays behind in the old place.
        if (!fs.readFileSync(source).equals(fs.readFileSync(target))) {
          const base = file.replace(/\.md$/i, '');
          let n = 2;
          while (fs.existsSync(path.join(to, `${base}-${n}.md`))) n += 1;
          moveFile(source, path.join(to, `${base}-${n}.md`));
          moved += 1;
          continue;
        }
      } else {
        moveFile(source, target);
        if (!isIndex(file)) moved += 1;
        continue;
      }
      fs.unlinkSync(source);
    } catch { /* left where it was */ }
  }
  // The old folder, and the .codingfleet folder around it, when they are empty now.
  try {
    fs.rmdirSync(from);
    if (path.basename(path.dirname(from)) === '.codingfleet') fs.rmdirSync(path.dirname(from));
  } catch { /* not empty */ }
  syncIndex(to);
  return moved;
}

module.exports = {
  INDEX_FILE,
  INDEX_MAX_CHARS,
  LOCATIONS,
  FOLDS_CASE,
  folderKey,
  memoryDir,
  entryFiles,
  listEntries,
  syncIndex,
  ensure,
  instructions,
  allows,
  excludeFromGit,
  moveMemory,
};
