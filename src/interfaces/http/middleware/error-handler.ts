import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import {
  type ApplicationError,
  InternalServerError,
  NotFoundError,
  ValidationError,
  isApplicationError,
} from '../../../domain/errors';
import { isProduction } from '../../../config';
import { logger } from '../../../utils/logger';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

function toApplicationError(error: unknown): ApplicationError {
  if (isApplicationError(error)) {
    return error;
  }
  if (error instanceof ZodError) {
    return new ValidationError('Request validation failed', { details: error.flatten() });
  }
  return new InternalServerError(undefined, { cause: error });
}

/** Terminal 404 handler for unmatched routes. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
};

/** Centralised error-handling middleware. Must be registered last. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toApplicationError(err);
  const requestId = typeof req.id === 'string' ? req.id : 'unknown';

  const log = req.log ?? logger;
  if (appError.isOperational) {
    log.warn(
      { err: appError, code: appError.code, statusCode: appError.statusCode },
      appError.message,
    );
  } else {
    log.error({ err: appError, code: appError.code }, appError.message);
  }

  if (res.headersSent) {
    return;
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.isOperational || !isProduction ? appError.message : 'Internal server error',
      requestId,
    },
  };

  if (appError.isOperational && appError.details !== undefined) {
    body.error.details = appError.details;
  }

  res.status(appError.statusCode).json(body);
};
