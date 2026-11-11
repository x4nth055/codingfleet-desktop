'use strict';
// Calls that must reach a person even when the agent may otherwise act alone.
//
// Two kinds, both decided from the call's own arguments (and, for a forced
// delete, the project folder):
//
// * Secrets: reading a file that usually holds credentials (.env, private
//   keys, cloud and registry credentials), or printing the environment. What
//   the agent reads goes to the model provider; a person should see that
//   happen. Asked even in auto mode; "allow for this session" is honoured.
//
// * Destructive commands: deleting recursively, rewriting git history,
//   wiping disks or databases, shutting the computer down, piping a download
//   into a shell. Asked every time — auto mode and "allow all commands" do
//   not cover them, because one wrong one cannot be taken back. Not counted:
//   deleting files (not folders) that are not plainly outside the folder, and
//   deleting folders that are made again, such as node_modules.
//
// These are guards against an agent's mistake or a poisoned repository, not
// a sandbox: a determined command can hide from any pattern. They are tuned
// to catch what an agent actually writes, without asking about every `ls`.

const SECRETS = 'reads secrets';
const DESTRUCTIVE = 'may delete or overwrite data';
const REMOTE_SCRIPT = 'runs a script from the internet';
// The computer tool: the mouse, the keyboard, and what any app shows. Auto
// mode is about the project folder; this reaches every window on the screen,
// so a person says yes once per session.
const COMPUTER = 'controls your computer';

// Never covered by auto mode or by "allow for this session".
const ALWAYS_ASK = new Set([DESTRUCTIVE, REMOTE_SCRIPT]);
// The browser typing into a site that is not on this computer: "types into
// example.com" (main/browser.js). A form there can send what is typed anywhere.
const BROWSER_TYPES = /^types into /;
// A coding CLI the user set to "Ask each time" (Settings > Coding agents):
// "starts Codex on this computer" (main/coding-agents.js).
const STARTS_CLI = /^starts .+ on this computer$/;
const alwaysAsk = (reason) => ALWAYS_ASK.has(reason) || BROWSER_TYPES.test(String(reason || ''))
  || STARTS_CLI.test(String(reason || ''));
// Not covered by auto mode, but "allow for this session" is fine.
const ASK_EVEN_IN_AUTO = new Set([SECRETS, COMPUTER]);

// Templates are meant to be read and shared.
const HARMLESS_ENV = /^\.env\.(example|sample|template|dist|defaults?)$/i;
const SECRET_NAMES = [
  /^\.env$/i, /^\.env\..+$/i, /^\.envrc$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^\.(npmrc|pypirc|netrc|pgpass|htpasswd|git-credentials|dockercfg)$/i, /^_netrc$/i,
  /^(credentials|secrets?)\.(json|ya?ml|toml|ini)$/i,
  /^service[-_]?account.*\.json$/i, /^client_secret.*\.json$/i,
  /\.tfvars$/i, /^terraform\.tfstate(\.backup)?$/i,
];
const SECRET_PARTS = [
  /(^|\/)\.aws\/(credentials|config)$/i, /(^|\/)\.ssh\//i, /(^|\/)\.gnupg\//i,
  /(^|\/)\.docker\/config\.json$/i, /(^|\/)\.kube\/config$/i, /(^|\/)\.azure\//i,
  /(^|\/)gcloud\/.*credentials/i,
];

/** Whether a path names a file that usually holds credentials. */
function isSecretPath(target) {
  const p = String(target || '').replace(/\\/g, '/').replace(/^["']|["']$/g, '')
    // Windows opens `.env::$DATA` (the file's own stream) as `.env`: what
    // follows a colon in the last part is a stream's name, not the file's.
    .replace(/(?<!^[a-z]):[^/]*$/i, '');
  if (!p) return false;
  const name = p.split('/').pop().replace(/^[a-z]:/i, '');
  if (HARMLESS_ENV.test(name) || /\.pub$/i.test(name)) return false;
  return SECRET_NAMES.some((re) => re.test(name)) || SECRET_PARTS.some((re) => re.test(p));
}

// The words of a command line, near enough: split on whitespace, quotes,
// redirections, pipes and separators.
function words(command) {
  return String(command || '').split(/[\s"'`|;&<>()=]+/).filter(Boolean);
}

// Printing the environment, where tokens and keys usually live. "pwd" is
// there for names like DB_PWD; $PWD and $OLDPWD (and PowerShell's $pwd) are
// the working folder, not a password (Nov 2026: 14% of the asks auto mode
// could not skip were only a $PWD).
// A command line can have several lines: ^ and $ are each line's (the m flag).
const ENV_DUMP = [
  /(^\s*|[;&|]\s*)(env|printenv|export\s+-p)\s*($|[;&|>])/im,
  /(^\s*|[;&|]\s*)set\s*($|[;&|>])/im,
  // One variable by name, when the name says it is a secret.
  /\bprintenv\s+(?!(old)?pwd\b)\S*(token|key|secret|passw|pwd|credential)/i,
  /\b(get-childitem|gci|ls|dir)\s+env:/i,
  /\$env:(?!(old)?pwd\b)[a-z_]*(token|key|secret|passw|pwd|credential)/i,
  // Written as an environment variable is: in capitals. `$key` and `$token`
  // are a loop's or a script's own variables, and asked about nothing.
  /\$\{?(?!(OLD)?PWD\b)[A-Z0-9_]*(TOKEN|KEY|SECRET|PASSW|PWD|CREDENTIAL)[A-Z0-9_]*\}?/,
  /%[a-z_]*(token|key|secret|passw|pwd|credential)[a-z_]*%/i,
  // The GitHub CLI prints the token it keeps when asked.
  /\bgh\s+auth\s+token\b/i,
  /\bgh\s+auth\s+status\b[^;&|]*\s(-t|--show-token)\b/i,
];

const DESTRUCTIVE_COMMANDS = [
  // Recursive or forced deletion. A forced delete of files inside the folder
  // is let through by onlyDeletesFiles below.
  // rm wherever a command can start: a line of its own (the m flag), after a
  // separator, or after a word that runs what follows (then, do, sudo, xargs -0).
  // The option may come after other words: `rm -v -rf x`, `rm x -rf`.
  /(^\s*|[;&|({]\s*|\b(?:sudo|xargs|then|do|else|time|command|exec|nohup)\s+(?:-\S+\s+)*)rm\s+(?:[^;&|\n]*?\s)?(-[a-z]*[rf][a-z]*|--(recursive|force))(\s|$)/im,
  /\b(rmdir|rd)\s+\/s\b/i,
  /\b(del|erase)\s+(\/[a-z]\s+)*\/[sq]\b/i,
  // Remove-Item under each name PowerShell gives it, and its parameters as
  // far as PowerShell lets them be shortened (-Rec, -Fo).
  /\b(remove-item|ri|del|erase|rd|rmdir)\b[^;&|\n]*\s-(r(e(c(u(r(se?)?)?)?)?)?|fo(r(ce?)?)?)\b/i,
  /\bfind\b[^;&|]*\s-(delete|exec\s+rm)\b/i,
  // Git history and uncommitted work.
  /\bgit\s+push\b[^;&|]*(\s--force(-with-lease)?\b|\s-f\b|\s--mirror\b|\s--delete\b|\s:[\w./-]+)/i,
  /\bgit\s+reset\b[^;&|]*--hard\b/i,
  /\bgit\s+clean\b[^;&|]*\s-[a-z]*f/i,
  /\bgit\s+(checkout|restore)\b[^;&|]*\s(--\s+)?\.(\s|$)/i,
  /\bgit\s+branch\b[^;&|]*\s-D\b/,
  /\bgit\s+stash\s+(drop|clear)\b/i,
  /\bgit\s+(filter-branch|filter-repo)\b/i,
  /\bgit\s+reflog\s+expire\b/i,
  // Disks, partitions, the machine itself.
  /(^|[;&|]\s*)format\s+[a-z]:/i, /\bmkfs(\.\w+)?\b/i, /\bdd\b[^;&|]*\bof=/i,
  /\b(diskpart|fdisk|parted|wipefs)\b/i, /\b(format-volume|clear-disk|remove-partition|initialize-disk)\b/i,
  /(^|[;&|]\s*|\bsudo\s+)(shutdown|reboot|halt|poweroff)\b/i, /\b(stop-computer|restart-computer)\b/i,
  // Databases.
  /\bdrop\s+(database|schema|table)\b/i, /\btruncate\s+table\b/i, /\bflushall\b|\bflushdb\b/i, /\bdropdb\b/i,
  // Permissions on a whole tree.
  /\bchmod\s+(-R\s+)?777\s+-R\b|\bchmod\s+-R\s+777\b/i,
];

const REMOTE_SCRIPTS = [
  /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i,
  /\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|;&]*\|\s*(iex|invoke-expression)\b/i,
  /\biex\s*\(\s*(new-object\s+net\.webclient|iwr|irm|invoke-webrequest|invoke-restmethod)/i,
];

const destructive = (text) => DESTRUCTIVE_COMMANDS.some((re) => re.test(text));

// Folders a build, an install or a test run makes again: deleting one is
// cleanup, not loss. Not `dist`, `build`, `out` or `tmp`: in some projects
// those hold work.
const REGENERABLE = new Set(['node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache',
  '.next', '.nuxt', '.turbo', '.parcel-cache', '.vite', '.nyc_output', '.tox', 'coverage']);

/** Whether a path names a folder that is made again when it is needed. */
function isRegenerable(target) {
  const name = String(target || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().toLowerCase();
  return REGENERABLE.has(name) || name.endsWith('.egg-info');
}

// ── Deletes on a line that cannot be read word by word ─────────────────────
// A script, or a line with variables or loops (`for f in *.log; do rm -f "$f";
// done`): read-only.js cannot say where its files are. Such a delete is still
// an ordinary change when it takes files, not folders, and names nothing that
// is plainly somewhere else. People choose auto mode to be left alone, and
// agents clean up after themselves on nearly every run.

// A delete, where a command can start. Not after sudo or xargs: those stay asked.
const DELETE = /(^\s*|[;&|({]\s*|\b(?:then|do|else|time|command|exec|nohup)\s+)(rm|remove-item|ri|del|erase)\b(?![-\w])([^;&|\n]*)/gim;
// A move to another folder, which changes what a relative path means.
const MOVE = /(^\s*|[;&|({]\s*|\b(?:then|do|else)\s+)(cd|pushd|chdir|set-location|sl|push-location|popd|pop-location)\b(?![-\w])([^;&|\n]*)/gim;
const PS_FORCE = /^-fo(r(c(e)?)?)?$/i;
const PS_RECURSE = /^-r(e(c(u(r(se?)?)?)?)?)?$/i;
// Options that change nothing about what is deleted.
const HARMLESS_OPTION = /^(-[fv]+|--force|--verbose|-verbose|-(ea|erroraction|path|literalpath|lp|pspath))$/i;
const PATH_OPTION = /^-(path|literalpath|lp|pspath)$/i;
// Output thrown away: `2>/dev/null`, `>$null`, `2>&1`.
const THROWN_AWAY = /\s*[\d*]?>+\s*(&\d|\/dev\/null|\$null)/gi;
// A path that is plainly not under the folder: the home folder, an absolute
// path, a drive (C:, env:, HKCU:), `..`, or a variable that names the user's
// or the system's folders.
const ELSEWHERE = new RegExp([
  '^(~|[\\\\/]|[a-z]+:)',
  '(^|[\\\\/])\\.\\.([\\\\/]|$)',
  '\\$\\{?(HOME|USERPROFILE)\\b',
  '\\$env:(HOME|USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA|WINDIR|SYSTEMROOT|PROGRAMFILES|PROGRAMDATA)',
  '%\\w+%',
].join('|'), 'i');

const wordsOf = (args) => args.replace(THROWN_AWAY, ' ').split(/[\s,]+/).filter(Boolean)
  .map((w) => w.replace(/^["']+|["']+$/g, ''));

// Whether a delete's arguments make it an ordinary change: files, or folders
// that are made again, none of them a secret or plainly somewhere else.
function ordinaryDelete(args) {
  let options = true;
  let recursive = false;
  let regenerable = true;
  let targets = 0;
  const target = (w) => {
    if (!w || ELSEWHERE.test(w) || isSecretPath(w)) return false;
    targets++;
    if (!isRegenerable(w)) regenerable = false;
    return true;
  };
  for (const w of wordsOf(args)) {
    if (options && w === '--') { options = false; continue; }
    if (options && w.length > 1 && w.startsWith('-')) {
      const colon = w.indexOf(':');
      const name = colon > 0 ? w.slice(0, colon) : w;
      if (PS_RECURSE.test(name) || /^--(recursive|dir)$/.test(name)) recursive = true;
      else if (PS_FORCE.test(name) || HARMLESS_OPTION.test(name)) { /* nothing more is deleted */ }
      // bash: -rf, -fR, -d. Any other letter is an option this does not know.
      else if (/^-[a-z]+$/i.test(name) && /^-[frRvd]+$/.test(name)) recursive = true;
      else return false;
      // -Path:build\a.txt names a file; -EA:SilentlyContinue does not.
      if (colon > 0 && PATH_OPTION.test(name) && !target(w.slice(colon + 1))) return false;
      continue;
    }
    if (!target(w)) return false;
  }
  return targets > 0 && (!recursive || regenerable);
}

// Whether every move on the text stays under the folder as far as can be seen.
function staysPut(text) {
  for (const [, , name, args] of text.matchAll(MOVE)) {
    if (/^pop/i.test(name)) return false;
    const targets = wordsOf(args);
    // `cd` alone is the home folder; `cd -` is wherever the shell was before.
    if (targets.length !== 1 || targets[0] === '-' || ELSEWHERE.test(targets[0])) return false;
  }
  return true;
}

function deletesAreOrdinary(text) {
  if (!staysPut(text)) return false;
  const rest = text.replace(DELETE, (whole, start, _name, args) => (ordinaryDelete(args) ? `${start}true` : whole));
  return rest !== text && !destructive(rest);
}

// Whether a line that looks destructive only makes ordinary deletes: files
// inside the folder (`rm -f tmp/check.py`, `Remove-Item -Force a.log`) and
// folders that are made again (`rm -rf node_modules`). With the folder and a
// line that can be read, read-only.js places every path and takes those
// deletes out, and the rest is tested again. Otherwise (a script, a line with
// variables) the deletes are judged by what they plainly say.
function onlyDeletesFiles(text, { cwd, shell } = {}) {
  // Here, not at the top: read-only.js requires this module.
  const readOnly = require('./read-only');
  if (cwd && readOnly.commandsOf(text, shell)) {
    const rest = readOnly.withoutFileDeletes(text, cwd, shell);
    return Boolean(rest) && !rest.some((words) => destructive(words.join(' ')));
  }
  return deletesAreOrdinary(text);
}

/**
 * Why a command must be asked about whatever the mode, or null. `where`
 * ({ cwd, shell }, the shell as read-only.js names it) lets deletes of files
 * inside the folder through.
 */
function commandRisk(command, where) {
  const text = String(command || '');
  if (destructive(text) && !onlyDeletesFiles(text, where)) return DESTRUCTIVE;
  if (REMOTE_SCRIPTS.some((re) => re.test(text))) return REMOTE_SCRIPT;
  if (ENV_DUMP.some((re) => re.test(text)) || words(text).some(isSecretPath)) return SECRETS;
  return null;
}

/**
 * The guard's reason for a call, or null when the ordinary rules decide.
 * Runs before them: a guarded reason replaces the ordinary one. `where` as in
 * commandRisk.
 */
function guardReason(name, args, where) {
  args = args || {};
  if (name === 'computer') return COMPUTER;
  if (name === 'fs_read' || name === 'view_image') {
    return isSecretPath(name === 'fs_read' ? args.path : args.source) ? SECRETS : null;
  }
  if (name === 'run_command') return commandRisk(args.command, where);
  if (name === 'execute_code') {
    // The file it writes is the script it runs: look inside it for commands
    // that destroy or fetch-and-run. Not for secrets: a script that loads
    // .env is ordinary, and its values reach the model only if it prints them.
    // The script may run in another folder than the command line starts in,
    // so its deletes are judged without one.
    const inScript = args.command ? commandRisk(args.code) : null;
    return commandRisk(args.command, where) || (inScript === SECRETS ? null : inScript);
  }
  return null;
}

/** Whether a reason may be skipped by auto mode or a session's "allow all". */
function mustAsk(reason, { auto, allowedThisSession }) {
  if (!reason) return false;
  if (alwaysAsk(reason)) return true;
  if (allowedThisSession) return false;
  if (ASK_EVEN_IN_AUTO.has(reason)) return true;
  return !auto;
}

module.exports = {
  SECRETS, DESTRUCTIVE, REMOTE_SCRIPT, COMPUTER, ALWAYS_ASK, ASK_EVEN_IN_AUTO,
  isSecretPath, isRegenerable, commandRisk, guardReason, mustAsk, alwaysAsk,
};
