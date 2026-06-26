import { env } from '../../config';
import { QueueEventType, QueueStatus } from '../../domain/queue';
import type { QueueEventRepository, QueueItemRepository } from '../../infrastructure/repositories';
import { queueEventRepository, queueItemRepository } from '../../infrastructure/repositories';
import { createLogger } from '../../utils/logger';
import { eventPublisher, type EventPublisher } from './processing-events';

/** Collaborators the activation service orchestrates; injectable for testing. */
export interface QueueActivationServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  publisher?: EventPublisher;
}

/**
 * Application service that sweeps for time-gated items whose `availableAt` has
 * passed and returns them to `New` so workers can claim them.
 *
 * Phase 3C covers Snoozed items (Snoozed -> New when `available_at <= now()`).
 * Future slices extend this to other gated states (blocked, rate-limited).
 *
 * Each sweep is bounded by {@link Env.QUEUE_ACTIVATION_BATCH_SIZE} and uses
 * `FOR UPDATE SKIP LOCKED`, making it safe to run concurrently. The loop is
 * started by calling {@link start} in the worker process and stopped on graceful
 * shutdown via {@link stop}.
 */
export class QueueActivationService {
  private readonly items: QueueItemRepository;
  private readonly events: QueueEventRepository;
  private readonly publisher: EventPublisher;
  private readonly log = createLogger('queue-activation');
  private timer: NodeJS.Timeout | null = null;
  private sweepRunning = false;

  constructor(deps: QueueActivationServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.publisher = deps.publisher ?? eventPublisher;
  }

  /**
   * Run one activation sweep: wake due-snoozed items (up to
   * {@link Env.QUEUE_ACTIVATION_BATCH_SIZE}), audit each, and publish
   * `QueueItemActivated` events. Returns the number of items activated.
   */
  async activateBatch(now: Date = new Date()): Promise<number> {
    const activated = await this.items.activateDueSnoozed({
      batchSize: env.QUEUE_ACTIVATION_BATCH_SIZE,
      now,
    });
    for (const item of activated) {
      await this.events.record({
        workspaceId: item.workspaceId,
        queueItemId: item.id,
        eventType: QueueEventType.ACTIVATED,
        previousValue: QueueStatus.Snoozed,
        newValue: QueueStatus.New,
        metadata: { activationReason: 'SNOOZED' },
      });
      await this.publisher.publish({
        type: 'QueueItemActivated',
        workspaceId: item.workspaceId,
        queueItemId: item.id,
        permanentQueueId: item.permanentQueueId,
        activationReason: 'SNOOZED',
        occurredAt: now,
      });
    }
    if (activated.length > 0) {
      this.log.info({ count: activated.length }, 'activated due-snoozed queue items');
    }
    return activated.length;
  }

  /**
   * Start the background activation loop, running a sweep every
   * {@link Env.QUEUE_SCHEDULER_INTERVAL_SECONDS} seconds. Idempotent: calling
   * start while already running has no effect. The timer is unref'd so it does
   * not prevent the process from exiting if shutdown completes first.
   */
  start(): void {
    if (this.timer !== null) return;
    const intervalMs = env.QUEUE_SCHEDULER_INTERVAL_SECONDS * 1_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.log.info(
      {
        intervalSeconds: env.QUEUE_SCHEDULER_INTERVAL_SECONDS,
        batchSize: env.QUEUE_ACTIVATION_BATCH_SIZE,
      },
      'queue activation loop started',
    );
  }

  /** Stop the background activation loop. Idempotent. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log.info('queue activation loop stopped');
  }

  /** Single-invocation activation tick, guarded against overlapping runs. */
  private async tick(): Promise<void> {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      await this.activateBatch();
    } catch (err) {
      this.log.error({ err }, 'queue activation sweep failed');
    } finally {
      this.sweepRunning = false;
    }
  }
}

/** Process-wide activation service bound to the shared repository singletons. */
export const queueActivationService = new QueueActivationService();
