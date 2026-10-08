'use strict';
// Small questions about sessions and their transcripts: what one has cost,
// whether it matches a search, which folders were used lately, and the
// conversation as Markdown. No DOM and no state: the window loads this before
// its own scripts, the tests require it.
(function (root) {
  const words = root.CF_TOOL_WORDS || (typeof require === 'function' ? require('./tool-words') : null);

  /** What the runs in a transcript cost: the sum of their footers. */
  function sessionSpend(items) {
    let credits = 0;
    let runs = 0;
    for (const item of items || []) {
      if (item.type !== 'footer' || !item.usage || item.usage.credits == null) continue;
      const n = Number(item.usage.credits);
      if (!Number.isFinite(n)) continue;
      credits += n;
      runs += 1;
    }
    return { credits: Math.round(credits * 100) / 100, runs };
  }

  /** Whether every word of the search is somewhere in the session's names. */
  function sessionMatches(query, fields) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const hay = (fields || []).filter(Boolean).join('\n').toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  }

  /**
   * The folders used most recently, each once.
   * @param {{ cwd: string, at: number }[]} uses
   */
  function recentFolders(uses, { limit = 6, exclude = [] } = {}) {
    const key = (dir) => String(dir).replace(/[\\/]+$/, '').toLowerCase();
    const skip = new Set(exclude.filter(Boolean).map(key));
    const seen = new Map();
    for (const use of uses || []) {
      if (!use || !use.cwd) continue;
      const k = key(use.cwd);
      if (skip.has(k)) continue;
      const at = Number(use.at) || 0;
      const known = seen.get(k);
      if (!known || at > known.at) seen.set(k, { cwd: use.cwd, at });
    }
    return [...seen.values()].sort((a, b) => b.at - a.at).slice(0, limit).map((u) => u.cwd);
  }

  /** The prompt a turn answers: the last prompt before `index` that was not a steer. */
  function turnStart(items, index) {
    for (let i = Math.min(index, items.length) - 1; i >= 0; i--) {
      if (items[i].type === 'user' && !items[i].steer) return i + 1;
    }
    return 0;
  }

  /** The answer of the turn that ends at `index`, as Markdown. */
  function turnText(items, index) {
    return items.slice(turnStart(items, index), index)
      .filter((item) => item.type === 'assistant' && String(item.text || '').trim())
      .map((item) => item.text.trim())
      .join('\n\n');
  }

  const quoteBlock = (text) => String(text || '').split('\n').map((line) => `> ${line}`).join('\n');
  const inlineCode = (text) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    const shown = value.length > 160 ? `${value.slice(0, 159)}…` : value;
    return shown.includes('`') ? `\`\` ${shown} \`\`` : `\`${shown}\``;
  };

  function toolLines(group) {
    const lines = [];
    const tools = group.tools || [];
    const summary = words ? words.groupSummary(tools) : `${tools.length} tool calls`;
    lines.push(`*${summary}*`);
    for (const tool of tools) {
      const [verb, target] = words ? words.toolSummary(tool) : [tool.name, ''];
      const failed = ['failed', 'denied', 'cancelled'].includes(tool.status) ? ` (${tool.status})` : '';
      lines.push(`- ${verb}${target ? ` ${inlineCode(target)}` : ''}${failed}`);
    }
    return lines.join('\n');
  }

  function footerLine(item) {
    const bits = [];
    if (item.model) bits.push(item.modelName || item.model);
    const usage = item.usage || {};
    if (usage.credits != null) bits.push(`${usage.credits} ${Number(usage.credits) === 1 ? 'credit' : 'credits'}`);
    if (item.note) bits.push(item.note);
    return bits.length ? `*${bits.join(' · ')}*` : '';
  }

  /**
   * A whole conversation as Markdown, for a file a person keeps or shares.
   * @param {{ title: string, folder?: string, exportedAt?: string, items: object[] }} o
   */
  function transcriptMarkdown({ title, folder, exportedAt, items }) {
    const out = [`# ${String(title || 'CodingFleet session').replace(/\n/g, ' ')}`, ''];
    const meta = [];
    if (folder) meta.push(`Folder: \`${folder}\``);
    if (exportedAt) meta.push(`Exported: ${exportedAt}`);
    if (meta.length) out.push(meta.join('  \n'), '');
    let speaker = null;
    const say = (who) => {
      if (speaker === who) return;
      speaker = who;
      out.push(`## ${who}`, '');
    };
    for (const item of items || []) {
      switch (item.type) {
        case 'user': {
          say(item.steer ? 'You (while it worked)' : 'You');
          out.push(String(item.text || '').trim(), '');
          const files = (item.files || []).map((f) => f.ref || f.name).filter(Boolean);
          if (files.length) out.push(`*Attached: ${files.map(inlineCode).join(', ')}*`, '');
          if (item.steer) speaker = null;
          break;
        }
        case 'assistant':
          say('CodingFleet');
          out.push(String(item.text || '').trim(), '');
          break;
        case 'tools':
          say('CodingFleet');
          out.push(toolLines(item), '');
          break;
        case 'files': {
          const files = item.files || [];
          out.push(`*Edited ${files.length} file${files.length === 1 ? '' : 's'}: ${files.map((f) => inlineCode(f.path)).join(', ')}*`, '');
          break;
        }
        case 'notice':
          out.push(quoteBlock(item.text), '');
          break;
        case 'error':
          out.push(quoteBlock(`**Error:** ${item.text}`), '');
          break;
        case 'compaction':
          out.push('*— The conversation was compacted here —*', '');
          break;
        case 'footer': {
          const line = footerLine(item);
          if (line) out.push(line, '');
          speaker = null;
          break;
        }
        default:
          break;
      }
    }
    return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  }

  /** A file name for a session, safe on every system. */
  function exportFileName(title) {
    const base = String(title || 'session').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '');
    return `${base || 'session'}.md`;
  }

  const api = {
    sessionSpend, sessionMatches, recentFolders, turnStart, turnText, transcriptMarkdown, exportFileName,
  };
  root.CF_SESSION_TOOLS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
