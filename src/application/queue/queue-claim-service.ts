import type { QueueItem } from '@prisma/client';
import { env } from '../../config';
import { QueueEventType, QueueStatus } from '../../domain/queue';
import type {
  QueueEventRepository,
  QueueItemRepository,
  WorkspaceQueueSettingsRepository,
} from '../../infrastructure/repositories';
import {
  queueEventRepository,
  queueItemRepository,
  workspaceQueueSettingsRepository,
} from '../../infrastructure/repositories';
import { eventPublisher, type EventPublisher } from './processing-events';

/** Identity of a worker acting within a tenant; the worker id comes from X-Worker-ID. */
export interface WorkerContext {
  readonly workspaceId: string;
  readonly workerId: string;
}

/** Collaborators the claim service orchestrates; injectable for testing. */
export interface QueueClaimServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  settings?: WorkspaceQueueSettingsRepository;
  publisher?: EventPublisher;
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

  constructor(deps: QueueClaimServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.settings = deps.settings ?? workspaceQueueSettingsRepository;
    this.publisher = deps.publisher ?? eventPublisher;
  }

  /**
   * Atomically claim the next queued item for a worker, returning it moved to
   * `Processing`, or null when the workspace has nothing queued. Ordering honors
   * the workspace ranking mode (FIFO or PRIORITY).
   */
  async claim(ctx: WorkerContext): Promise<QueueItem | null> {
    const settings = await this.settings.ensure(ctx.workspaceId);
    const now = new Date();
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
}

/** Process-wide claim service bound to the shared repository singletons. */
export const queueClaimService = new QueueClaimService();
