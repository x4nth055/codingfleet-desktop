import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listOrders } from '../src/routes/orders.js';

test('lists the latest 100 orders, newest first', async () => {
  const orders = await listOrders();
  assert.equal(orders.length, 100);
  assert.ok(orders[0].created_at > orders[99].created_at);
});

test('each order comes with its customer and items', async () => {
  const [order] = await listOrders();
  assert.equal(order.customer.id, order.customer_id);
  assert.ok(order.items.length > 0);
  assert.ok(order.items.every((item) => item.order_id === order.id));
});
