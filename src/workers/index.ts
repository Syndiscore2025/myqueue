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
import {
  digestService,
  followUpReminderService,
  notificationService,
} from '../application/notifications';

/**
 * Background worker process entrypoint.
 *
 * Phase 3B: starts the queue recovery loop (expired Processing -> New).
 * Phase 3C: starts the queue activation loop (due Snoozed -> New via availableAt)
 *           and the recurrence loop (cron rules -> QueueItems).
 * Phase 5:  DMs the owner when a snoozed item wakes back into the active queue,
 *           runs the follow-up reminder loop (due FollowUp items -> DM), and runs
 *           the daily digest loop (per-workspace hourly -> per-owner summary DM).
 */
async function bootstrap(): Promise<void> {
  await Promise.allSettled([connectDatabase(), connectRedis()]);

  // Wire snooze wake-up notifications onto the activation loop. Fire-and-forget:
  // the activation sweep never waits on or fails because of DM delivery.
  queueActivationService.setOnActivated((item) => {
    void notificationService
      .notifySnoozeWake(item.workspaceId, item.id)
      .catch((err: unknown) =>
        logger.error(
          { err, workspaceId: item.workspaceId, queueItemId: item.id },
          'snooze wake-up notification failed',
        ),
      );
  });

  queueRecoveryService.start();
  queueActivationService.start();
  queueRecurrenceService.start();
  followUpReminderService.start();
  digestService.start();
  logger.info(
    'worker runtime started with queue recovery, activation, recurrence, follow-up reminder, and daily digest loops',
  );

  registerShutdownHandlers(async () => {
    digestService.stop();
    followUpReminderService.stop();
    queueRecurrenceService.stop();
    queueActivationService.stop();
    queueRecoveryService.stop();
    await queueManager.closeAll();
    await disconnectRedis();
    await disconnectDatabase();
  });
}

void bootstrap();
