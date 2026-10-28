export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class PolicyViolationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('POLICY_VIOLATION', message, 403, details);
    this.name = 'PolicyViolationError';
  }
}

export class TenantNotFoundError extends AppError {
  constructor(tenantId: string) {
    super('TENANT_NOT_FOUND', `Tenant ${tenantId} not found`, 404);
    this.name = 'TenantNotFoundError';
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string) {
    super('PROVIDER_ERROR', `Provider ${provider}: ${message}`, 502);
    this.name = 'ProviderError';
  }
}

export class RateLimitError extends AppError {
  constructor(tenantId: string) {
    super('RATE_LIMIT_EXCEEDED', `Rate limit exceeded for tenant ${tenantId}`, 429);
    this.name = 'RateLimitError';
  }
}

/** A governance dependency (policy engine, data protection) could not be reached, and the tenant fails closed. */
export class GovernanceUnavailableError extends AppError {
  constructor(public readonly dependency: 'policy-engine' | 'data-protection', message?: string) {
    super('GOVERNANCE_UNAVAILABLE', message ?? `Request blocked: ${dependency} is unavailable`, 503);
    this.name = 'GovernanceUnavailableError';
  }
}
