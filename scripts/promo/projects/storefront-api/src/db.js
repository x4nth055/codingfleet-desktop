// The Postgres client. In development it reads the seeded fixtures and adds
// the round trip our app servers see to the primary (~10 ms).
import { orders, customers, items } from './fixtures.js';

const ROUND_TRIP_MS = 10;
const tables = { orders, customers, items };
export let queryCount = 0;

export async function query(table, where = () => true, { limit = Infinity } = {}) {
  queryCount++;
  await new Promise((resolve) => setTimeout(resolve, ROUND_TRIP_MS));
  return tables[table].filter(where).slice(0, limit);
}

export function resetQueryCount() { queryCount = 0; }
