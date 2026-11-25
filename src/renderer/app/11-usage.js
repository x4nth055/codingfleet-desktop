'use strict';
/* global CF_USAGE_WINDOW */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. The Usage tab: the weekly allowance, credits,
// and the 5-hour standard limit on standard (unlimited) models (lib/usage-window.js).

function usageMeter(percent, cls) {
  const bar = el('div', 'quota-bar');
  const fill = el('div', `quota-fill ${cls}`);
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  bar.append(fill);
  return bar;
}

function renderUsagePane() {
  const pane = $('usagePane');
  pane.replaceChildren(paneHead('Usage', 'What your plan has left.'));
  const credits = S.credits;
  if (!credits) {
    pane.append(el('div', 'pane-empty', S.creditsError || 'Loading…'));
    if (!S.creditsError) loadCredits().then(() => { if (settingsTab === 'usage') renderUsagePane(); });
    return;
  }
  const plan = credits.plan || {};
  const urls = plan.urls || {};

  if (credits.weekly_total) {
    const card = el('div', 'usage-card');
    const left = Math.max(0, Number(credits.weekly_remaining) || 0);
    const pct = Math.round(100 * left / credits.weekly_total);
    const head = el('div', 'usage-head');
    head.append(el('span', 'usage-label', 'Weekly premium credits'),
      el('strong', 'usage-value', `${fmtNum(left)} of ${fmtNum(credits.weekly_total)} left`));
    card.append(head, usageMeter(pct, pct > 20 ? 'good' : pct > 0 ? 'low' : 'out'),
      el('p', 'usage-note', 'Premium models use these first, then your credits. They reset every Monday at 00:00 UTC.'));
    pane.append(card);
  }
  if (credits.credits != null) {
    const card = el('div', 'usage-card usage-row');
    card.append(el('span', 'usage-label', 'Credits'), el('strong', 'usage-value', fmtNum(credits.credits)));
    pane.append(card);
  }

  // The 5-hour limit: one quiet row, only on plans that have it.
  const view = CF_USAGE_WINDOW.windowView(credits.standard_window);
  if (view) {
    const row = el('div', 'usage-card usage-window');
    row.id = 'usageWindow';
    const head = el('div', 'usage-quiet-head');
    head.append(el('span', 'usage-quiet-title', `${view.hours}-hour standard limit`), el('span', 'usage-quiet-value', view.line));
    const bar = el('div', 'usage-quiet-bar');
    const fill = el('span');
    fill.style.width = `${view.percent}%`;
    bar.append(fill);
    row.append(head, bar, el('div', 'usage-quiet-note', 'Only for standard (unlimited) models. Past it, they use premium credits until it clears.'));
    pane.append(row);
  }

  const actions = el('div', 'usage-actions');
  const plans = el('button', 'btn', 'Plans');
  plans.addEventListener('click', () => openLink(urls.plans));
  const buy = el('button', 'btn', 'Buy credits');
  buy.addEventListener('click', () => openLink(creditsUrl(urls)));
  actions.append(plans, buy);
  pane.append(actions);
}

// The in-chat link of a limit notice: Settings at Usage, with the limit lit up.
function openUsage() {
  openSettings(false, 'usage');
  loadCredits({ quiet: true }).then(() => {
    if (settingsTab !== 'usage' || $('settings').hidden) return;
    renderUsagePane();
    const card = $('usageWindow');
    if (!card) return;
    card.scrollIntoView({ block: 'nearest' });
  });
}
