const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomId(prefix: string, length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}_${out}`;
}

export function invoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(5, '0')}`;
}

export function isId(value: string, prefix: string): boolean {
  return new RegExp(`^${prefix}_[${ALPHABET}]+$`).test(value);
}
