import { createHash, randomUUID } from 'crypto';

export function generateRequestId(): string {
  return randomUUID();
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function maskPII(text: string, placeholder = '[REDACTED]'): string {
  // Email
  let masked = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, placeholder);
  // Phone (North American + international)
  masked = masked.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, placeholder);
  // SSN
  masked = masked.replace(/\b\d{3}-\d{2}-\d{4}\b/g, placeholder);
  // Credit card
  masked = masked.replace(/\b(?:\d{4}[\s-]?){3}\d{4}\b/g, placeholder);
  return masked;
}

export function generateTenantId(): string {
  return `tenant_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
