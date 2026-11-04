'use strict';
// Commands that only look: listing, reading and searching inside the project
// folder, and asking git what changed. They run without asking, like fs_read
// does, so a run does not stop at every `ls` and `grep`.
//
// A command line counts when every command in it is on the list below, every
// path it names stays inside the folder, and it does nothing else: no
// variables, substitutions, subshells, braces, background jobs, and no
// redirection except to /dev/null. Pipes and ; && || between listed commands
// are fine. Anything else waits for the user as before. The guard (guard.js)
// still decides first, so `cat .env` asks about secrets whatever this says.
//
// Written for bash and zsh (Git Bash on Windows). PowerShell quotes and
// expands differently, so there every command still asks.
const path = require('path');

// Read-only once their paths are checked and the arguments in DENIED are out.
const READERS = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find',
  'sort', 'uniq']);
// Print their arguments, or look a program up: nothing they name is opened.
const NO_PATHS = new Set(['echo', 'which']);
// The tools whose version an agent checks before it starts.
const VERSIONED = new Set(['node', 'npm', 'python', 'python3', 'git']);
const VERSION_FLAGS = new Set(['--version', '-v', '-V']);
// git subcommands that only read the repository.
const GIT_READS = new Set(['status', 'diff', 'log', 'show', 'blame', 'ls-files', 'rev-parse']);
// `git branch` lists with these; a name would create a branch.
const GIT_BRANCH_LIST = new Set(['-a', '-r', '-v', '-vv', '-l', '--all', '--remotes', '--verbose', '--list',
  '--show-current', '--merged', '--no-merged', '--no-color']);
// Arguments that make a listed command write, delete or run something.
const DENIED = {
  find: [/^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/],
  sort: [/^-[^-]*o/, /^--output/, /^--compress-program/],
  rg: [/^--pre(=|$)/, /^--hostname-bin/],
  git: [/^--output(=|$)/, /^--ext-diff$/],
};
// grep and rg read their first word as the pattern, unless one of these says
// where the pattern is.
const SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg']);
const PATTERN_OPTIONS = /^(-e|-f|--regexp|--file|--exclude-from|--ignore-file|--files)(=|$)/;

// Where a command line ends one command and starts the next.
const SEPARATORS = new Set([';', '\n', '|', '&&', '||']);
const WORD_END = /[\s;|&]/;

/**
 * The commands of a command line, each as its words with quotes removed, or
 * null when the line does more than run commands one after another.
 */
function commandsOf(line) {
  const s = String(line || '');
  const commands = [];
  let words = [];
  let word = null; // null between words
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  // An empty command is a blank line, or `ls |` with nothing after the pipe.
  const endCommand = (emptyIsFine) => {
    endWord();
    if (!words.length) return emptyIsFine;
    commands.push(words);
    words = [];
    return true;
  };
  // A redirection to /dev/null at `j`, or -1.
  const devNull = (j) => {
    while (s[j] === ' ' || s[j] === '\t') j++;
    return s.startsWith('/dev/null', j) && (j + 9 === s.length || WORD_END.test(s[j + 9])) ? j + 8 : -1;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); continue; }
    if (c === '\\') {
      if (i + 1 >= s.length) return null;
      i++;
      if (s[i] !== '\n') word = (word || '') + s[i];
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word || '') + s.slice(i + 1, end);
      i = end;
      continue;
    }
    if (c === '"') {
      let text = '';
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && '$`"\\\n'.includes(s[j + 1])) text += s[++j];
        else if (s[j] === '$' || s[j] === '`') return null;
        else text += s[j];
      }
      if (j >= s.length) return null;
      word = (word || '') + text;
      i = j;
      continue;
    }
    if (c === '#' && word === null) {
      // A comment, to the end of the line.
      while (i + 1 < s.length && s[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '>') {
      // 2>/dev/null, >/dev/null, 2>&1: output thrown away or merged, never a file.
      if (word !== null && word !== '1' && word !== '2') return null;
      word = null;
      if (s[i + 1] === '&' && '12'.includes(s[i + 2]) && (i + 3 === s.length || WORD_END.test(s[i + 3]))) {
        i += 2;
        continue;
      }
      const end = devNull(i + 1);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (c === '&' && s[i + 1] === '>') {
      if (word !== null) return null;
      const end = devNull(i + 2);
      if (end < 0) return null;
      i = end;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||' || SEPARATORS.has(c)) {
      if (two === '|&') return null;
      if (!endCommand(c === '\n')) return null;
      if (two === '&&' || two === '||') i++;
      continue;
    }
    // Variables, substitutions, subshells, input redirection, background jobs,
    // and braces, which bash expands into words nobody wrote.
    if ('$`<()&{}'.includes(c)) return null;
    word = (word || '') + c;
  }
  endCommand(true);
  return commands.length ? commands : null;
}

function inside(cwd, word) {
  // ~ is the home folder, wherever the folder is; bash expands it after = and : too.
  if (/(^|[=:])~/.test(word)) return false;
  // Git Bash writes C:\work as /c/work.
  const p = process.platform === 'win32' ? word.replace(/^\/([a-z])(?=\/|$)/i, '$1:') : word;
  const rel = path.relative(path.resolve(cwd), path.resolve(cwd, p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Whether every path among a command's arguments stays inside the folder.
// Any word may be a path, so all of them are checked: a pattern that looks
// like a path outside only means the command asks, as it did before.
function pathsInside(name, args, cwd) {
  const search = SEARCHES.has(name);
  let patternLeft = search && !args.some((w) => PATTERN_OPTIONS.test(w));
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (options && w === '--') { options = false; continue; }
    if (options && w.startsWith('--')) {
      const eq = w.indexOf('=');
      if (eq > 0 && !inside(cwd, w.slice(eq + 1))) return false;
      // The pattern after --regexp is not a path.
      if (search && w === '--regexp') i++;
      continue;
    }
    if (options && w.length > 1 && w.startsWith('-')) {
      // A value written onto a short option (-f/etc/x) cannot be told apart
      // from the flags, so one that names a path asks.
      if (/[/\\~]/.test(w)) return false;
      if (search && w === '-e') i++;
      continue;
    }
    if (patternLeft) { patternLeft = false; continue; }
    if (!inside(cwd, w)) return false;
  }
  return true;
}

function commandReads([name, ...args], cwd) {
  if (VERSIONED.has(name) && args.length === 1 && VERSION_FLAGS.has(args[0])) return true;
  if ((DENIED[name] || []).some((re) => args.some((w) => re.test(w)))) return false;
  if (NO_PATHS.has(name)) return true;
  if (name === 'cd') return args.length === 1 && args[0] !== '-' && inside(cwd, args[0]);
  // A second name after uniq's input is a file it writes.
  if (name === 'uniq' && args.filter((w) => !w.startsWith('-')).length > 1) return false;
  if (READERS.has(name)) return pathsInside(name, args, cwd);
  if (name !== 'git') return false;
  // --no-pager only; -C and -c pick another repository or set config that can run programs.
  const rest = args[0] === '--no-pager' ? args.slice(1) : args;
  const [sub, ...subArgs] = rest;
  if (sub === 'branch') return subArgs.every((w) => GIT_BRANCH_LIST.has(w) || /^--(format|sort)=/.test(w));
  if (sub === 'remote') return subArgs.every((w) => w === '-v' || w === '--verbose');
  return GIT_READS.has(sub) && pathsInside(sub, subArgs, cwd);
}

/** Whether a command line only reads inside `cwd`, so it may run without asking. */
function readOnlyCommand(command, cwd) {
  if (!cwd) return false;
  const commands = commandsOf(command);
  return Boolean(commands) && commands.every((words) => commandReads(words, cwd));
}

module.exports = { readOnlyCommand, commandsOf };
