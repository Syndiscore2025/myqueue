/**
 * Global Jest setup. Runs before any test module is imported so that modules
 * which validate the environment at import time (e.g. `src/config`) have a
 * valid, deterministic configuration. These are non-secret test values only.
 */
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL ??= 'http://localhost:3000';
process.env.PORT ??= '3000';
process.env.LOG_LEVEL ??= 'silent';
process.env.DATABASE_URL ??=
  'postgresql://myqueue:myqueue@localhost:5432/myqueue_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
