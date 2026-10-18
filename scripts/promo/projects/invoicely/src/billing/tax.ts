import { money, type Money } from '../utils/money.js';

const VAT: Record<string, number> = { DE: 0.19, FR: 0.2, PT: 0.23, GB: 0.2, NL: 0.21 };

export function taxRate(country: string): number {
  return VAT[country.toUpperCase()] ?? 0;
}

export function taxFor(amount: Money, country: string): Money {
  return money(amount.cents * taxRate(country), amount.currency);
}

export function isReverseCharge(country: string, hasVatNumber: boolean): boolean {
  return hasVatNumber && taxRate(country) > 0 && country !== 'PT';
}
