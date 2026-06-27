/** Options accepted by every {@link ApplicationError}. */
export interface ApplicationErrorOptions {
  /** Structured, client-safe context describing the failure. */
  details?: unknown;
  /**
   * Whether this error is an expected, handled condition (true) versus an
   * unexpected programming/infrastructure fault (false). Defaults to true.
   */
  isOperational?: boolean;
  /** Underlying cause, preserved for logging. */
  cause?: unknown;
}

/**
 * Base class for all application errors. Carries an HTTP status code and a
 * stable machine-readable error code so the HTTP layer can render consistent
 * responses without leaking internal details.
 */
export abstract class ApplicationError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly isOperational: boolean;
  readonly details: unknown;

  constructor(message: string, options: ApplicationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.isOperational = options.isOperational ?? true;
    this.details = options.details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends ApplicationError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

export class UnauthorizedError extends ApplicationError {
  readonly statusCode = 401;
  readonly code = 'UNAUTHORIZED';
}

export class ForbiddenError extends ApplicationError {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
}

export class NotFoundError extends ApplicationError {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

export class ConflictError extends ApplicationError {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
}

/**
 * Raised when an action is blocked by the workspace's billing plan — e.g. a plan
 * entitlement limit was reached. Maps to HTTP 402 so clients can distinguish a
 * billing/upgrade condition from a permission failure (403).
 */
export class PaymentRequiredError extends ApplicationError {
  readonly statusCode = 402;
  readonly code = 'PLAN_LIMIT_EXCEEDED';
}

export class InternalServerError extends ApplicationError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_SERVER_ERROR';

  constructor(message = 'An unexpected error occurred', options: ApplicationErrorOptions = {}) {
    super(message, { isOperational: false, ...options });
  }
}

/** Type guard for {@link ApplicationError}. */
export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
