import { query } from '../db.js';

// GET /orders: the latest 100 orders, each with its customer and items.
export async function listOrders() {
  const orders = await query('orders', () => true, { limit: 100 });
  const result = [];
  for (const order of orders) {
    const [customer] = await query('customers', (c) => c.id === order.customer_id);
    const lines = await query('items', (item) => item.order_id === order.id);
    result.push({ ...order, customer, items: lines });
  }
  return result;
}
