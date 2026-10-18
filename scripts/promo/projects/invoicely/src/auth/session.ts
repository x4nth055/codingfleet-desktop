import { randomId } from '../utils/ids.js';
import { addDays, isOverdue } from '../utils/dates.js';
import type { Role } from './roles.js';

export interface Session {
  id: string;
  userId: string;
  role: Role;
  expiresAt: Date;
}

const sessions = new Map<string, Session>();

export function startSession(userId: string, role: Role, days = 14): Session {
  const session: Session = { id: randomId('ses'), userId, role, expiresAt: addDays(new Date(), days) };
  sessions.set(session.id, session);
  return session;
}

export function findSession(id: string): Session | undefined {
  const session = sessions.get(id);
  if (session && isOverdue(session.expiresAt)) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function endSession(id: string): boolean {
  return sessions.delete(id);
}
