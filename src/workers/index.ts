import { logger } from '../utils/logger';
import { registerShutdownHandlers } from '../utils/process-lifecycle';
import { connectRedis, disconnectRedis } from '../infrastructure/redis/redis';
import { connectDatabase, disconnectDatabase } from '../infrastructure/database/prisma';
import { queueManager } from '../queues';
import {
  queueActivationService,
  queueRecoveryService,
  queueRecurrenceService,
} from '../application/queue';

/**
 * Background worker process entrypoint.
 *
 * Phase 3B: starts the queue recovery loop (expired Processing -> New).
 * Phase 3C: starts the queue activation loop (due Snoozed -> New via availableAt)
 *           and the recurrence loop (cron rules -> QueueItems).
 */
async function bootstrap(): Promise<void> {
  await Promise.allSettled([connectDatabase(), connectRedis()]);

  queueRecoveryService.start();
  queueActivationService.start();
  queueRecurrenceService.start();
  logger.info('worker runtime started with queue recovery, activation, and recurrence loops');

  registerShutdownHandlers(async () => {
    queueRecurrenceService.stop();
    queueActivationService.stop();
    queueRecoveryService.stop();
    await queueManager.closeAll();
    await disconnectRedis();
    await disconnectDatabase();
  });
}

void bootstrap();
