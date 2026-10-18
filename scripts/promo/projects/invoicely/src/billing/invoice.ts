import { add, money, multiply, type Currency, type Money } from '../utils/money.js';
import { addDays } from '../utils/dates.js';
import { invoiceNumber } from '../utils/ids.js';
import { applyDiscount, type Discount } from './discounts.js';
import { taxFor } from './tax.js';

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: Money;
}

export interface Invoice {
  number: string;
  customerId: string;
  country: string;
  lines: LineItem[];
  issuedAt: Date;
  dueAt: Date;
  subtotal: Money;
  tax: Money;
  total: Money;
}

export function lineTotal(line: LineItem): Money {
  return multiply(line.unitPrice, line.quantity);
}

export function subtotal(lines: LineItem[], currency: Currency): Money {
  return lines.reduce((sum, line) => add(sum, lineTotal(line)), money(0, currency));
}

export function createInvoice(
  customerId: string,
  country: string,
  lines: LineItem[],
  sequence: number,
  discount?: Discount,
  issuedAt: Date = new Date(),
): Invoice {
  const currency = lines[0]?.unitPrice.currency ?? 'USD';
  const before = subtotal(lines, currency);
  const net = discount ? applyDiscount(before, discount) : before;
  const tax = taxFor(net, country);
  return {
    number: invoiceNumber(issuedAt.getFullYear(), sequence),
    customerId,
    country,
    lines,
    issuedAt,
    dueAt: addDays(issuedAt, 30),
    subtotal: net,
    tax,
    total: add(net, tax),
  };
}
