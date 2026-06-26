import type { Prisma, PrismaClient, QueueItem } from '@prisma/client';
import { QueuePriority, QueueSourceType, QueueStatus } from '../../domain/queue';
import { getPrisma } from '../database/prisma';

/** Width of the zero-padded numeric portion of a permanent queue id. */
const PERMANENT_ID_PAD = 6;

/** Format a per-workspace sequence number as a permanent queue id (e.g. MQ-000842). */
export function formatPermanentQueueId(seq: number): string {
  return `MQ-${String(seq).padStart(PERMANENT_ID_PAD, '0')}`;
}

/** Fields accepted when creating a queue item. The permanent id is minted here. */
export interface CreateQueueItemInput {
  workspaceId: string;
  ownerWorkspaceUserId: string;
  title: string;
  creatorWorkspaceUserId?: string | null;
  summary?: string | null;
  status?: QueueStatus;
  priority?: QueuePriority;
  sourceType?: QueueSourceType;
  sourceSlackChannelId?: string | null;
  sourceSlackMessageTs?: string | null;
  sourceSlackThreadTs?: string | null;
  sourceSlackPermalink?: string | null;
  rankingTimestamp?: Date;
}

/** Mutable fields of a queue item that may be changed after creation. */
export interface QueueItemUpdate {
  status?: QueueStatus;
  priority?: QueuePriority;
  ownerWorkspaceUserId?: string;
  title?: string;
  summary?: string | null;
  rankingTimestamp?: Date;
  snoozedUntil?: Date | null;
  followUpDueAt?: Date | null;
  assignedAt?: Date | null;
  completedAt?: Date | null;
  archivedAt?: Date | null;
}

/** Filters for listing an owner's items. */
export interface ListByOwnerOptions {
  statuses?: readonly QueueStatus[];
}

/**
 * Tenant-scoped persistence for queue items. Creation atomically mints a
 * per-workspace permanent id by incrementing the workspace's queue sequence
 * counter inside a transaction. All reads and writes are scoped by workspaceId.
 */
export class QueueItemRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Create an item, minting a unique permanent id atomically per workspace. */
  async create(input: CreateQueueItemInput): Promise<QueueItem> {
    return this.prisma.$transaction(async (tx) => {
      const settings = await tx.workspaceQueueSettings.upsert({
        where: { workspaceId: input.workspaceId },
        create: { workspaceId: input.workspaceId, lastQueueSeq: 1 },
        update: { lastQueueSeq: { increment: 1 } },
      });
      const permanentQueueId = formatPermanentQueueId(settings.lastQueueSeq);
      return tx.queueItem.create({
        data: {
          workspaceId: input.workspaceId,
          permanentQueueId,
          ownerWorkspaceUserId: input.ownerWorkspaceUserId,
          creatorWorkspaceUserId: input.creatorWorkspaceUserId ?? null,
          title: input.title,
          summary: input.summary ?? null,
          status: input.status ?? QueueStatus.New,
          priority: input.priority ?? QueuePriority.Green,
          sourceType: input.sourceType ?? QueueSourceType.MANUAL,
          sourceSlackChannelId: input.sourceSlackChannelId ?? null,
          sourceSlackMessageTs: input.sourceSlackMessageTs ?? null,
          sourceSlackThreadTs: input.sourceSlackThreadTs ?? null,
          sourceSlackPermalink: input.sourceSlackPermalink ?? null,
          ...(input.rankingTimestamp === undefined
            ? {}
            : { rankingTimestamp: input.rankingTimestamp }),
        },
      });
    });
  }

  /** Resolve an item by id, scoped to its workspace (tenant isolation). */
  async findById(workspaceId: string, id: string): Promise<QueueItem | null> {
    return this.prisma.queueItem.findFirst({ where: { id, workspaceId } });
  }

  /** Resolve an item by its permanent queue id within a workspace. */
  async findByPermanentId(
    workspaceId: string,
    permanentQueueId: string,
  ): Promise<QueueItem | null> {
    return this.prisma.queueItem.findUnique({
      where: { workspaceId_permanentQueueId: { workspaceId, permanentQueueId } },
    });
  }

  /** List an owner's items within a workspace, optionally filtered by status. */
  async listByOwner(
    workspaceId: string,
    ownerWorkspaceUserId: string,
    options: ListByOwnerOptions = {},
  ): Promise<QueueItem[]> {
    const where: Prisma.QueueItemWhereInput = { workspaceId, ownerWorkspaceUserId };
    if (options.statuses !== undefined) {
      where.status = { in: [...options.statuses] };
    }
    return this.prisma.queueItem.findMany({ where, orderBy: { rankingTimestamp: 'asc' } });
  }

  /**
   * Apply mutable changes to an item, scoped by workspace. Returns the updated
   * row, or null when no item with that id exists in the workspace.
   */
  async updateScoped(
    workspaceId: string,
    id: string,
    changes: QueueItemUpdate,
  ): Promise<QueueItem | null> {
    const result = await this.prisma.queueItem.updateMany({
      where: { id, workspaceId },
      data: changes,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.queueItem.findFirst({ where: { id, workspaceId } });
  }
}

/** Process-wide queue item repository bound to the shared Prisma client. */
export const queueItemRepository = new QueueItemRepository();
