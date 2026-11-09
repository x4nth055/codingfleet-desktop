'use strict';
// Commands that only look: listing, reading and searching inside the project
// folder, and asking git what changed. They run without asking, like fs_read
// does, so a run does not stop at every `ls` and `grep`.
//
// A command line counts when every command in it is on the lists below, every
// path it names stays inside the folder, and it does nothing else: no
// variables, substitutions, subshells, braces, background jobs, and no
// redirection except to /dev/null ($null in PowerShell). Pipes and ; between
// listed commands are fine, and && || in bash. Anything else waits for the user
// as before. The guard (guard.js) still decides first, so `cat .env` asks
// about secrets whatever this says, and so does a word the shell turns into a
// secret's name: `cat .en""v`, or a wildcard such as `cat .env*`.
//
// Each shell reads a command line its own way, so each has its own reader here:
// bash and zsh (Git Bash on Windows), and Windows PowerShell 5.1, which the app
// uses on Windows when Git for Windows is not installed.
const path = require('path');
const { isSecretPath } = require('./guard');

// ── bash ──────────────────────────────────────────────────────────────────
// Read-only once their paths are checked and the arguments in DENIED are out.
const READERS = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'find',
  'sort', 'uniq']);
// Of those, the ones that print what is in the files they name.
const CONTENT = new Set(['cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'sort', 'uniq']);
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

// ── PowerShell ────────────────────────────────────────────────────────────
// Names are read whatever their case, as PowerShell does. The aliases are
// those of Windows PowerShell 5.1, where `ls`, `cat` and `sort` are cmdlets.
// Cmdlets that print what is in the files they name.
const PS_READERS = new Set(['get-content', 'gc', 'cat', 'type', 'select-string', 'sls']);
// Cmdlets that list or test the paths they name without opening them.
const PS_LISTERS = new Set(['get-childitem', 'gci', 'ls', 'dir', 'get-item', 'gi', 'test-path', 'resolve-path', 'rvpa']);
// Cmdlets that only shape or print what comes down the pipe: their words are
// property names or text, never paths. (Not ForEach-Object: `% Delete` calls
// each file's Delete method.)
const PS_NO_PATHS = new Set(['write-output', 'echo', 'write', 'write-host', 'sort-object', 'sort', 'select-object',
  'select', 'measure-object', 'measure', 'group-object', 'group', 'where-object', 'where', 'format-table', 'ft',
  'format-list', 'fl', 'format-wide', 'fw', 'out-string', 'out-null']);
const PS_PWD = new Set(['get-location', 'gl', 'pwd']);
const PS_CD = new Set(['set-location', 'sl', 'cd', 'chdir']);
// Programs, which take their words as PowerShell hands them over.
const PS_PROGRAMS = new Set(['git', 'rg']);
// Select-String's pattern, named: -Pattern, or as much of it as is not also
// the start of -Path.
const PS_PATTERN = /^-patt(e(r(n)?)?)?$/i;
// PowerShell reads curly quotes as quotes, long dashes as -, and odd spaces as
// spaces. Only plain ASCII, and the letters and digits of any script, are read.
const PS_ODD_CHARACTER = /[^\t\n\r\x20-\x7e\p{L}\p{N}\p{M}]/u;
const PS_WORD_END = /[\s;|,]/;

// ── Secrets ───────────────────────────────────────────────────────────────
// Names guard.js knows hold credentials, to test a wildcard against: a reader
// given `.env*` or `*.pem` opens them as surely as if they were named.
const SECRET_SAMPLES = ['.env', '.env.local', '.envrc', 'id_rsa', 'id_ed25519', 'server.pem', 'server.key',
  'cert.p12', 'cert.pfx', 'release.jks', 'release.keystore', 'vault.kdbx', 'putty.ppk', 'key.asc', 'key.gpg',
  '.npmrc', '.pypirc', '.netrc', '_netrc', '.pgpass', '.htpasswd', '.git-credentials', '.dockercfg',
  'credentials.json', 'secrets.yaml', 'secret.toml', 'service-account.json', 'client_secret.json',
  'prod.tfvars', 'terraform.tfstate'];

// A word naming a secret, on its own or after = or : (`--file=.env`, `HEAD:.env`).
function secretWord(word) {
  return [word, word.slice(word.lastIndexOf('=') + 1), word.slice(word.lastIndexOf(':') + 1)].some(isSecretPath);
}

// A wildcard whose file name could match a secret's. One in a folder's name
// only (`*/id_rsa`) leaves the file named, which secretWord sees.
function wildcardMatchesSecret(word) {
  const name = word.replace(/\\/g, '/').split('/').pop();
  if (!/[*?[]/.test(name)) return false;
  let re = '';
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    const end = c === '[' ? name.indexOf(']', i + 1) : -1;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (end > 0) { re += '.'; i = end; }
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const pattern = new RegExp(`^${re}$`, 'i');
  return SECRET_SAMPLES.some((sample) => pattern.test(sample));
}

// ── Reading a command line ────────────────────────────────────────────────
/**
 * The commands of a bash command line, each as its words with quotes removed,
 * or null when the line does more than run commands one after another.
 */
function bashCommandsOf(line) {
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

/**
 * The commands of a Windows PowerShell command line, as bashCommandsOf does
 * for bash. PowerShell has no escape in single quotes ('' is one quote), and
 * its escape character is the backtick, which is refused with everything else
 * that runs or expands: $ variables and $(…), @ arrays and splatting, ( ) { }
 * [ ], & (the call operator), < and --% (stop parsing). A quoted command name
 * is a string, not a command, and is refused too.
 */
function psCommandsOf(line) {
  const s = String(line || '');
  if (PS_ODD_CHARACTER.test(s)) return null;
  const commands = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = (emptyIsFine) => {
    endWord();
    if (!words.length) return emptyIsFine;
    commands.push(words);
    words = [];
    return true;
  };
  // A redirection to $null at `j`: the index of its last character, or -1.
  const toNull = (j) => {
    while (s[j] === ' ' || s[j] === '\t') j++;
    return /^\$null$/i.test(s.slice(j, j + 5)) && (j + 5 === s.length || PS_WORD_END.test(s[j + 5])) ? j + 4 : -1;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    // A comma makes an array of the words around it: each is still a word.
    if (c === ' ' || c === '\t' || c === '\r' || c === ',') { endWord(); continue; }
    if (c === "'" || c === '"') {
      if (!words.length) return null;
      let text = '';
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === c) {
          if (s[j + 1] !== c) break;
          j++;
        } else if (c === '"' && (s[j] === '$' || s[j] === '`')) {
          return null;
        }
        text += s[j];
      }
      if (j >= s.length) return null;
      word = (word || '') + text;
      i = j;
      continue;
    }
    if (c === '#' && word === null) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++;
      continue;
    }
    if (c === '>') {
      // >$null, 2>$null, *>$null, 2>&1: output thrown away or merged, never a file.
      if (word !== null && !/^[1-6*]$/.test(word)) return null;
      word = null;
      if (s[i + 1] === '&' && s[i + 2] === '1' && (i + 3 === s.length || PS_WORD_END.test(s[i + 3]))) {
        i += 2;
        continue;
      }
      const end = toNull(i + 1);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (c === ';' || c === '\n' || c === '|') {
      // Windows PowerShell has no ||.
      if (c === '|' && s[i + 1] === '|') return null;
      if (!endCommand(c === '\n')) return null;
      continue;
    }
    if ('$`()[]{}<&'.includes(c) || (c === '@' && word === null)) return null;
    word = (word || '') + c;
  }
  endCommand(true);
  if (commands.some((words) => words.includes('--%'))) return null;
  return commands.length ? commands : null;
}

/** The commands of a command line as `shell` ('bash' or 'powershell') reads it, or null. */
function commandsOf(line, shell = 'bash') {
  return shell === 'powershell' ? psCommandsOf(line) : bashCommandsOf(line);
}

// ── Paths ─────────────────────────────────────────────────────────────────
// Whether a path stays inside the folder. PowerShell paths are Windows paths
// (the app uses it on Windows only); Git Bash writes C:\work as /c/work.
function inside(cwd, word, shell = 'bash') {
  // ~ is the home folder, wherever the folder is; bash expands it after = and : too.
  if (/(^|[=:])~/.test(word)) return false;
  const paths = shell === 'powershell' ? path.win32 : path;
  const p = shell !== 'powershell' && process.platform === 'win32'
    ? word.replace(/^\/([a-z])(?=\/|$)/i, '$1:') : word;
  const rel = paths.relative(paths.resolve(cwd), paths.resolve(cwd, p));
  return rel === '' || (!rel.startsWith('..') && !paths.isAbsolute(rel));
}

// A path a command opens or lists: inside the folder, no secret's name, and,
// for a command that prints what is in it, no wildcard that could match one.
function safePath(cwd, word, shell, reads) {
  return inside(cwd, word, shell) && !secretWord(word) && !(reads && wildcardMatchesSecret(word));
}

// Whether every path among a command's arguments stays inside the folder.
// Any word may be a path, so all of them are checked: a pattern that looks
// like a path outside only means the command asks, as it did before.
function pathsInside(name, args, cwd, shell = 'bash') {
  const search = SEARCHES.has(name);
  const reads = CONTENT.has(name);
  let patternLeft = search && !args.some((w) => PATTERN_OPTIONS.test(w));
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (options && w === '--') { options = false; continue; }
    if (options && w.startsWith('--')) {
      const eq = w.indexOf('=');
      if (eq > 0 && !safePath(cwd, w.slice(eq + 1), shell, reads)) return false;
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
    if (!safePath(cwd, w, shell, reads)) return false;
  }
  return true;
}

// A path a cmdlet is given. Only a disk: no env:, HKLM: or cert: drive, no
// FileSystem::\\server path and no file:stream, so the only colon allowed is
// a drive letter's.
function psPathInside(cwd, word, reads) {
  const colon = word.indexOf(':');
  if (colon >= 0 && !(colon === 1 && /^[a-z]$/i.test(word[0]))) return false;
  return safePath(cwd, word, 'powershell', reads);
}

// The paths a cmdlet is given, by position or by name (-Path x, -Path:x).
// Select-String's first word is its pattern unless -Pattern names it; any
// other word that may be a path is checked, as in bash. `reads`: the files
// named are opened, by this cmdlet or by a reader further down the pipe
// (`Get-ChildItem -Filter .env* | Get-Content` reads .env).
function psPathsInside(name, args, cwd, reads) {
  const search = name === 'select-string' || name === 'sls';
  const named = search && args.some((w) => PS_PATTERN.test(w.split(':')[0]));
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w.length > 1 && w.startsWith('-')) {
      const colon = w.indexOf(':');
      const value = colon > 0 ? w.slice(colon + 1) : null;
      if (search && PS_PATTERN.test(colon > 0 ? w.slice(0, colon) : w)) {
        if (value === null) i++;
        continue;
      }
      if (value && !psPathInside(cwd, value, reads)) return false;
      continue;
    }
    if (search && !named && i === 0) continue;
    if (!psPathInside(cwd, w, reads)) return false;
  }
  return true;
}

// ── Commands ──────────────────────────────────────────────────────────────
// git and rg read their words the same way whichever shell hands them over.
function programReads(name, args, cwd, shell) {
  if ((DENIED[name] || []).some((re) => args.some((w) => re.test(w)))) return false;
  if (name === 'rg') return pathsInside(name, args, cwd, shell);
  // --no-pager only; -C and -c pick another repository or set config that can run programs.
  const rest = args[0] === '--no-pager' ? args.slice(1) : args;
  const [sub, ...subArgs] = rest;
  if (sub === 'branch') return subArgs.every((w) => GIT_BRANCH_LIST.has(w) || /^--(format|sort)=/.test(w));
  if (sub === 'remote') return subArgs.every((w) => w === '-v' || w === '--verbose');
  return GIT_READS.has(sub) && pathsInside(sub, subArgs, cwd, shell);
}

function commandReads([name, ...args], cwd) {
  if (VERSIONED.has(name) && args.length === 1 && VERSION_FLAGS.has(args[0])) return true;
  if ((DENIED[name] || []).some((re) => args.some((w) => re.test(w)))) return false;
  if (NO_PATHS.has(name)) return true;
  if (name === 'cd') return args.length === 1 && args[0] !== '-' && inside(cwd, args[0]);
  // A second name after uniq's input is a file it writes.
  if (name === 'uniq' && args.filter((w) => !w.startsWith('-')).length > 1) return false;
  if (READERS.has(name)) return pathsInside(name, args, cwd);
  if (name === 'git') return programReads(name, args, cwd, 'bash');
  return false;
}

// `opens`: a reader is somewhere on the line, so what a lister finds may be
// piped to it and opened. Text piped to Get-Content is not opened; files are.
function psCommandReads([word, ...args], cwd, opens) {
  const name = word.toLowerCase();
  if (VERSIONED.has(name) && args.length === 1 && VERSION_FLAGS.has(args[0])) return true;
  if (PS_NO_PATHS.has(name)) return true;
  if (PS_PWD.has(name)) return args.length === 0;
  if (PS_CD.has(name)) return args.length === 1 && !args[0].startsWith('-') && psPathInside(cwd, args[0], false);
  if (PS_READERS.has(name)) return psPathsInside(name, args, cwd, true);
  if (PS_LISTERS.has(name)) return psPathsInside(name, args, cwd, opens);
  if (PS_PROGRAMS.has(name)) return programReads(name, args, cwd, 'powershell');
  return false;
}

/**
 * Whether a command line only reads inside `cwd`, so it may run without
 * asking. `shell` is how it will be run: 'bash' (bash, zsh, Git Bash) or
 * 'powershell' (Windows PowerShell).
 */
function readOnlyCommand(command, cwd, shell = 'bash') {
  if (!cwd) return false;
  const commands = commandsOf(command, shell);
  if (!commands) return false;
  if (shell !== 'powershell') return commands.every((words) => commandReads(words, cwd));
  const opens = commands.some(([name]) => PS_READERS.has(name.toLowerCase()));
  return commands.every((words) => psCommandReads(words, cwd, opens));
}

/**
 * Whether the shell would hand a command a secret's name that guard.js, which
 * splits a line on quotes and the like, does not see: `cat .en""v` is
 * `cat .env`. False when the line cannot be read here at all.
 */
function namesSecret(command, shell = 'bash') {
  const commands = commandsOf(command, shell);
  return Boolean(commands) && commands.some((words) => words.some(secretWord));
}

// ── Deleting files ────────────────────────────────────────────────────────
// rm without -r, and Remove-Item without -Recurse, delete files, never a
// folder with what is in it. Inside the project folder that is an ordinary
// change, as `rm a.txt` already is: guard.js does not count it as destructive,
// so auto mode runs it. Agents write `rm -f tmp/check.py` to clean up after
// themselves; asking about every one stopped unattended runs (Nov 2026: 38% of
// the asks auto mode could not skip, and people said yes to 472 of 474 asks).

// bash: -f and -v only. -r, -R, -d and any other option leave the command to
// the guard.
const RM_OPTIONS = /^(-[fv]+|--force|--verbose)$/;
// Remove-Item and the names Windows PowerShell 5.1 gives it.
const PS_DELETES = new Set(['remove-item', 'ri', 'rm', 'del', 'erase']);
const PS_FORCE = /^-fo(r(c(e)?)?)?$/i;
const PS_VERBOSE = /^-verbose$/i;
// Parameters whose value is the next word (or comes after a colon).
const PS_ERROR_ACTION = /^-(ea|erroraction)$/i;
const PS_PATH = /^-(path|literalpath|lp|pspath)$/i;
// Commands that move the shell to another folder for the rest of the line.
const CHANGES_FOLDER = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
const RETURNS_FOLDER = new Set(['popd', 'pop-location']);

// A path that stays inside the folder from wherever the line has moved to:
// the folders a line moves to are such paths themselves, so a relative path
// without `..` cannot leave. (A `cd` in a pipe runs on its own, so which
// folder the next command is in cannot always be known.)
// PowerShell paths also go through psPathInside: a disk only, never env: or
// HKCU:.
function insideFromAnywhere(cwd, word, shell) {
  if (shell === 'powershell' && !psPathInside(cwd, word, false)) return false;
  const parts = word.split(shell === 'powershell' ? /[\\/]/ : /\//);
  return !parts.includes('..') && safePath(cwd, word, shell, false);
}

function bashFileDelete(args, cwd) {
  let options = true;
  let files = 0;
  for (const w of args) {
    if (options && w === '--') { options = false; continue; }
    if (options && w.startsWith('-') && w.length > 1) {
      if (!RM_OPTIONS.test(w)) return false;
      continue;
    }
    if (!insideFromAnywhere(cwd, w, 'bash')) return false;
    files++;
  }
  return files > 0;
}

function psFileDelete(args, cwd) {
  let files = 0;
  const file = (w) => {
    files++;
    return insideFromAnywhere(cwd, w, 'powershell');
  };
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (!(w.length > 1 && w.startsWith('-'))) {
      if (!file(w)) return false;
      continue;
    }
    const colon = w.indexOf(':');
    const param = colon > 0 ? w.slice(0, colon) : w;
    const value = colon > 0 ? w.slice(colon + 1) : null;
    if (PS_FORCE.test(param) || PS_VERBOSE.test(param)) {
      if (value !== null) return false;
    } else if (PS_ERROR_ACTION.test(param)) {
      if (value === null) i++;
    } else if (PS_PATH.test(param)) {
      const target = value === null ? args[++i] : value;
      if (target === undefined || !file(target)) return false;
    } else {
      return false;
    }
  }
  return files > 0;
}

/**
 * The commands of a line other than its deletes of files inside `cwd`, each
 * as its words; or null when the line cannot be read here, or moves to a
 * folder that may be outside. guard.js tests what is left for anything
 * destructive.
 */
function withoutFileDeletes(command, cwd, shell = 'bash') {
  if (!cwd) return null;
  const commands = commandsOf(command, shell);
  if (!commands) return null;
  const ps = shell === 'powershell';
  const rest = [];
  for (const words of commands) {
    const name = ps ? words[0].toLowerCase() : words[0];
    if (RETURNS_FOLDER.has(name)) return null;
    if (CHANGES_FOLDER.has(name)) {
      if (words.length !== 2 || words[1].startsWith('-') || !insideFromAnywhere(cwd, words[1], shell)) return null;
      continue;
    }
    const deletesFiles = ps
      ? PS_DELETES.has(name) && psFileDelete(words.slice(1), cwd)
      : name === 'rm' && bashFileDelete(words.slice(1), cwd);
    if (!deletesFiles) rest.push(words);
  }
  return rest;
}

module.exports = { readOnlyCommand, commandsOf, namesSecret, withoutFileDeletes };
