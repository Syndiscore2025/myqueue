import type { QueueItem } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../domain/errors';
import { QueueEventType, QueueStatus } from '../../domain/queue';
import type { QueueEventRepository, QueueItemRepository } from '../../infrastructure/repositories';
import { queueEventRepository, queueItemRepository } from '../../infrastructure/repositories';
import type { QueueContext } from './queue-service';

/** Collaborators the dead-letter service orchestrates; injectable for testing. */
export interface QueueDeadLetterServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
}

/**
 * Application service for inspecting and recovering dead-lettered work. Items
 * land in the Dead Letter Queue when a worker exhausts their retry budget (see
 * {@link QueueClaimService.fail}). Operators can review them and explicitly
 * requeue an item, which clears its failure state and grants a fresh retry
 * budget (DeadLetter -> New). All operations are scoped by workspace.
 */
export class QueueDeadLetterService {
  private readonly items: QueueItemRepository;
  private readonly events: QueueEventRepository;

  constructor(deps: QueueDeadLetterServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
  }

  /** List the workspace's dead-lettered items, oldest dead-lettered first. */
  async list(ctx: QueueContext): Promise<QueueItem[]> {
    return this.items.listDeadLetter(ctx.workspaceId);
  }

  /**
   * Requeue a dead-lettered item back to the queue (DeadLetter -> New),
   * resetting its attempt count and clearing failure state. Throws
   * {@link NotFoundError} when the item does not exist in the workspace, or
   * {@link ConflictError} when it is not currently in the Dead Letter Queue.
   */
  async requeue(ctx: QueueContext, permanentQueueId: string): Promise<QueueItem> {
    const existing = await this.items.findByPermanentId(ctx.workspaceId, permanentQueueId);
    if (existing === null) {
      throw new NotFoundError(`Queue item ${permanentQueueId} not found`);
    }
    if (existing.status !== QueueStatus.DeadLetter) {
      throw new ConflictError(`Queue item ${permanentQueueId} is not in the Dead Letter Queue`);
    }
    const item = await this.items.requeueFromDeadLetter({
      workspaceId: ctx.workspaceId,
      permanentQueueId,
      now: new Date(),
    });
    if (item === null) {
      throw new ConflictError(`Queue item ${permanentQueueId} state changed concurrently`);
    }
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      eventType: QueueEventType.REQUEUED,
      actorWorkspaceUserId: ctx.workspaceUserId,
      previousValue: QueueStatus.DeadLetter,
      newValue: QueueStatus.New,
      metadata: { previousAttemptCount: existing.attemptCount },
    });
    return item;
  }
}

/** Process-wide dead-letter service bound to the shared repository singletons. */
export const queueDeadLetterService = new QueueDeadLetterService();
