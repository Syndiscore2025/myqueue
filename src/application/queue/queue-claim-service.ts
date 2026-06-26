import type { QueueItem } from '@prisma/client';
import { env } from '../../config';
import { ConflictError, NotFoundError } from '../../domain/errors';
import { QueueEventType, QueueStatus } from '../../domain/queue';
import type {
  QueueDependencyRepository,
  QueueEventRepository,
  QueueItemRepository,
  WorkerRegistryRepository,
  WorkspaceQueueSettingsRepository,
} from '../../infrastructure/repositories';
import {
  queueDependencyRepository,
  queueEventRepository,
  queueItemRepository,
  workerRegistryRepository,
  workspaceQueueSettingsRepository,
} from '../../infrastructure/repositories';
import { eventPublisher, type EventPublisher } from './processing-events';

/** Identity of a worker acting within a tenant; the worker id comes from X-Worker-ID. */
export interface WorkerContext {
  readonly workspaceId: string;
  readonly workerId: string;
  /** Optional host the worker runs on, from X-Worker-Hostname, for the registry. */
  readonly hostname?: string;
}

/** Collaborators the claim service orchestrates; injectable for testing. */
export interface QueueClaimServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  settings?: WorkspaceQueueSettingsRepository;
  publisher?: EventPublisher;
  registry?: WorkerRegistryRepository;
  dependencies?: QueueDependencyRepository;
}

const MILLIS_PER_MINUTE = 60_000;

/**
 * Application service that hands queued work to workers. A claim atomically
 * selects the highest-ranked `New` item for the workspace under
 * `FOR UPDATE SKIP LOCKED` and moves it to `Processing`, so no two workers ever
 * receive the same item even under heavy concurrency. The lease expires after
 * {@link Env.QUEUE_LOCK_MINUTES} unless refreshed by a heartbeat.
 */
export class QueueClaimService {
  private readonly items: QueueItemRepository;
  private readonly events: QueueEventRepository;
  private readonly settings: WorkspaceQueueSettingsRepository;
  private readonly publisher: EventPublisher;
  private readonly registry: WorkerRegistryRepository;
  private readonly dependencies: QueueDependencyRepository;

  constructor(deps: QueueClaimServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.settings = deps.settings ?? workspaceQueueSettingsRepository;
    this.publisher = deps.publisher ?? eventPublisher;
    this.registry = deps.registry ?? workerRegistryRepository;
    this.dependencies = deps.dependencies ?? queueDependencyRepository;
  }

  /**
   * Auto-register the worker (or refresh its liveness), called on every claim
   * and heartbeat so workers appear in the registry from their first activity
   * and keep `lastSeenAt` current. See {@link WorkerRegistryService}.
   */
  private async touchWorker(ctx: WorkerContext, now: Date): Promise<void> {
    await this.registry.register({
      workspaceId: ctx.workspaceId,
      workerId: ctx.workerId,
      hostname: ctx.hostname ?? null,
      now,
    });
  }

  /**
   * Atomically claim the next queued item for a worker, returning it moved to
   * `Processing`, or null when the workspace has nothing queued. Ordering honors
   * the workspace ranking mode (FIFO or PRIORITY).
   */
  async claim(ctx: WorkerContext): Promise<QueueItem | null> {
    const settings = await this.settings.ensure(ctx.workspaceId);
    const now = new Date();
    await this.touchWorker(ctx, now);
    const lockExpiresAt = new Date(now.getTime() + env.QUEUE_LOCK_MINUTES * MILLIS_PER_MINUTE);
    const item = await this.items.claimNext({
      workspaceId: ctx.workspaceId,
      workerId: ctx.workerId,
      rankingMode: settings.rankingMode,
      lockExpiresAt,
      now,
    });
    if (item === null) {
      return null;
    }
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      eventType: QueueEventType.CLAIMED,
      previousValue: QueueStatus.New,
      newValue: QueueStatus.Processing,
      metadata: { workerId: ctx.workerId },
    });
    await this.publisher.publish({
      type: 'QueueItemClaimed',
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      permanentQueueId: item.permanentQueueId,
      workerId: ctx.workerId,
      occurredAt: item.claimedAt ?? now,
    });
    return item;
  }

  /**
   * Extend the lease on an item the worker is actively processing, refreshing
   * its heartbeat and pushing back the lock expiry by {@link Env.QUEUE_LOCK_MINUTES}.
   * Heartbeats are high-frequency liveness signals, so they intentionally emit no
   * audit or processing event. Throws {@link NotFoundError} when the item does
   * not exist in the workspace, or {@link ConflictError} when it is no longer
   * leased by this worker (e.g. it was recovered after a missed heartbeat).
   */
  async heartbeat(ctx: WorkerContext, permanentQueueId: string): Promise<QueueItem> {
    const now = new Date();
    await this.touchWorker(ctx, now);
    const lockExpiresAt = new Date(now.getTime() + env.QUEUE_LOCK_MINUTES * MILLIS_PER_MINUTE);
    const item = await this.items.extendLease({
      workspaceId: ctx.workspaceId,
      workerId: ctx.workerId,
      permanentQueueId,
      heartbeatAt: now,
      lockExpiresAt,
    });
    if (item !== null) {
      return item;
    }
    const existing = await this.items.findByPermanentId(ctx.workspaceId, permanentQueueId);
    if (existing === null) {
      throw new NotFoundError(`Queue item ${permanentQueueId} not found`);
    }
    throw new ConflictError(
      `Queue item ${permanentQueueId} is not currently leased by worker ${ctx.workerId}`,
    );
  }

  /** Helper: verify the given worker owns a Processing item, returning it or throwing. */
  private async requireLeasedItem(
    ctx: WorkerContext,
    permanentQueueId: string,
  ): Promise<QueueItem> {
    const item = await this.items.findByPermanentId(ctx.workspaceId, permanentQueueId);
    if (item === null) {
      throw new NotFoundError(`Queue item ${permanentQueueId} not found`);
    }
    if (item.status !== QueueStatus.Processing || item.claimedByWorkerId !== ctx.workerId) {
      throw new ConflictError(
        `Queue item ${permanentQueueId} is not currently leased by worker ${ctx.workerId}`,
      );
    }
    return item;
  }

  /**
   * Complete processing an item (Processing → Done). Clears the lease and
   * stamps processing completion timestamps. Throws NotFoundError if the item
   * doesn't exist, or ConflictError if it is not leased by this worker.
   */
  async complete(ctx: WorkerContext, permanentQueueId: string): Promise<QueueItem> {
    await this.requireLeasedItem(ctx, permanentQueueId);
    const now = new Date();
    const item = await this.items.completeProcessing({
      workspaceId: ctx.workspaceId,
      workerId: ctx.workerId,
      permanentQueueId,
      now,
    });
    if (item === null) {
      throw new ConflictError(`Queue item ${permanentQueueId} state changed concurrently`);
    }
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      eventType: QueueEventType.COMPLETED,
      previousValue: QueueStatus.Processing,
      newValue: QueueStatus.Done,
      metadata: { workerId: ctx.workerId },
    });
    await this.publisher.publish({
      type: 'QueueItemCompleted',
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      permanentQueueId: item.permanentQueueId,
      workerId: ctx.workerId,
      occurredAt: now,
    });
    await this.resolveDependencies(item.id, ctx.workspaceId, 'Done');
    return item;
  }

  /**
   * Release an item back to the queue without marking it as failed
   * (Processing → New). Attempt count is not incremented. Throws NotFoundError
   * or ConflictError when the worker does not hold the lease.
   */
  async release(ctx: WorkerContext, permanentQueueId: string): Promise<QueueItem> {
    await this.requireLeasedItem(ctx, permanentQueueId);
    const now = new Date();
    const item = await this.items.releaseProcessing({
      workspaceId: ctx.workspaceId,
      workerId: ctx.workerId,
      permanentQueueId,
      now,
    });
    if (item === null) {
      throw new ConflictError(`Queue item ${permanentQueueId} state changed concurrently`);
    }
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      eventType: QueueEventType.RELEASED,
      previousValue: QueueStatus.Processing,
      newValue: QueueStatus.New,
      metadata: { workerId: ctx.workerId },
    });
    await this.publisher.publish({
      type: 'QueueItemReleased',
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      permanentQueueId: item.permanentQueueId,
      workerId: ctx.workerId,
      occurredAt: now,
    });
    return item;
  }

  /**
   * Report that processing an item failed. Increments the attempt count, then
   * either re-queues it (Processing → New, RetryScheduled) when retries remain,
   * or moves it to the Dead Letter Queue (Processing → DeadLetter, QueueItemFailed)
   * when MAX_RETRIES is exhausted. Throws NotFoundError or ConflictError.
   */
  async fail(
    ctx: WorkerContext,
    permanentQueueId: string,
    opts: { error?: string | null; errorStack?: string | null } = {},
  ): Promise<QueueItem> {
    const current = await this.requireLeasedItem(ctx, permanentQueueId);
    const now = new Date();
    const newAttemptCount = current.attemptCount + 1;
    const isDeadLetter = newAttemptCount >= env.QUEUE_MAX_RETRIES;
    const newStatus = isDeadLetter ? QueueStatus.DeadLetter : QueueStatus.New;
    const item = await this.items.failProcessing({
      workspaceId: ctx.workspaceId,
      workerId: ctx.workerId,
      permanentQueueId,
      newStatus,
      lastError: opts.error ?? null,
      lastErrorStack: opts.errorStack ?? null,
      now,
    });
    if (item === null) {
      throw new ConflictError(`Queue item ${permanentQueueId} state changed concurrently`);
    }
    // Always record FAILED audit event; then follow-on event based on outcome.
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      eventType: QueueEventType.FAILED,
      previousValue: QueueStatus.Processing,
      newValue: newStatus,
      metadata: {
        workerId: ctx.workerId,
        attemptCount: newAttemptCount,
        error: opts.error ?? null,
      },
    });
    if (isDeadLetter) {
      await this.events.record({
        workspaceId: ctx.workspaceId,
        queueItemId: item.id,
        eventType: QueueEventType.DEAD_LETTERED,
        previousValue: QueueStatus.Processing,
        newValue: QueueStatus.DeadLetter,
        metadata: { workerId: ctx.workerId, attemptCount: newAttemptCount },
      });
    } else {
      await this.events.record({
        workspaceId: ctx.workspaceId,
        queueItemId: item.id,
        eventType: QueueEventType.RETRY_SCHEDULED,
        previousValue: QueueStatus.Processing,
        newValue: QueueStatus.New,
        metadata: { workerId: ctx.workerId, attemptCount: newAttemptCount },
      });
    }
    await this.publisher.publish({
      type: 'QueueItemFailed',
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      permanentQueueId: item.permanentQueueId,
      workerId: ctx.workerId,
      attemptCount: newAttemptCount,
      error: opts.error ?? null,
      occurredAt: now,
    });
    if (isDeadLetter) {
      await this.publisher.publish({
        type: 'DeadLetterCreated',
        workspaceId: ctx.workspaceId,
        queueItemId: item.id,
        permanentQueueId: item.permanentQueueId,
        workerId: ctx.workerId,
        attemptCount: newAttemptCount,
        error: opts.error ?? null,
        occurredAt: now,
      });
      await this.resolveDependencies(item.id, ctx.workspaceId, 'DeadLetter');
    } else {
      await this.publisher.publish({
        type: 'RetryScheduled',
        workspaceId: ctx.workspaceId,
        queueItemId: item.id,
        permanentQueueId: item.permanentQueueId,
        workerId: ctx.workerId,
        attemptCount: newAttemptCount,
        occurredAt: now,
      });
    }
    return item;
  }

  /**
   * After an item reaches a terminal status (Done or DeadLetter), resolve any
   * downstream dependency edges:
   *  - Done upstream: unblock all dependents (DEPENDENCY_UNBLOCKED event).
   *  - DeadLetter upstream: unblock CONTINUE_IF_DEPENDENCY_FAILS edges;
   *    dead-letter FAIL_IF_DEPENDENCY_FAILS edges (DEAD_LETTERED event).
   */
  async resolveDependencies(
    upstreamItemId: string,
    upstreamWorkspaceId: string,
    finalStatus: 'Done' | 'DeadLetter',
  ): Promise<void> {
    const { toUnblock, toDeadLetter } = await this.dependencies.findResolvableDependents(
      upstreamItemId,
      finalStatus,
    );
    for (const dep of toUnblock) {
      await this.events.record({
        workspaceId: dep.workspaceId,
        queueItemId: dep.queueItemId,
        eventType: QueueEventType.DEPENDENCY_UNBLOCKED,
        newValue: finalStatus,
        metadata: { upstreamItemId, resolvedBy: finalStatus },
      });
    }
    for (const dep of toDeadLetter) {
      await this.items.updateScoped(upstreamWorkspaceId, dep.queueItemId, {
        status: QueueStatus.DeadLetter,
      });
      await this.events.record({
        workspaceId: dep.workspaceId,
        queueItemId: dep.queueItemId,
        eventType: QueueEventType.DEAD_LETTERED,
        previousValue: QueueStatus.New,
        newValue: QueueStatus.DeadLetter,
        metadata: { reason: 'FAIL_IF_DEPENDENCY_FAILS', upstreamItemId },
      });
    }
  }
}

/** Process-wide claim service bound to the shared repository singletons. */
export const queueClaimService = new QueueClaimService();
