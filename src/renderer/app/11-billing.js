'use strict';
/* global cf, marked, DOMPurify, hljs */
// Part of the window's script, split by feature. The files are plain scripts,
// loaded in order by index.html and sharing one global scope: what one
// declares, the later ones use. Billing, and the user's own provider keys.

// ── Billing ────────────────────────────────────────────────────────────────
// The website's billing page, here: plan, subscriptions, invoices, orders, and
// what can be done with a subscription. Paying for something new stays on the
// website, which the buttons open.
let billingData = null;
const invoicesOpen = new Map(); // subscription id -> invoices, or 'loading', or an Error

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2).replace(/\.00$/, '')}`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const openLink = (url) => { if (url) window.open(url, '_blank'); };

const SUB_STATUS = {
  active: ['Active', 'good'], on_trial: ['Trial', 'good'], cancelled: ['Cancelled', 'warn'],
  past_due: ['Payment failed', 'bad'], unpaid: ['Unpaid', 'bad'], expired: ['Ended', ''], paused: ['Paused', ''],
};

function subWhen(sub) {
  if (sub.status === 'active') return `Renews on ${fmtDate(sub.renews_at)}`;
  if (sub.status === 'on_trial') return `Trial ends on ${fmtDate(sub.trial_ends_at)}`;
  if (sub.status === 'cancelled') return `Ends on ${fmtDate(sub.ends_at || sub.renews_at)}. Resume it before then to keep it.`;
  if (sub.status === 'expired') return `Ended on ${fmtDate(sub.ends_at)}`;
  if (sub.needs_payment) return 'The last payment failed. Update your card to keep the plan.';
  return '';
}

async function loadBilling() {
  billingData = await call(cf.billing);
  return billingData;
}

async function renderBillingPane() {
  const pane = $('billingPane');
  if (!billingData) {
    pane.replaceChildren(paneHead('Billing'), el('div', 'pane-empty', 'Loading…'));
    try {
      await loadBilling();
    } catch (err) {
      pane.replaceChildren(paneHead('Billing'), el('div', 'pane-empty', err.message));
      return;
    }
  }
  const scroll = pane.scrollTop;
  // Each list scrolls on its own; a redraw keeps where it was.
  const listScroll = Object.fromEntries([...pane.querySelectorAll('[data-list]')]
    .map((box) => [box.dataset.list, box.scrollTop]));
  const data = billingData;
  const plan = data.plan || {};
  const urls = plan.urls || {};
  pane.replaceChildren(paneHead('Billing', 'Your plan, subscriptions and purchases. Payments go through the '
    + 'website, which the buttons open in your browser.'));

  // The plan and what is left to spend.
  const credits = S.credits || {};
  const card = el('div', 'bill-plan');
  const left = el('div', 'bill-plan-main');
  left.append(el('div', 'bill-label', 'Current plan'), el('div', 'bill-plan-name', plan.name || '—'));
  const facts = el('div', 'bill-facts');
  const fact = (label, value) => {
    const f = el('div', 'bill-fact');
    f.append(el('span', null, label), el('strong', null, value));
    facts.append(f);
  };
  if (credits.weekly_total != null) fact('Weekly allowance', `${fmtNum(credits.weekly_remaining)} of ${fmtNum(credits.weekly_total)} left`);
  if (credits.credits != null) fact('Credits', fmtNum(credits.credits));
  if (plan.unlimited_models) fact('Unlimited models', 'Included');
  left.append(facts);
  const buttons = el('div', 'bill-plan-actions');
  const change = el('button', 'btn primary', plan.key && plan.key !== 'free' ? 'Change plan' : 'Upgrade');
  change.addEventListener('click', () => openLink(urls.plans));
  const buy = el('button', 'btn', 'Buy credits');
  buy.addEventListener('click', () => openLink(creditsUrl(urls)));
  const web = el('button', 'btn', 'Billing on the website');
  web.addEventListener('click', () => openLink(urls.billing));
  buttons.append(change, buy, web);
  card.append(left, buttons);
  pane.append(card);

  pane.append(el('div', 'pane-section', 'Subscriptions'));
  if (!data.subscriptions.length) {
    pane.append(el('div', 'set-desc bill-empty', 'No subscriptions.'));
  } else {
    const subs = el('div', 'bill-scroll bill-subs');
    subs.dataset.list = 'subs';
    for (const sub of data.subscriptions) subs.append(subscriptionRow(pane, sub));
    pane.append(subs);
  }

  pane.append(el('div', 'pane-section', 'Credit purchases'));
  if (!data.credit_orders.length) {
    pane.append(el('div', 'set-desc bill-empty', 'No credit purchases.'));
  } else {
    const table = el('div', 'bill-table bill-scroll');
    table.dataset.list = 'orders';
    for (const order of data.credit_orders) {
      const line = el('div', 'bill-order');
      const name = el('div', 'bill-order-name');
      name.append(el('strong', null, order.name), el('span', null, fmtDate(order.created_at)));
      const status = order.status === 'paid' ? ['Paid', 'good'] : [order.status, order.status === 'refunded' ? 'warn' : ''];
      line.append(name, el('span', `bill-badge ${status[1]}`, status[0]), el('span', 'bill-amount', money(order.total_cents)));
      table.append(line);
    }
    pane.append(table);
  }
  const foot = el('div', 'pane-foot');
  foot.append(el('div', 'pane-status'));
  pane.append(foot);
  applyStatus(pane);
  pane.scrollTop = scroll;
  for (const box of pane.querySelectorAll('[data-list]')) box.scrollTop = listScroll[box.dataset.list] || 0;
}

function subscriptionRow(pane, sub) {
  const row = el('div', 'set-row stack bill-sub');
  const head = el('div', 'bill-sub-head');
  const text = el('div', 'set-text');
  const title = el('div', 'set-title');
  const [label, tone] = SUB_STATUS[sub.status] || [sub.status, ''];
  title.append(el('span', null, sub.name), el('span', `bill-badge ${tone}`, label));
  if (sub.discount) title.append(el('span', 'bill-badge good', `${sub.discount.percent}% off next invoice`));
  text.append(title, el('div', 'set-desc', subWhen(sub)));
  if (sub.card) text.append(el('div', 'set-desc', `${sub.card.brand ? sub.card.brand[0].toUpperCase() + sub.card.brand.slice(1) : 'Card'} •••• ${sub.card.last4}`));
  head.append(text);
  const actions = el('div', 'bill-actions');
  const action = (labelText, cls, run) => {
    const b = el('button', `btn ${cls || ''}`, labelText);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await run(); } finally { b.disabled = false; }
    });
    actions.append(b);
  };
  action(invoicesOpen.has(sub.id) ? 'Hide invoices' : 'Invoices', '', async () => {
    if (invoicesOpen.has(sub.id)) {
      invoicesOpen.delete(sub.id);
      renderBillingPane();
      return;
    }
    invoicesOpen.set(sub.id, 'loading');
    renderBillingPane();
    try {
      invoicesOpen.set(sub.id, (await call(cf.billingAction, { id: sub.id, action: 'invoices', method: 'GET' })).invoices || []);
    } catch (err) {
      invoicesOpen.set(sub.id, err);
    }
    renderBillingPane();
  });
  action(sub.needs_payment ? 'Update payment' : 'Manage payment', sub.needs_payment ? 'primary' : '', async () => {
    paneStatus(pane, 'Opening the payment portal…');
    try {
      openLink((await call(cf.billingAction, { id: sub.id, action: 'portal' })).url);
      paneStatus(pane, 'The payment portal is open in your browser.', 'ok');
    } catch (err) {
      paneStatus(pane, err.message, 'error');
    }
  });
  if (sub.can_resume) {
    action('Resume', 'primary', async () => {
      try {
        await call(cf.billingAction, { id: sub.id, action: 'resume' });
        paneStatus(pane, 'Resumed. Your plan continues.', 'ok');
        await refreshBillingSoon();
      } catch (err) {
        paneStatus(pane, err.message, 'error');
      }
    });
  }
  if (sub.can_cancel) action(sub.status === 'on_trial' ? 'End trial' : 'Cancel', 'danger', () => cancelFlow(pane, sub));
  head.append(actions);
  row.append(head);

  const invoices = invoicesOpen.get(sub.id);
  if (invoices) {
    const box = el('div', 'bill-invoices');
    if (invoices === 'loading') box.append(el('div', 'set-desc', 'Loading invoices…'));
    else if (invoices instanceof Error) box.append(el('div', 'set-desc bad', invoices.message));
    else if (!invoices.length) box.append(el('div', 'set-desc', 'No invoices yet.'));
    else {
      for (const inv of invoices) {
        const line = el('div', 'bill-order');
        const name = el('div', 'bill-order-name');
        name.append(el('strong', null, fmtDate(inv.created_at)), el('span', null, (inv.billing_reason || '').replace(/_/g, ' ')));
        line.append(name, el('span', `bill-badge ${inv.status === 'paid' ? 'good' : ''}`, inv.status_formatted || inv.status || ''),
          el('span', 'bill-amount', inv.total_formatted || ''));
        if (inv.invoice_url) {
          const view = el('button', 'btn small', 'View');
          view.addEventListener('click', () => openLink(inv.invoice_url));
          line.append(view);
        }
        box.append(line);
      }
    }
    row.append(box);
  }
  return row;
}

// Billing changes arrive through the payment provider's webhook, a moment later.
async function refreshBillingSoon() {
  await new Promise((r) => setTimeout(r, 2500));
  try { await loadBilling(); } catch { /* the old view stays */ }
  loadCredits();
  if (settingsTab === 'billing') renderBillingPane();
}

const CANCEL_REASONS = [
  ['', 'Choose a reason (optional)'],
  ['too_expensive', 'It is too expensive'],
  ['unused', 'I do not use it enough'],
  ['missing_features', 'Features I need are missing'],
  ['low_quality', 'The results are not good enough'],
  ['too_complex', 'It is too hard to use'],
  ['switched_service', 'I use another service'],
  ['customer_service', 'Customer service'],
  ['other', 'Another reason'],
];

// Cancel: why (optional), the stay offer when there is one, then confirm.
async function cancelFlow(pane, sub) {
  const trial = sub.status === 'on_trial';
  const overlay = el('div', 'overlay confirm-overlay');
  const modal = el('div', 'modal confirm-modal bill-cancel');
  modal.setAttribute('role', 'dialog');
  modal.append(el('h2', 'confirm-title', trial ? 'End your free trial?' : 'Cancel your subscription?'));
  modal.append(el('p', 'confirm-text', trial
    ? 'Cancelling ends your trial now, not when it was due to end. You go back to the free plan today and are not charged. A trial can be used only once.'
    : `You keep everything you paid for until ${fmtDate(sub.renews_at)}, then you go back to the free plan. Your credits stay. You can resume before that date.`));
  const reason = el('select', 'set-select');
  for (const [value, text] of CANCEL_REASONS) {
    const option = el('option', null, text);
    option.value = value;
    reason.append(option);
  }
  const comment = el('textarea', 'bill-comment');
  comment.placeholder = 'Anything we could do better? (optional)';
  comment.maxLength = 1000;
  if (!trial) modal.append(reason, comment);
  const offer = el('div', 'bill-offer');
  offer.hidden = true;
  modal.append(offer);
  const keep = el('button', 'btn', trial ? 'Keep my trial' : 'Keep subscription');
  const confirm = el('button', 'btn danger-solid', trial ? 'End trial now' : 'Cancel subscription');
  const actions = el('div', 'modal-actions');
  actions.append(el('div', 'bar-spacer'), keep, confirm);
  modal.append(actions);
  overlay.append(modal);
  const close = () => overlay.remove();
  keep.addEventListener('click', close);
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);

  if (!trial) {
    call(cf.billingAction, { id: sub.id, action: 'offer', method: 'GET' }).then((o) => {
      if (!o || !o.eligible) return;
      const amounts = o.amount_due_cents && o.discounted_cents != null
        ? ` (${money(o.amount_due_cents)} → ${money(o.discounted_cents)})` : '';
      offer.append(el('div', 'bill-offer-title', 'Wait — here is a better deal'),
        el('p', null, `Stay, and your next ${o.interval || 'month'} is ${o.percent}% off${amounts}. `
          + 'One time only; it applies to your next invoice by itself.'));
      const claim = el('button', 'btn primary', `Claim ${o.percent}% off and stay`);
      claim.addEventListener('click', async () => {
        claim.disabled = true;
        try {
          const r = await call(cf.billingAction, { id: sub.id, action: 'offer', method: 'POST' });
          close();
          paneStatus(pane, `Done: your next invoice is ${r.percent}% off. Glad you are staying!`, 'ok');
          await refreshBillingSoon();
        } catch (err) {
          claim.disabled = false;
          paneStatus(pane, err.message, 'error');
        }
      });
      offer.append(claim);
      offer.hidden = false;
    }).catch(() => {});
  }

  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await call(cf.billingAction, {
        id: sub.id, action: 'cancel', body: { feedback: reason.value, comment: comment.value },
      });
      close();
      paneStatus(pane, trial ? 'Your trial has ended.' : `Cancelled. Your plan stays until ${fmtDate(sub.renews_at)}.`, 'ok');
      await refreshBillingSoon();
    } catch (err) {
      confirm.disabled = false;
      paneStatus(pane, err.message, 'error');
      close();
    }
  });
}

// ── Your API keys (BYOK) ───────────────────────────────────────────────────
let byokKeys = null;

async function renderKeysPane() {
  const pane = $('keysPane');
  const plan = S.credits && S.credits.plan;
  pane.replaceChildren(paneHead('Your API keys',
    "Use your own key with an AI provider. Runs on that provider's models then go through your key and "
    + 'cost no credits: you pay the provider directly.'));
  const where = el('div', 'set-row warnless static');
  const whereText = el('div', 'set-text');
  whereText.append(el('div', 'set-title', 'Where your keys are used'));
  const inSandbox = plan && plan.byok_in_sandbox;
  whereText.append(el('div', 'set-desc',
    'Sessions in a folder on this computer: on any plan. '
    + (inSandbox ? 'Cloud sandbox sessions: yes, on your plan.'
      : 'Cloud sandbox sessions: from the Unlimited plan up. Until then they use CodingFleet keys and credits.')));
  where.append(whereText);
  pane.append(where);
  const status = el('div', 'pane-status');
  if (!byokKeys) {
    pane.append(el('div', 'pane-empty', 'Loading…'));
    try {
      byokKeys = (await call(cf.byokList)).keys || [];
    } catch (err) {
      pane.lastChild.textContent = err.message;
      return;
    }
    renderKeysPane();
    return;
  }
  for (const key of byokKeys) pane.append(keyRow(pane, key));
  const foot = el('div', 'pane-foot');
  foot.append(status);
  pane.append(foot);
  applyStatus(pane);
}

function keyRow(pane, key) {
  const row = el('div', 'set-row stack byok-row');
  const head = el('div', 'byok-head');
  const text = el('div', 'set-text');
  text.append(el('div', 'set-title', key.name));
  let desc = key.configured ? `Saved: ${key.masked}` : 'Not set';
  if (key.configured && key.last_used_at) desc += ` · last used ${relTime(key.last_used_at)} ago`;
  text.append(el('div', 'set-desc', desc));
  if (key.last_error) text.append(el('div', 'set-desc bad', `The provider refused it: ${key.last_error}`));
  const link = el('a', 'byok-link', 'Get a key');
  link.href = key.key_url;
  link.target = '_blank';
  head.append(text, link);
  const form = el('div', 'byok-form');
  const input = el('input', 'set-number byok-input');
  input.type = 'password';
  input.placeholder = key.configured ? 'Paste a new key to replace it' : key.placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const save = el('button', 'btn primary', key.configured ? 'Replace' : 'Save');
  const saveKey = async () => {
    const value = input.value.trim();
    if (!value) return;
    save.disabled = true;
    paneStatus(pane, 'Saving…');
    try {
      const updated = await call(cf.byokSave, { provider: key.provider, apiKey: value });
      byokKeys = byokKeys.map((k) => (k.provider === key.provider ? updated : k));
      paneStatus(pane, `${key.name} key saved.`, 'ok');
    } catch (err) {
      paneStatus(pane, err.message, 'error');
    }
    renderKeysPane();
  };
  save.addEventListener('click', saveKey);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveKey(); });
  form.append(input, save);
  if (key.configured) {
    const remove = el('button', 'btn', 'Remove');
    remove.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Remove your ${key.name} key?`,
        text: 'Runs on these models then use CodingFleet keys and cost credits again.',
        confirm: 'Remove',
        danger: true,
      });
      if (!ok) return;
      try {
        const updated = await call(cf.byokDelete, key.provider);
        byokKeys = byokKeys.map((k) => (k.provider === key.provider ? updated : k));
        paneStatus(pane, `${key.name} key removed.`, 'ok');
      } catch (err) {
        paneStatus(pane, err.message, 'error');
      }
      renderKeysPane();
    });
    form.append(remove);
  }
  row.append(head, form);
  return row;
}
