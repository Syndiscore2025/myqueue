import { logger } from '../utils/logger';
import { registerShutdownHandlers } from '../utils/process-lifecycle';
import { connectRedis, disconnectRedis } from '../infrastructure/redis/redis';
import { connectDatabase, disconnectDatabase } from '../infrastructure/database/prisma';
import { queueManager } from '../queues';
import { queueRecoveryService } from '../application/queue';

/**
 * Background worker process entrypoint.
 *
 * Phase 3B: starts the queue recovery loop which sweeps for expired
 * `Processing` items on a configurable interval (QUEUE_RECOVERY_INTERVAL),
 * returning abandoned work to `New` so it can be claimed again.
 */
async function bootstrap(): Promise<void> {
  await Promise.allSettled([connectDatabase(), connectRedis()]);

  queueRecoveryService.start();
  logger.info('worker runtime started with queue recovery loop');

  registerShutdownHandlers(async () => {
    queueRecoveryService.stop();
    await queueManager.closeAll();
    await disconnectRedis();
    await disconnectDatabase();
  });
}

void bootstrap();
