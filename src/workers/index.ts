import { logger } from '../utils/logger';
import { registerShutdownHandlers } from '../utils/process-lifecycle';
import { connectRedis, disconnectRedis } from '../infrastructure/redis/redis';
import { connectDatabase, disconnectDatabase } from '../infrastructure/database/prisma';
import { queueManager } from '../queues';

/**
 * Background worker process entrypoint.
 *
 * Phase 1 establishes the worker runtime and lifecycle only. No job processors
 * are registered yet — later phases will register workers through the shared
 * {@link queueManager}. Running this process now simply boots the runtime,
 * verifies connectivity, and waits for work to be registered.
 */
async function bootstrap(): Promise<void> {
  await Promise.allSettled([connectDatabase(), connectRedis()]);
  logger.info('worker runtime started; no processors registered (Phase 1)');

  registerShutdownHandlers(async () => {
    await queueManager.closeAll();
    await disconnectRedis();
    await disconnectDatabase();
  });
}

void bootstrap();
