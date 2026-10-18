// Load test for GET /orders: 8 requests, 4 at a time. npm run bench
import { listOrders } from '../src/routes/orders.js';
import { queryCount, resetQueryCount } from '../src/db.js';

const TOTAL = 8;
const CONCURRENCY = 4;
const times = [];
resetQueryCount();
const started = performance.now();
for (let i = 0; i < TOTAL; i += CONCURRENCY) {
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    const t0 = performance.now();
    await listOrders();
    times.push(performance.now() - t0);
  }));
}
const elapsed = (performance.now() - started) / 1000;
times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)];
const ms = (n) => `${Math.round(n).toLocaleString('en-US')} ms`.padStart(9);
console.log(`GET /orders  ${TOTAL} requests, ${CONCURRENCY} concurrent\n`);
console.log(`  p50  ${ms(pct(50))}`);
console.log(`  p95  ${ms(pct(95))}`);
console.log(`  p99  ${ms(pct(99))}`);
console.log(`\n  ${(TOTAL / elapsed).toFixed(1)} req/s · ${Math.round(queryCount / TOTAL)} queries per request`);
