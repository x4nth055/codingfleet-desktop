import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listOrders } from '../src/routes/orders.js';

test('lists the latest 100 orders, newest first', async () => {
  const orders = await listOrders();
  assert.equal(orders.length, 100);
  assert.ok(orders[0].created_at > orders[99].created_at);
});
