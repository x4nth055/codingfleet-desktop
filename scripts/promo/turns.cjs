'use strict';
// What the promo's scripted model says and does, and the sessions a returning
// user already has. The tools run for real in the demo projects
// (setup-projects.mjs): the edits, the commands and their output are real.
const fs = require('fs');
const path = require('path');

const DEV = process.env.PROMO_DEV_DIR || 'C:\\dev';
const DIRS = {
  wayfare: path.join(DEV, 'wayfare'),
  storefront: path.join(DEV, 'storefront-api'),
  invoicely: path.join(DEV, 'invoicely'),
};
const TYPED = path.join(__dirname, 'projects', 'invoicely', 'src');
const typed = (file) => fs.readFileSync(path.join(TYPED, file), 'utf8').replace(/\r\n/g, '\n');

const past = (title, ago, cwd, extra = {}) => ({
  id: `sess_seed_${title.toLowerCase().replace(/[^a-z]+/g, '_').slice(0, 24)}`,
  title, ago, cwd, ...extra,
  messages: [
    { role: 'user', text: title, created_at: new Date(Date.now() - (ago + 5) * 60000).toISOString() },
    { role: 'assistant', text: 'Done. All tests pass.', created_at: new Date(Date.now() - ago * 60000).toISOString(), tools: [] },
  ],
});

const sessions = [
  past('Stripe webhooks for refunds', 40, DIRS.storefront),
  past('Rate-limit the public endpoints', 190, DIRS.storefront, { pinned: true }),
  past('Dark mode for the booking flow', 320, DIRS.wayfare),
  past('Seasonal prices from the CMS', 1500, DIRS.wayfare),
  past('PDF export for invoices', 2900, DIRS.invoicely),
];

function localState() {
  const state = {
    sessions: {}, lastCwd: DIRS.wayfare, model: 'deepseek-v4-1-flash', permissionMode: 'ask', computerUse: false,
    theme: 'dark', autoUpdate: false, notifications: false,
  };
  for (const s of sessions) state.sessions[s.id] = { cwd: s.cwd, label: s.title, createdAt: Date.now() - s.ago * 60000 };
  return state;
}

// ── 1. A screenshot of a broken phone layout ──────────────────────────────
const wayfare = {
  match: /iPhone|phone/i,
  model: 'deepseek-v4-1-flash',
  steps: [
    { title: 'Fix the trip page on phones' },
    { think: 900 },
    { say: 'I can see it in your screenshot: the nav, the trip card and the **Book** button all run past the right edge. Let me find what holds them that wide.' },
    { parallel: [
      { tool: 'fs_read', args: { path: 'styles.css' } },
      { tool: 'fs_read', args: { path: 'index.html' } },
    ] },
    { say: '\n\nThree things overflow a 390 px screen: the card\'s fixed `width: 820px`, a nav that never wraps, and a price pinned with `position: absolute`. Fixing all three:' },
    { tool: 'fs_edit', args: { path: 'styles.css', old: '  display: flex;\n  width: 820px;\n', new: '  display: flex;\n  max-width: 820px;\n' } },
    { tool: 'fs_edit', args: {
      path: 'styles.css',
      old: '.day p { margin: 0; color: var(--muted); }\n',
      new: `.day p { margin: 0; color: var(--muted); }

@media (max-width: 600px) {
  .nav { flex-wrap: wrap; gap: 12px 20px; padding: 16px 20px; }
  .nav nav { order: 3; width: 100%; gap: 20px; overflow-x: auto; }
  .hero, .trip { padding-inline: 20px; }
  h1 { font-size: 40px; letter-spacing: -1px; }
  .trip-card { flex-direction: column; }
  .trip-photo { flex-basis: 160px; min-height: 160px; }
  .trip-head { justify-content: space-between; align-items: baseline; }
  .trip-head h2 { white-space: normal; font-size: 22px; }
  .price { position: static; }
  .facts { flex-wrap: wrap; }
  .book { width: 100%; }
  .days { grid-template-columns: 1fr; padding-inline: 20px; }
}
`,
    } },
    { say: '\n\nNow let me check it on a phone screen.' },
    { tool: 'run_command', args: { command: 'npm run dev', background: true } },
    { wait: 700 },
    { tool: 'run_command', args: { command: 'npm run snap' } },
    { tool: 'view_image', args: { source: 'snap.png' } },
    { say: '\n\nFixed, and checked on an iPhone-sized screen (390 × 844): everything fits, the price sits next to the title, and **Book this trip** spans the full width.\n\nThe desktop layout is untouched: every new rule is in one `@media (max-width: 600px)` block.', cps: 220 },
  ],
  usage: { credits: 0, time: 34, context: 14820 },
};

// ── 2. A slow endpoint, steered mid-run ───────────────────────────────────
const p99 = (out) => {
  const text = typeof out === 'string' ? out : `${out?.stdout || ''}`;
  return /p99\s+([\d,]+ ms)/.exec(text)?.[1] || '?';
};
const storefront = {
  match: /slow|p99/i,
  model: 'gpt-6-luna',
  steps: [
    { title: 'Why GET /orders got slow' },
    { think: 800 },
    { say: 'Let me measure it first, then look at what changed yesterday.' },
    { tool: 'run_command', args: { command: 'npm run bench' }, label: 'before' },
    { tool: 'run_command', args: { command: 'git log --oneline -3' } },
    { tool: 'fs_read', args: { path: 'src/routes/orders.js' } },
    { say: (r) => `\n\nConfirmed: p99 is **${p99(r.before)}**. Yesterday's commit loads each order's customer and items *inside a loop*: one query for the orders, then two more per order. That's **201 queries per request**.\n\nI'll load all customers and all items in one query each instead.` },
    { untilSteered: 9000 },
    { think: 900 },
    { say: '\n\nGot it: same response shape, field for field. Only how it\'s loaded changes.' },
    { tool: 'fs_edit', args: {
      path: 'src/routes/orders.js',
      old: `// GET /orders: the latest 100 orders, each with its customer and items.
export async function listOrders() {
  const orders = await query('orders', () => true, { limit: 100 });
  const result = [];
  for (const order of orders) {
    const [customer] = await query('customers', (c) => c.id === order.customer_id);
    const lines = await query('items', (item) => item.order_id === order.id);
    result.push({ ...order, customer, items: lines });
  }
  return result;
}`,
      new: `// GET /orders: the latest 100 orders, each with its customer and items.
// Three queries in all, however many orders there are.
export async function listOrders() {
  const orders = await query('orders', () => true, { limit: 100 });
  const customerIds = new Set(orders.map((order) => order.customer_id));
  const orderIds = new Set(orders.map((order) => order.id));
  const [customers, lines] = await Promise.all([
    query('customers', (c) => customerIds.has(c.id)),
    query('items', (item) => orderIds.has(item.order_id)),
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const itemsByOrder = Map.groupBy(lines, (item) => item.order_id);
  return orders.map((order) => ({
    ...order,
    customer: customerById.get(order.customer_id),
    items: itemsByOrder.get(order.id) ?? [],
  }));
}`,
    } },
    { tool: 'run_command', args: { command: 'npm test' } },
    { tool: 'run_command', args: { command: 'npm run bench' }, label: 'after' },
    { say: (r) => `\n\n**p99: ${p99(r.before)} → ${p99(r.after)}.**\n\n- \`GET /orders\` makes **3 queries** instead of 201: the orders, then every customer and every item in one query each, in parallel.\n- The response is unchanged, as you asked: the test that checks each order's customer and items still passes.`, cps: 220 },
  ],
  usage: { credits: 0, time: 52, context: 19210 },
};

// ── 3. A fleet of sub-agents moves a codebase to TypeScript ───────────────
const FOLDERS = [
  { dir: 'billing', files: ['invoice', 'tax', 'discounts'], model: 'GPT-6 Luna', delay: 0 },
  { dir: 'auth', files: ['session', 'passwords', 'roles'], model: 'Claude Haiku 5.5', delay: 350 },
  { dir: 'notify', files: ['email', 'templates', 'queue'], model: 'DeepSeek V4.1 Flash', delay: 700 },
  { dir: 'utils', files: ['money', 'dates', 'ids'], model: 'GLM 5.3 Flash', delay: 1050 },
];
const invoicely = {
  match: /TypeScript/i,
  model: 'claude-haiku-5-5',
  steps: [
    { title: 'Move invoicely to TypeScript' },
    { think: 800 },
    { say: 'Baseline first: how far is the code from `strict` TypeScript?' },
    { tool: 'run_command', args: { command: 'npx tsc --noEmit' }, label: 'before' },
    { say: (r) => {
      const count = (`${r.before?.stdout || ''}`.match(/error TS/g) || []).length;
      return `\n\n**${count} type errors** in 12 files across 4 folders. The folders only use each other's exports, so each one can go to its own sub-agent, in parallel:`;
    } },
    { agents: FOLDERS.map((f, i) => ({
      role: `src/${f.dir}`,
      task: `Convert src/${f.dir} to strict TypeScript. Keep every export's name and behaviour.`,
      model: f.model,
      delay: f.delay,
      credits: 0,
      summary: `src/${f.dir}: ${f.files.length} files converted, all parameters and return types annotated.`,
      steps: [
        { say: `Converting src/${f.dir}: renaming the files, then typing each export.` },
        { tool: 'run_command', args: { command: f.files.map((n) => `git mv src/${f.dir}/${n}.js src/${f.dir}/${n}.ts`).join(' && ') } },
        ...f.files.flatMap((n, j) => [
          { wait: 1300 + ((i + j) % 3) * 450 },
          { tool: 'fs_write', args: { path: `src/${f.dir}/${n}.ts`, content: typed(`${f.dir}/${n}.ts`) } },
        ]),
        { say: ' Done.' },
      ],
    })) },
    { say: '\n\nAll four are back. Checking the whole project together:' },
    { tool: 'run_command', args: { command: 'npx tsc --noEmit' }, label: 'after' },
    { say: (r) => {
      const count = (`${r.before?.stdout || ''}`.match(/error TS/g) || []).length;
      return `\n\n**${count} errors → 0.** All 12 files are TypeScript now, under \`strict\`.\n\n| Folder | Sub-agent | Files |\n|---|---|---|\n${FOLDERS.map((f) => `| \`src/${f.dir}\` | ${f.model} | ${f.files.length} |`).join('\n')}`;
    }, cps: 260 },
  ],
  usage: { credits: 0, time: 47, context: 24630 },
};

const turns = [
  wayfare,
  storefront,
  invoicely,
  { fallback: true, steps: [{ think: 600 }, { say: 'Sure. What would you like me to change?' }] },
];

module.exports = { turns, sessions, localState, DIRS };
