import { enqueue, backoff, type Job } from './queue.js';
import type { Email } from './templates.js';

export interface Transport {
  send(email: Email): Promise<{ id: string }>;
}

export async function deliver(job: Job, transport: Transport): Promise<boolean> {
  try {
    await transport.send(job.email);
    return true;
  } catch {
    job.attempts += 1;
    if (job.attempts < 5) enqueue(job.email, backoff(job));
    return false;
  }
}

export function isValidAddress(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}
