import type { Server } from 'node:http';
import { createApp } from './interfaces/http/app';
import { env } from './config';
import { appInfo } from './config/app-info';
import { logger } from './utils/logger';
import { registerShutdownHandlers } from './utils/process-lifecycle';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/prisma';
import { connectRedis, disconnectRedis } from './infrastructure/redis/redis';
import { queueManager } from './queues';

/**
 * Eagerly connect to external dependencies. Failures are logged but do not
 * abort startup: the readiness probe will report the instance as not-ready
 * until connectivity is restored, which is the desired behaviour under
 * orchestration.
 */
async function connectDependencies(): Promise<void> {
  const results = await Promise.allSettled([connectDatabase(), connectRedis()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason }, 'failed to connect a dependency at startup');
    }
  }
}

async function bootstrap(): Promise<void> {
  await connectDependencies();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, version: appInfo.version },
      `${appInfo.name} API listening`,
    );
  });

  registerShutdownHandlers(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await queueManager.closeAll();
    await disconnectRedis();
    await disconnectDatabase();
  });
}

void bootstrap();
