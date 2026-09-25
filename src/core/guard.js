'use strict';
// Calls that must reach a person even when the agent may otherwise act alone.
//
// Two kinds, both decided from the call's own arguments:
//
// * Secrets: reading a file that usually holds credentials (.env, private
//   keys, cloud and registry credentials), or printing the environment. What
//   the agent reads goes to the model provider; a person should see that
//   happen. Asked even in auto mode; "allow for this session" is honoured.
//
// * Destructive commands: deleting recursively, rewriting git history,
//   wiping disks or databases, shutting the computer down, piping a download
//   into a shell. Asked every time — auto mode and "allow all commands" do
//   not cover them, because one wrong one cannot be taken back.
//
// These are guards against an agent's mistake or a poisoned repository, not
// a sandbox: a determined command can hide from any pattern. They are tuned
// to catch what an agent actually writes, without asking about every `ls`.

const SECRETS = 'reads secrets';
const DESTRUCTIVE = 'may delete or overwrite data';
const REMOTE_SCRIPT = 'runs a script from the internet';

// Never covered by auto mode or by "allow for this session".
const ALWAYS_ASK = new Set([DESTRUCTIVE, REMOTE_SCRIPT]);
// Not covered by auto mode, but "allow for this session" is fine.
const ASK_EVEN_IN_AUTO = new Set([SECRETS]);

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
  const p = String(target || '').replace(/\\/g, '/').replace(/^["']|["']$/g, '');
  if (!p) return false;
  const name = p.split('/').pop();
  if (HARMLESS_ENV.test(name) || /\.pub$/i.test(name)) return false;
  return SECRET_NAMES.some((re) => re.test(name)) || SECRET_PARTS.some((re) => re.test(p));
}

// The words of a command line, near enough: split on whitespace, quotes,
// redirections, pipes and separators.
function words(command) {
  return String(command || '').split(/[\s"'`|;&<>()=]+/).filter(Boolean);
}

// Printing the environment, where tokens and keys usually live.
const ENV_DUMP = [
  /(^|[;&|]\s*)(env|printenv|export\s+-p)\s*($|[;&|>])/i,
  /(^|[;&|]\s*)set\s*($|[;&|>])/i,
  /\b(get-childitem|gci|ls|dir)\s+env:/i,
  /\$env:[a-z_]*(token|key|secret|passw|pwd|credential)/i,
  /\$\{?[a-z_]*(token|key|secret|passw|pwd|credential)[a-z_]*\}?/i,
  /%[a-z_]*(token|key|secret|passw|pwd|credential)[a-z_]*%/i,
];

const DESTRUCTIVE_COMMANDS = [
  // Recursive or forced deletion.
  /(^|[;&|(]\s*|\bsudo\s+|\bxargs\s+)rm\s+(-[a-z]*[rf][a-z]*\s+|--(recursive|force)\s+)/i,
  /\b(rmdir|rd)\s+\/s\b/i,
  /\b(del|erase)\s+(\/[a-z]\s+)*\/[sq]\b/i,
  /\b(remove-item|ri)\b[^;&|]*\s-(recurse|r\b|force)/i,
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

/** Why a command must be asked about whatever the mode, or null. */
function commandRisk(command) {
  const text = String(command || '');
  if (DESTRUCTIVE_COMMANDS.some((re) => re.test(text))) return DESTRUCTIVE;
  if (REMOTE_SCRIPTS.some((re) => re.test(text))) return REMOTE_SCRIPT;
  if (ENV_DUMP.some((re) => re.test(text)) || words(text).some(isSecretPath)) return SECRETS;
  return null;
}

/**
 * The guard's reason for a call, or null when the ordinary rules decide.
 * Runs before them: a guarded reason replaces the ordinary one.
 */
function guardReason(name, args) {
  args = args || {};
  if (name === 'fs_read' || name === 'view_image') {
    return isSecretPath(name === 'fs_read' ? args.path : args.source) ? SECRETS : null;
  }
  if (name === 'run_command') return commandRisk(args.command);
  if (name === 'execute_code') {
    // The file it writes is the script it runs: look inside it for commands
    // that destroy or fetch-and-run. Not for secrets: a script that loads
    // .env is ordinary, and its values reach the model only if it prints them.
    const inScript = args.command ? commandRisk(args.code) : null;
    return commandRisk(args.command) || (inScript === SECRETS ? null : inScript);
  }
  return null;
}

/** Whether a reason may be skipped by auto mode or a session's "allow all". */
function mustAsk(reason, { auto, allowedThisSession }) {
  if (!reason) return false;
  if (ALWAYS_ASK.has(reason)) return true;
  if (allowedThisSession) return false;
  if (ASK_EVEN_IN_AUTO.has(reason)) return true;
  return !auto;
}

module.exports = {
  SECRETS, DESTRUCTIVE, REMOTE_SCRIPT, ALWAYS_ASK, ASK_EVEN_IN_AUTO,
  isSecretPath, commandRisk, guardReason, mustAsk,
};
