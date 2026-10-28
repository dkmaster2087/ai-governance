import { createHash, randomUUID } from 'crypto';

export function generateRequestId(): string {
  return randomUUID();
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function maskPII(text: string, placeholder = '[REDACTED]'): string {
  // Order matters: mask the longest digit patterns first so a shorter pattern (phone) can't
  // consume part of a card number and leave the rest of it visible.
  // Email
  let masked = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, placeholder);
  // Credit card (13-19 digits, optionally grouped by spaces or dashes)
  masked = masked.replace(/\b(?:\d{4}[\s-]?){3}\d{1,7}\b/g, (m) => (isLikelyCardNumber(m) ? placeholder : m));
  // SSN
  masked = masked.replace(/\b\d{3}-\d{2}-\d{4}\b/g, placeholder);
  // Phone (North American + international)
  masked = masked.replace(/(?<![\d+])(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, placeholder);
  return masked;
}

/** 13-19 digits that pass the Luhn checksum (filters out timestamps, order numbers, etc.). */
export function isLikelyCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function generateTenantId(): string {
  return `tenant_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
