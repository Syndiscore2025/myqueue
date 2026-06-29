import rateLimit, { type RateLimitRequestHandler, type Store } from 'express-rate-limit';
import { env, isTest } from '../../../config';
import { RedisRateLimitStore } from '../../../infrastructure/rate-limit';

/**
 * Select the hit-count store. Outside tests the limiter is backed by Redis so
 * limits are shared across every API instance and survive restarts; tests use
 * the built-in in-memory store to avoid a Redis dependency.
 */
function createStore(): Store | undefined {
  return isTest ? undefined : new RedisRateLimitStore({ windowMs: env.RATE_LIMIT_WINDOW_MS });
}

/**
 * Global rate limiter applied to all API traffic. Uses the standardised
 * `RateLimit-*` response headers and a JSON error body consistent with the
 * application's error envelope. Keys default to the client IP; per-identity
 * keying is layered on once authentication establishes a trusted identity.
 *
 * `passOnStoreError` fails open: a Redis outage lets requests through rather
 * than rejecting all traffic.
 */
const baseOptions = {
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  passOnStoreError: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later.',
    },
  },
};

const store = createStore();

export const rateLimiter: RateLimitRequestHandler = rateLimit(
  store === undefined ? baseOptions : { ...baseOptions, store },
);
