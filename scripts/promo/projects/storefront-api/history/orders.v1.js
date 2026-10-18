import { query } from '../db.js';

// GET /orders: the latest 100 orders, each with its customer and items.
export async function listOrders() {
  const orders = await query('orders', () => true, { limit: 100 });
  return orders.map((order) => ({ ...order }));
}
