const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function isOverdue(due: Date, now: Date = new Date()): boolean {
  return now.getTime() > due.getTime();
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
