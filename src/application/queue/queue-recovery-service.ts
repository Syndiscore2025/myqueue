import { env } from '../../config';
import { QueueEventType, QueueStatus } from '../../domain/queue';
import type { QueueEventRepository, QueueItemRepository } from '../../infrastructure/repositories';
import { queueEventRepository, queueItemRepository } from '../../infrastructure/repositories';
import { createLogger } from '../../utils/logger';
import { eventPublisher, type EventPublisher } from './processing-events';

/** Collaborators the recovery service orchestrates; injectable for testing. */
export interface QueueRecoveryServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  publisher?: EventPublisher;
}

/**
 * Application service that sweeps for `Processing` items whose lease has
 * expired and returns them to `New` so another worker can claim them.
 *
 * Each sweep is bounded by {@link Env.QUEUE_RECOVERY_BATCH_SIZE} and uses
 * `FOR UPDATE SKIP LOCKED`, making it safe to run concurrently with other
 * sweeps or with worker claim operations. The recovery loop is started by
 * calling {@link start} in the worker process and stopped on graceful shutdown
 * via {@link stop}.
 */
export class QueueRecoveryService {
  private readonly items: QueueItemRepository;
  private readonly events: QueueEventRepository;
  private readonly publisher: EventPublisher;
  private readonly log = createLogger('queue-recovery');
  private timer: NodeJS.Timeout | null = null;
  private sweepRunning = false;

  constructor(deps: QueueRecoveryServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.publisher = deps.publisher ?? eventPublisher;
  }

  /**
   * Run one recovery sweep: reclaim expired-lock items (up to
   * {@link Env.QUEUE_RECOVERY_BATCH_SIZE}), audit each, and publish
   * `QueueRecovered` events. Returns the number of items recovered.
   */
  async recoverExpired(now: Date = new Date()): Promise<number> {
    const recovered = await this.items.recoverExpired({
      batchSize: env.QUEUE_RECOVERY_BATCH_SIZE,
      now,
    });
    for (const item of recovered) {
      await this.events.record({
        workspaceId: item.workspaceId,
        queueItemId: item.id,
        eventType: QueueEventType.RECOVERED,
        previousValue: QueueStatus.Processing,
        newValue: QueueStatus.New,
        metadata: {
          previousWorkerId: item.previousWorkerId,
          attemptCount: item.attemptCount,
        },
      });
      await this.publisher.publish({
        type: 'QueueRecovered',
        workspaceId: item.workspaceId,
        queueItemId: item.id,
        permanentQueueId: item.permanentQueueId,
        previousWorkerId: item.previousWorkerId,
        attemptCount: item.attemptCount,
        occurredAt: now,
      });
    }
    if (recovered.length > 0) {
      this.log.info({ count: recovered.length }, 'recovered expired queue locks');
    }
    return recovered.length;
  }

  /**
   * Start the background recovery loop, running a sweep every
   * {@link Env.QUEUE_RECOVERY_INTERVAL} seconds. Idempotent: calling start
   * while already running has no effect. The timer is unref'd so it does not
   * prevent the process from exiting if shutdown completes first.
   */
  start(): void {
    if (this.timer !== null) return;
    const intervalMs = env.QUEUE_RECOVERY_INTERVAL * 1_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.log.info(
      { intervalSeconds: env.QUEUE_RECOVERY_INTERVAL, batchSize: env.QUEUE_RECOVERY_BATCH_SIZE },
      'queue recovery loop started',
    );
  }

  /** Stop the background recovery loop. Idempotent. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log.info('queue recovery loop stopped');
  }

  /** Single-invocation recovery tick, guarded against overlapping runs. */
  private async tick(): Promise<void> {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      await this.recoverExpired();
    } catch (err) {
      this.log.error({ err }, 'queue recovery sweep failed');
    } finally {
      this.sweepRunning = false;
    }
  }
}

/** Process-wide recovery service bound to the shared repository singletons. */
export const queueRecoveryService = new QueueRecoveryService();
