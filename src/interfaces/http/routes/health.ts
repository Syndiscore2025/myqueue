import { Router } from 'express';
import { appInfo } from '../../../config/app-info';
import { env } from '../../../config';
import { checkDatabaseHealth } from '../../../infrastructure/database/prisma';
import { checkRedisHealth } from '../../../infrastructure/redis/redis';
import { asyncHandler } from '../../../utils/async-handler';

export const healthRouter = Router();

/**
 * Liveness probe. Confirms the process is running and able to serve requests.
 * Intentionally performs no dependency checks so orchestrators do not restart a
 * healthy process during a transient datastore blip.
 */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness probe. Verifies critical dependencies (PostgreSQL, Redis) before
 * the instance is allowed to receive traffic.
 */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
    const ready = database && redis;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    });
  }),
);

/** Build/version information for diagnostics and deploy verification. */
healthRouter.get('/version', (_req, res) => {
  res.status(200).json({
    name: appInfo.name,
    version: appInfo.version,
    nodeEnv: env.NODE_ENV,
    node: process.version,
  });
});
