import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../../../config';

/**
 * Global rate limiter applied to all API traffic. Uses the standardised
 * `RateLimit-*` response headers and a JSON error body consistent with the
 * application's error envelope.
 */
export const rateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later.',
    },
  },
});
