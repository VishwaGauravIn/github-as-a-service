// ─── Custom Error Classes ───────────────────────────────────────────────────
//
// Every error GaaS throws is a subclass of GaaSError.
// This lets users do: catch (e) { if (e instanceof GaaSError) ... }

import type { ValidationFieldError } from './types.js';

/**
 * Base error class for all GaaS errors.
 */
export class GaaSError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'GaaSError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when GaaS configuration is invalid or missing.
 */
export class ConfigError extends GaaSError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

/**
 * Thrown when GitHub authentication fails.
 */
export class AuthenticationError extends GaaSError {
  constructor(message: string = 'GitHub authentication failed. Check your token and permissions.') {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when the GitHub API rate limit is exceeded.
 */
export class RateLimitError extends GaaSError {
  public readonly retryAfter: number;
  public readonly resetsAt: string;

  constructor(retryAfter: number, resetsAt: string) {
    super(
      `GitHub API rate limit exceeded. Retry after ${retryAfter} seconds (resets at ${resetsAt}).`,
      'RATE_LIMIT'
    );
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.resetsAt = resetsAt;
  }
}

/**
 * Thrown when a write conflict occurs (SHA mismatch).
 */
export class ConflictError extends GaaSError {
  public readonly filePath: string;

  constructor(filePath: string) {
    super(
      `Write conflict on "${filePath}". The file was modified by another process. Retry the operation.`,
      'CONFLICT'
    );
    this.name = 'ConflictError';
    this.filePath = filePath;
  }
}

/**
 * Thrown when a requested record or file is not found.
 */
export class NotFoundError extends GaaSError {
  public readonly resource: string;

  constructor(resource: string) {
    super(`Not found: "${resource}"`, 'NOT_FOUND');
    this.name = 'NotFoundError';
    this.resource = resource;
  }
}

/**
 * Thrown when schema validation fails.
 */
export class ValidationError extends GaaSError {
  public readonly errors: ValidationFieldError[];

  constructor(errors: ValidationFieldError[]) {
    const summary = errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    super(`Validation failed: ${summary}`, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

// ValidationFieldError is defined in types.ts

/**
 * Thrown when encryption/decryption fails.
 */
export class EncryptionError extends GaaSError {
  constructor(message: string) {
    super(message, 'ENCRYPTION_ERROR');
    this.name = 'EncryptionError';
  }
}

/**
 * Thrown when a GitHub API call fails for a non-specific reason.
 */
export class GitHubApiError extends GaaSError {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message, 'GITHUB_API_ERROR');
    this.name = 'GitHubApiError';
    this.status = status;
  }
}
