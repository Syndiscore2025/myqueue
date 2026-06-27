import { env } from '../../config';
import { QueueEventType, QueueStatus } from '../../domain/queue';
import type {
  ActivatedItem,
  QueueEventRepository,
  QueueItemRepository,
} from '../../infrastructure/repositories';
import { queueEventRepository, queueItemRepository } from '../../infrastructure/repositories';
import { createLogger } from '../../utils/logger';
import { eventPublisher, type EventPublisher } from './processing-events';

/**
 * Hook fired once per activated item. Side effects (e.g. a snooze wake-up DM)
 * live here so the activation loop stays decoupled from notifications. Invoked
 * fire-and-forget: it must not throw, and the activation never waits on it.
 */
export type ActivationHook = (item: ActivatedItem) => void;

/** Collaborators the activation service orchestrates; injectable for testing. */
export interface QueueActivationServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  publisher?: EventPublisher;
  onActivated?: ActivationHook;
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
  private onActivated: ActivationHook | undefined;

  constructor(deps: QueueActivationServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.publisher = deps.publisher ?? eventPublisher;
    // Optional by design: omitted (e.g. in unit tests) means no hook runs.
    this.onActivated = deps.onActivated;
  }

  /**
   * Register (or replace) the per-item activation hook. Used by the worker
   * bootstrap to wire snooze wake-up notifications onto the shared singleton.
   */
  setOnActivated(hook: ActivationHook): void {
    this.onActivated = hook;
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
      this.fireOnActivated(item);
    }
    if (activated.length > 0) {
      this.log.info({ count: activated.length }, 'activated due-snoozed queue items');
    }
    return activated.length;
  }

  /**
   * Run the activation hook for one item, fully guarded: a missing hook is a
   * no-op and any synchronous error is logged and swallowed so a misbehaving
   * side effect never breaks the sweep.
   */
  private fireOnActivated(item: ActivatedItem): void {
    if (this.onActivated === undefined) return;
    try {
      this.onActivated(item);
    } catch (err) {
      this.log.error(
        { err, workspaceId: item.workspaceId, queueItemId: item.id },
        'activation hook failed',
      );
    }
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
