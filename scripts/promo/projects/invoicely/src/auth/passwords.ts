export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  problems: string[];
}

export function checkPassword(password: string, email: string): Strength {
  const problems: string[] = [];
  if (password.length < 12) problems.push('Use at least 12 characters.');
  if (!/[0-9]/.test(password)) problems.push('Add a number.');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Add a symbol.');
  if (password.toLowerCase().includes(email.split('@')[0].toLowerCase())) problems.push('Do not use your email in it.');
  const score = Math.max(0, 4 - problems.length) as Strength['score'];
  return { score, problems };
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}
