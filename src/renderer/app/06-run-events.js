'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. What the event stream of a run does to the conversation.

// ── Run events ─────────────────────────────────────────────────────────────
function onRunEvent({ sessionId, event, data }) {
  const run = S.running.get(sessionId);
  if (event.startsWith('subagent.') || (data && data.agent_id && (event === 'tool.call' || event === 'tool.result'))) {
    if (run && data?.agent_id) {
      if (!run.agentIds) run.agentIds = new Set();
      run.agentIds.add(data.agent_id);
    }
    onAgentEvent(sessionId, event, data || {});
    return;
  }
  switch (event) {
    case 'client.recovering':
      if (!run) {
        const transcript = transcriptOf(sessionId);
        const startedAt = Date.parse(data.started_at);
        const promptAt = transcript.findLastIndex((item) => item.type === 'user' && item.checkpointId
          && Math.abs(Date.parse(item.at) - startedAt) < 60000);
        if (promptAt >= 0) {
          const checkpointId = transcript[promptAt].checkpointId;
          let end = promptAt + 1;
          while (end < transcript.length && transcript[end].checkpointId === checkpointId) end++;
          transcript.splice(promptAt + 1, end - promptAt - 1);
        }
        S.running.set(sessionId, {
          runId: data.run_id, started: Date.parse(data.started_at) || Date.now(),
          turnStart: transcript.length,
        });
        S.remoteBusy.delete(sessionId);
        if (sessionId === S.current) renderMain();
        renderSidebar();
      }
      break;
    case 'client.recovered_finished':
      reloadTranscript(sessionId).then((history) => {
        if (data.status === 'error') {
          if (data.progress?.text && !history?.messages?.some((message) => message.partial)) {
            addItem(sessionId, { type: 'assistant', text: data.progress.text, live: false });
          }
          addItem(sessionId, { type: 'error', text: data.error || 'The run stopped before it finished. Its partial progress is saved.' });
        }
      });
      break;
    case 'context.compacted':
      if (data.agent_id) break;
      closeLiveText(sessionId);
      addItem(sessionId, {
        type: 'compaction', before: data.before_tokens, after: data.after_tokens, manual: false, at: nowIso(),
      });
      setContextTokens(sessionId, data.after_tokens);
      break;
    case 'run.started':
      if (run) run.runId = data.run_id;
      break;
    case 'run.meta':
      if (run) run.model = data.model;
      break;
    case 'status':
      if (run) {
        if (data.state === 'started') run.status = data.kind;
        else if (run.status === data.kind) run.status = null;
        updateWorkingLabel(sessionId);
      }
      break;
    case 'notice':
      assistantStamp(sessionId);
      addItem(sessionId, { type: 'notice', text: data.message });
      break;
    case 'text.delta':
      if (run && run.status === 'thinking') {
        run.status = null;
        updateWorkingLabel(sessionId);
      }
      appendText(sessionId, data.text || '');
      break;
    case 'tool.call':
      closeLiveText(sessionId);
      if (!findTool(sessionId, data.id)) {
        addTool(sessionId, {
          id: data.id,
          name: data.name,
          arguments: data.arguments || {},
          status: data.executor === 'client' ? 'queued' : 'running',
          ...run?.replayTools?.get(data.id),
        });
      }
      break;
    case 'client.approval': {
      updateTool(sessionId, data.id, { status: 'waiting', reason: data.reason });
      const tool = findTool(sessionId, data.id);
      if (tool && tool.group.agentId && sessionId === S.current) openPanel(tool.group.agentId);
      notifyApproval(sessionId);
      break;
    }
    case 'client.tool_running':
      updateTool(sessionId, data.id, { status: 'running' });
      break;
    case 'client.tool_denied':
      updateTool(sessionId, data.id, { status: 'denied' });
      break;
    // The picture take_screenshot just took, so the step shows what the agent saw.
    case 'client.tool_image':
      updateTool(sessionId, data.id, { image: data.url, imageTitle: data.title, open: true });
      break;
    case 'tool.result': {
      const tool = findTool(sessionId, data.id);
      if (tool) {
        const status = tool.status === 'denied' ? 'denied' : data.ok ? 'done' : 'failed';
        const patch = { status, output: data.output };
        if (data.subagent && data.subagent.id) {
          patch.agentId = data.subagent.id;
          const agent = ensureAgent(sessionId, data.subagent.id, { callId: data.id });
          if (agent.status === 'running') {
            Object.assign(agent, {
              status: data.subagent.error ? 'failed' : 'done',
              credits: data.subagent.credits, summary: data.subagent.summary || agent.summary,
              model: data.subagent.model || agent.model, role: data.subagent.role || agent.role,
            });
          }
        }
        updateTool(sessionId, data.id, patch);
      }
      break;
    }
    case 'session.title': {
      const session = S.sessions.find((s) => s.id === sessionId);
      if (session && data.title) {
        session.title = data.title;
        renderSidebar();
        if (sessionId === S.current) renderTopbar();
      }
      break;
    }
    case 'usage': {
      if (run) run.usage = data;
      const session = S.sessions.find((s) => s.id === sessionId);
      if (session && data.context_tokens) {
        session.context = { ...(session.context || {}), tokens: data.context_tokens };
        if (sessionId === S.current) renderAccount();
      }
      break;
    }
    case 'run.ended':
      if (run) run.ended = data;
      break;
    case 'client.files_changed':
      if (run) {
        run.files = data.files || [];
        run.filesRunId = data.run_id || run.runId || null;
      }
      break;
    case 'client.reconnecting':
      // The whole run is about to be replayed: drop what this turn drew so far.
      if (run) {
        // Approval requests and local progress are not in the server replay.
        // Keep them, or reconnecting would hide an unanswered approval forever.
        if (!run.replayTools) run.replayTools = new Map();
        const remember = (items) => {
          for (const item of items) {
            for (const tool of item.tools || []) {
              const { status, reason, image, imageTitle } = tool;
              run.replayTools.set(tool.id, { status, reason, image, imageTitle });
            }
          }
        };
        remember(transcriptOf(sessionId).slice(run.turnStart));
        for (const id of run.agentIds || []) {
          const agent = agentsOf(sessionId).get(id);
          if (agent) remember(agent.items);
          agentsOf(sessionId).delete(id);
        }
        transcriptOf(sessionId).length = run.turnStart;
        run.stamped = false;
        if (sessionId === S.current) renderTranscript();
      }
      break;
    case 'client.error':
      addItem(sessionId, { type: 'error', text: data.message });
      break;
    case 'client.finished':
      finishRun(sessionId);
      break;
    default:
      break;
  }
}

function finishRun(sessionId) {
  const run = S.running.get(sessionId);
  S.running.delete(sessionId);
  closeLiveText(sessionId);
  for (const group of transcriptOf(sessionId).filter((i) => i.type === 'tools')) {
    let changed = false;
    for (const tool of group.tools) {
      if (ACTIVE.includes(tool.status)) {
        tool.status = 'cancelled';
        changed = true;
      }
    }
    if (changed) refreshItem(sessionId, group);
  }
  for (const agent of agentsOf(sessionId).values()) {
    for (const tool of agent.items.filter((i) => i.type === 'tools').flatMap((g) => g.tools)) {
      if (ACTIVE.includes(tool.status)) tool.status = 'cancelled';
    }
    if (agent.status === 'running') agent.status = 'cancelled';
    agentChanged(sessionId, agent.id);
  }
  if (sessionId === S.current) {
    const working = document.querySelector('.working');
    if (working) working.remove();
  }

  const ended = run && run.ended;
  if (ended && ended.reason === 'error') addItem(sessionId, { type: 'error', text: ended.error || 'The run failed.' });
  if (run && run.files && run.files.length) {
    addItem(sessionId, {
      type: 'files', sessionId, files: run.files, open: new Set(), runId: run.runId || run.filesRunId || null,
    });
  }
  const note = ended && ended.reason === 'cancelled' ? 'Stopped'
    : ended && ended.reason === 'interrupted' ? 'Stopped: this computer stopped answering'
      : ended && ended.reason === 'budget' ? 'Stopped at the spend limit' : null;
  // Asleep or offline mid-run: the turn is saved, and "continue" picks it up.
  // Offered in the composer, never sent on the user's behalf.
  if (ended && ended.reason === 'interrupted' && sessionId === S.current && !$('prompt').value.trim()) {
    $('prompt').value = 'continue';
    autosize();
    updateSendButton();
  }
  const usage = run && run.usage;
  if (usage || note) {
    addItem(sessionId, { type: 'footer', model: (run && run.model) || (usage && usage.model), usage, note });
  }
  // What this window drew for the turn, for a rebuild to keep instead of the
  // server's flat copy of it. The whole turn is kept, not just its answer:
  // every tool group stays where it ran, with the text between them.
  if (run) {
    const items = transcriptOf(sessionId).slice(run.turnStart || 0);
    if (items.length) {
      ownTurns.set(sessionId, {
        text: items.filter((item) => item.type === 'assistant').map((item) => item.text).join('\n\n'),
        items,
      });
    }
  }

  if (S.init.shotExpand) expandForScreenshot(sessionId);
  if (sessionId === S.current) {
    renderTopbar();
    renderComposer();
  }
  renderSidebar();
  loadCredits();
  loadSessions().then(() => {
    const known = S.sessions.find((x) => x.id === sessionId);
    if (known) S.seenAnswer.set(sessionId, known.last_message_at || null);
  });
}

function expandForScreenshot(sessionId) {
  for (const item of transcriptOf(sessionId)) {
    if (item.type === 'tools') item.open = true;
    if (item.type === 'files') item.open.add(0);
  }
  if (sessionId === S.current) {
    renderTranscript();
    const tip = [...document.querySelectorAll('.has-tip')].pop();
    if (tip) tip.classList.add('show');
  }
}

function notifyApproval(sessionId) {
  if (document.hasFocus()) return;
  try {
    // eslint-disable-next-line no-new
    new Notification('CodingFleet needs your approval', {
      body: sessionLabel(S.sessions.find((s) => s.id === sessionId)),
    });
  } catch { /* notifications are optional */ }
}
