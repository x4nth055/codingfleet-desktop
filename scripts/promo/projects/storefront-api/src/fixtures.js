// Seeded development data: 400 customers, 1,000 orders, 3,000 items.
const names = ['Ada', 'Grace', 'Linus', 'Margaret', 'Ken', 'Barbara', 'Dennis', 'Frances', 'Alan', 'Radia'];
export const customers = Array.from({ length: 400 }, (_, i) => ({
  id: i + 1, name: `${names[i % names.length]} ${String.fromCharCode(65 + (i % 26))}.`, tier: i % 7 === 0 ? 'gold' : 'standard',
}));
export const orders = Array.from({ length: 1000 }, (_, i) => ({
  id: 1000 - i, customer_id: (i * 37) % 400 + 1, total_cents: 1299 + ((i * 7919) % 25000),
  status: ['paid', 'shipped', 'delivered'][i % 3], created_at: new Date(Date.UTC(2026, 9, 17) - i * 3.6e6).toISOString(),
}));
export const items = orders.flatMap((o) => [1, 2, 3].map((n) => ({
  id: o.id * 10 + n, order_id: o.id, sku: `SKU-${(o.id * n) % 997}`, qty: n,
})));
