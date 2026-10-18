export type Currency = 'USD' | 'EUR' | 'GBP';

export interface Money {
  cents: number;
  currency: Currency;
}

export function money(cents: number, currency: Currency = 'USD'): Money {
  return { cents: Math.round(cents), currency };
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Cannot add ${a.currency} to ${b.currency}`);
  return money(a.cents + b.cents, a.currency);
}

export function multiply(amount: Money, factor: number): Money {
  return money(amount.cents * factor, amount.currency);
}

export function format(amount: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: amount.currency }).format(amount.cents / 100);
}
