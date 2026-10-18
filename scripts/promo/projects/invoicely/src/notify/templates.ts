import { format } from '../utils/money.js';
import { isoDay } from '../utils/dates.js';
import type { Invoice } from '../billing/invoice.js';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export function invoiceEmail(invoice: Invoice, to: string): Email {
  return {
    to,
    subject: `Invoice ${invoice.number}: ${format(invoice.total)}`,
    text: `Your invoice ${invoice.number} for ${format(invoice.total)} is due on ${isoDay(invoice.dueAt)}.`,
  };
}

export function reminderEmail(invoice: Invoice, to: string, daysLate: number): Email {
  return {
    to,
    subject: `Reminder: invoice ${invoice.number} is ${daysLate} days overdue`,
    text: `Invoice ${invoice.number} (${format(invoice.total)}) was due on ${isoDay(invoice.dueAt)}.`,
  };
}
