'use strict';
// What a run tells CodingFleet about the app it comes from (client_meta): the
// settings it runs with and which features are on, such as Ask or
// Auto-approve, the platform and shell, the built-in connectors and the coding
// CLIs found here. The founders' dashboard counts these to see what people
// use. Only words from fixed lists, true or false, and small counts: never a
// path, a file or server name, or anything read from a file.
const { prefOf } = require('./coding-clis');

// The shell run_command uses (tools.SHELL.name).
const SHELLS = { 'Git Bash': 'git_bash', 'Windows PowerShell': 'powershell', bash: 'bash', zsh: 'zsh', sh: 'sh', fish: 'fish' };
const PLATFORMS = new Set(['win32', 'darwin', 'linux']);

/**
 * @param {object} o
 * @param {string} o.permissionMode 'ask' or 'auto'
 * @param {string} o.platform process.platform
 * @param {string} o.shell The shell's name, e.g. 'Git Bash'
 * @param {string} o.theme
 * @param {object} o.state The app's saved state (browser, computerUse, autoUpdate, codingAgents...)
 * @param {{ remote: object[], local: object[] }} o.mcp
 * @param {{ agentsMd: boolean, git: boolean }|null} o.folder Null for a cloud session.
 * @param {number} o.terminals Terminal tabs open
 */
function clientMeta({ permissionMode, platform, shell, theme, state, mcp, folder, terminals }) {
  const s = state || {};
  const remote = ((mcp && mcp.remote) || []).filter((r) => r.enabled);
  const meta = {
    approval_mode: permissionMode === 'auto' ? 'auto' : 'ask',
    shell: SHELLS[shell] || 'other',
    theme,
    browser: s.browser !== false,
    computer_use: Boolean(s.computerUse),
    auto_update: s.autoUpdate === true,
    local_mcp: ((mcp && mcp.local) || []).filter((l) => l.enabled).length,
    // A built-in connector by its catalog id; a server of the user's own only counted.
    mcp: [...new Set(remote.filter((r) => r.catalog).map((r) => String(r.catalog)))],
    custom_mcp: remote.filter((r) => !r.catalog).length,
    terminals: Number(terminals) || 0,
    // The coding CLIs installed here, with the user's choice for each.
    clis: Object.fromEntries(((s.codingAgentsDetected && s.codingAgentsDetected.clis) || [])
      .filter((d) => d.installed).map((d) => [d.id, prefOf(s.codingAgents, d.id).access])),
  };
  if (PLATFORMS.has(platform)) meta.platform = platform;
  if (folder) {
    meta.agents_md = Boolean(folder.agentsMd);
    meta.git = Boolean(folder.git);
  }
  return meta;
}

module.exports = { clientMeta, SHELLS };
