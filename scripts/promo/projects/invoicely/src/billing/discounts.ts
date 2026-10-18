import { money, type Money } from '../utils/money.js';

export type Discount =
  | { kind: 'percent'; percent: number }
  | { kind: 'fixed'; amount: Money };

export function applyDiscount(amount: Money, discount: Discount): Money {
  if (discount.kind === 'percent') return money(amount.cents * (1 - discount.percent / 100), amount.currency);
  return money(Math.max(0, amount.cents - discount.amount.cents), amount.currency);
}

export function parseCode(code: string): Discount | null {
  const match = /^SAVE(\d{1,2})$/.exec(code.trim().toUpperCase());
  return match ? { kind: 'percent', percent: Number(match[1]) } : null;
}
