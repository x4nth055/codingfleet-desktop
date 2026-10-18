import type { Email } from './templates.js';

export interface Job {
  email: Email;
  attempts: number;
  runAt: Date;
}

const jobs: Job[] = [];

export function enqueue(email: Email, delayMs = 0): Job {
  const job: Job = { email, attempts: 0, runAt: new Date(Date.now() + delayMs) };
  jobs.push(job);
  return job;
}

export function due(now: Date = new Date()): Job[] {
  return jobs.filter((job) => job.runAt.getTime() <= now.getTime());
}

export function backoff(job: Job): number {
  return Math.min(60 * 60_000, 2 ** job.attempts * 30_000);
}
