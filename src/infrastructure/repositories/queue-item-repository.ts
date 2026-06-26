import { Prisma, type PrismaClient, type QueueItem } from '@prisma/client';
import { QueuePriority, QueueRankingMode, QueueSourceType, QueueStatus } from '../../domain/queue';
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

/** Inputs for atomically claiming the next queued item for a worker. */
export interface ClaimNextParams {
  workspaceId: string;
  workerId: string;
  rankingMode: QueueRankingMode;
  lockExpiresAt: Date;
  /** Clock instant for the claim timestamps; defaults to now. */
  now?: Date;
}

/** Inputs for extending the lease on an item a worker is actively processing. */
export interface ExtendLeaseParams {
  workspaceId: string;
  workerId: string;
  permanentQueueId: string;
  heartbeatAt: Date;
  lockExpiresAt: Date;
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

  /**
   * Atomically claim the highest-ranked `New` item for a worker, moving it to
   * `Processing` and stamping the lease. The candidate row is selected with
   * `FOR UPDATE SKIP LOCKED` inside a transaction so concurrent workers never
   * contend for or receive the same item — each skips rows already locked by
   * another in-flight claim. Returns the updated item, or null when the
   * workspace has no queued items available to claim.
   */
  async claimNext(params: ClaimNextParams): Promise<QueueItem | null> {
    const now = params.now ?? new Date();
    const orderBy =
      params.rankingMode === QueueRankingMode.PRIORITY
        ? Prisma.sql`"priority" ASC, "ranking_timestamp" ASC, "permanent_queue_id" ASC`
        : Prisma.sql`"ranking_timestamp" ASC, "permanent_queue_id" ASC`;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id"
        FROM "queue_items"
        WHERE "workspace_id" = ${params.workspaceId}
          AND "status" = CAST(${QueueStatus.New} AS "QueueStatus")
        ORDER BY ${orderBy}
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const candidate = rows[0];
      if (candidate === undefined) {
        return null;
      }
      return tx.queueItem.update({
        where: { id: candidate.id },
        data: {
          status: QueueStatus.Processing,
          claimedByWorkerId: params.workerId,
          claimedAt: now,
          heartbeatAt: now,
          lockExpiresAt: params.lockExpiresAt,
          processingStartedAt: now,
        },
      });
    });
  }

  /**
   * Extend the lease on an item the worker is actively processing, refreshing
   * `heartbeat_at` and `lock_expires_at`. The update only applies when the item
   * is still `Processing` and still owned by this worker, so a worker that has
   * already lost its lease (e.g. recovered after a missed heartbeat) cannot
   * silently reclaim it. Returns the refreshed item, or null when no matching
   * leased row exists.
   */
  async extendLease(params: ExtendLeaseParams): Promise<QueueItem | null> {
    const result = await this.prisma.queueItem.updateMany({
      where: {
        workspaceId: params.workspaceId,
        permanentQueueId: params.permanentQueueId,
        status: QueueStatus.Processing,
        claimedByWorkerId: params.workerId,
      },
      data: { heartbeatAt: params.heartbeatAt, lockExpiresAt: params.lockExpiresAt },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.queueItem.findUnique({
      where: {
        workspaceId_permanentQueueId: {
          workspaceId: params.workspaceId,
          permanentQueueId: params.permanentQueueId,
        },
      },
    });
  }
}

/** Process-wide queue item repository bound to the shared Prisma client. */
export const queueItemRepository = new QueueItemRepository();
