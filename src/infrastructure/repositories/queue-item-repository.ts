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
 * A queue item that was reclaimed by the recovery sweep, carrying only the fields
 * required for subsequent auditing and event emission.
 */
export interface RecoveredItem {
  id: string;
  workspaceId: string;
  permanentQueueId: string;
  /** Attempt count AFTER incrementing (i.e. the new value stamped on the row). */
  attemptCount: number;
  /** The worker id that held the lease before recovery (may be null). */
  previousWorkerId: string | null;
}

/** Inputs for a single batch recovery sweep. */
export interface RecoverExpiredParams {
  /** Maximum number of expired-lock rows to reclaim in this sweep. */
  batchSize: number;
  /** Clock instant used as the "now" threshold; defaults to new Date(). */
  now?: Date;
}

/** Inputs for a worker completing processing an item (Processing -> Done). */
export interface CompleteProcessingParams {
  workspaceId: string;
  workerId: string;
  permanentQueueId: string;
  now?: Date;
}

/** Inputs for a worker gracefully releasing an item back to the queue (Processing -> New). */
export interface ReleaseProcessingParams {
  workspaceId: string;
  workerId: string;
  permanentQueueId: string;
  now?: Date;
}

/** Inputs for a worker reporting that processing an item failed. */
export interface FailProcessingParams {
  workspaceId: string;
  workerId: string;
  permanentQueueId: string;
  /** Status to apply: New (retry) or DeadLetter (exhausted). */
  newStatus: QueueStatus;
  lastError?: string | null;
  lastErrorStack?: string | null;
  now?: Date;
}

/** Inputs for an operator requeuing a dead-lettered item (DeadLetter -> New). */
export interface RequeueDeadLetterParams {
  workspaceId: string;
  permanentQueueId: string;
  now?: Date;
}

/**
 * Aggregate statistics for a workspace's queue. Durations are milliseconds and
 * null when no item contributes to that measure (e.g. nothing queued yet).
 */
export interface QueueStatistics {
  /** Item counts keyed by status; every status is present (zero when empty). */
  counts: Record<QueueStatus, number>;
  /** Mean enqueue-to-processing-start time over items that have started. */
  averageWaitTimeMs: number | null;
  /** Mean processing duration over items that finished processing. */
  averageProcessingTimeMs: number | null;
  /** Sum of attempt_count across all items (total processing attempts/retries). */
  totalRetries: number;
  /** Mean attempt_count across all items. */
  averageRetryCount: number | null;
  /** Oldest currently-queued (New) item's creation time. */
  oldestQueuedAt: Date | null;
  /** Newest currently-queued (New) item's creation time. */
  newestQueuedAt: Date | null;
  /** Mean age (now - created_at) of currently-queued (New) items. */
  averageQueueAgeMs: number | null;
  /** Age (now - processing_started_at) of the longest in-flight Processing job. */
  longestProcessingJobMs: number | null;
}

/** Shape of the single-row raw aggregate query backing {@link QueueStatistics}. */
interface StatisticsAggregateRow {
  oldestQueuedAt: Date | null;
  newestQueuedAt: Date | null;
  averageQueueAgeMs: number | null;
  averageWaitTimeMs: number | null;
  averageProcessingTimeMs: number | null;
  longestProcessingJobMs: number | null;
  totalRetries: number;
  averageRetryCount: number | null;
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

  /**
   * Atomically recover all `Processing` items whose lease has expired, returning
   * them to `New` and incrementing `attempt_count`. Uses a CTE with
   * `FOR UPDATE SKIP LOCKED` so concurrent recovery sweeps never double-recover
   * the same row. Returns the recovered items so the caller can audit each one.
   */
  async recoverExpired(params: RecoverExpiredParams): Promise<RecoveredItem[]> {
    const now = params.now ?? new Date();
    return this.prisma.$queryRaw<RecoveredItem[]>(Prisma.sql`
      WITH expired AS (
        SELECT "id", "claimed_by_worker_id" AS "previousWorkerId"
        FROM "queue_items"
        WHERE "status" = CAST(${QueueStatus.Processing} AS "QueueStatus")
          AND "lock_expires_at" < ${now}
        ORDER BY "lock_expires_at" ASC
        LIMIT ${params.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "queue_items" q
      SET "status" = CAST(${QueueStatus.New} AS "QueueStatus"),
          "attempt_count" = q."attempt_count" + 1,
          "claimed_by_worker_id" = NULL,
          "claimed_at" = NULL,
          "heartbeat_at" = NULL,
          "lock_expires_at" = NULL,
          "processing_started_at" = NULL,
          "updated_at" = now()
      FROM expired
      WHERE q."id" = expired."id"
      RETURNING
        q."id",
        q."workspace_id" AS "workspaceId",
        q."permanent_queue_id" AS "permanentQueueId",
        q."attempt_count" AS "attemptCount",
        expired."previousWorkerId"
    `);
  }

  /** Complete processing an item (Processing -> Done), owned by the given worker. */
  async completeProcessing(params: CompleteProcessingParams): Promise<QueueItem | null> {
    const now = params.now ?? new Date();
    const result = await this.prisma.queueItem.updateMany({
      where: {
        workspaceId: params.workspaceId,
        permanentQueueId: params.permanentQueueId,
        status: QueueStatus.Processing,
        claimedByWorkerId: params.workerId,
      },
      data: {
        status: QueueStatus.Done,
        completedAt: now,
        processingCompletedAt: now,
        lockExpiresAt: null,
        heartbeatAt: null,
      },
    });
    if (result.count === 0) return null;
    return this.prisma.queueItem.findUnique({
      where: {
        workspaceId_permanentQueueId: {
          workspaceId: params.workspaceId,
          permanentQueueId: params.permanentQueueId,
        },
      },
    });
  }

  /** Release an item back to the queue without failure (Processing -> New). */
  async releaseProcessing(params: ReleaseProcessingParams): Promise<QueueItem | null> {
    const result = await this.prisma.queueItem.updateMany({
      where: {
        workspaceId: params.workspaceId,
        permanentQueueId: params.permanentQueueId,
        status: QueueStatus.Processing,
        claimedByWorkerId: params.workerId,
      },
      data: {
        status: QueueStatus.New,
        claimedByWorkerId: null,
        claimedAt: null,
        heartbeatAt: null,
        lockExpiresAt: null,
        processingStartedAt: null,
      },
    });
    if (result.count === 0) return null;
    return this.prisma.queueItem.findUnique({
      where: {
        workspaceId_permanentQueueId: {
          workspaceId: params.workspaceId,
          permanentQueueId: params.permanentQueueId,
        },
      },
    });
  }

  /** Record a failure and apply the determined next status (retry=New or DLQ=DeadLetter). */
  async failProcessing(params: FailProcessingParams): Promise<QueueItem | null> {
    const now = params.now ?? new Date();
    const result = await this.prisma.queueItem.updateMany({
      where: {
        workspaceId: params.workspaceId,
        permanentQueueId: params.permanentQueueId,
        status: QueueStatus.Processing,
        claimedByWorkerId: params.workerId,
      },
      data: {
        status: params.newStatus,
        attemptCount: { increment: 1 },
        lastError: params.lastError ?? null,
        lastErrorStack: params.lastErrorStack ?? null,
        failedAt: now,
        deadLetteredAt: params.newStatus === QueueStatus.DeadLetter ? now : null,
        claimedByWorkerId: null,
        claimedAt: null,
        heartbeatAt: null,
        lockExpiresAt: null,
        processingStartedAt: null,
      },
    });
    if (result.count === 0) return null;
    return this.prisma.queueItem.findUnique({
      where: {
        workspaceId_permanentQueueId: {
          workspaceId: params.workspaceId,
          permanentQueueId: params.permanentQueueId,
        },
      },
    });
  }

  /** List a workspace's dead-lettered items, oldest dead-lettered first. */
  async listDeadLetter(workspaceId: string): Promise<QueueItem[]> {
    return this.prisma.queueItem.findMany({
      where: { workspaceId, status: QueueStatus.DeadLetter },
      orderBy: { deadLetteredAt: 'asc' },
    });
  }

  /**
   * Requeue a dead-lettered item back to the queue (DeadLetter -> New),
   * resetting the attempt count and clearing all failure/lease state so it gets
   * a fresh processing budget. Returns null when no DeadLetter item with that id
   * exists in the workspace.
   */
  async requeueFromDeadLetter(params: RequeueDeadLetterParams): Promise<QueueItem | null> {
    const result = await this.prisma.queueItem.updateMany({
      where: {
        workspaceId: params.workspaceId,
        permanentQueueId: params.permanentQueueId,
        status: QueueStatus.DeadLetter,
      },
      data: {
        status: QueueStatus.New,
        attemptCount: 0,
        lastError: null,
        lastErrorStack: null,
        failedAt: null,
        deadLetteredAt: null,
        claimedByWorkerId: null,
        claimedAt: null,
        heartbeatAt: null,
        lockExpiresAt: null,
        processingStartedAt: null,
        processingCompletedAt: null,
      },
    });
    if (result.count === 0) return null;
    return this.prisma.queueItem.findUnique({
      where: {
        workspaceId_permanentQueueId: {
          workspaceId: params.workspaceId,
          permanentQueueId: params.permanentQueueId,
        },
      },
    });
  }

  /**
   * Count the items each worker is currently processing in a workspace, keyed by
   * worker id. Derived live from item state so it never drifts from recovery,
   * completion, or failure (which return items to other statuses). Workers with
   * nothing in flight are simply absent from the map.
   */
  async countProcessingByWorker(workspaceId: string): Promise<Record<string, number>> {
    const groups = await this.prisma.queueItem.groupBy({
      by: ['claimedByWorkerId'],
      where: {
        workspaceId,
        status: QueueStatus.Processing,
        claimedByWorkerId: { not: null },
      },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const group of groups) {
      if (group.claimedByWorkerId !== null) {
        counts[group.claimedByWorkerId] = group._count._all;
      }
    }
    return counts;
  }

  /**
   * Compute aggregate statistics for a workspace's queue: counts per status plus
   * timing/retry measures. Counts come from a grouped tally; the timing and retry
   * aggregates come from a single filtered raw query so each measure is scoped to
   * the items it applies to. Timestamps are cast to timestamptz on both sides so
   * duration math is independent of the column's timezone configuration.
   */
  async getStatistics(workspaceId: string, now: Date = new Date()): Promise<QueueStatistics> {
    const [groups, rows] = await Promise.all([
      this.prisma.queueItem.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<StatisticsAggregateRow[]>(Prisma.sql`
        SELECT
          MIN("created_at") FILTER (WHERE "status" = CAST(${QueueStatus.New} AS "QueueStatus"))
            AS "oldestQueuedAt",
          MAX("created_at") FILTER (WHERE "status" = CAST(${QueueStatus.New} AS "QueueStatus"))
            AS "newestQueuedAt",
          AVG(EXTRACT(EPOCH FROM (${now}::timestamptz - "created_at"::timestamptz)) * 1000)
            FILTER (WHERE "status" = CAST(${QueueStatus.New} AS "QueueStatus")) AS "averageQueueAgeMs",
          AVG(EXTRACT(EPOCH FROM ("processing_started_at"::timestamptz - "created_at"::timestamptz)) * 1000)
            FILTER (WHERE "processing_started_at" IS NOT NULL) AS "averageWaitTimeMs",
          AVG(EXTRACT(EPOCH FROM ("processing_completed_at"::timestamptz - "processing_started_at"::timestamptz)) * 1000)
            FILTER (WHERE "processing_completed_at" IS NOT NULL AND "processing_started_at" IS NOT NULL)
            AS "averageProcessingTimeMs",
          MAX(EXTRACT(EPOCH FROM (${now}::timestamptz - "processing_started_at"::timestamptz)) * 1000)
            FILTER (
              WHERE "status" = CAST(${QueueStatus.Processing} AS "QueueStatus")
                AND "processing_started_at" IS NOT NULL
            ) AS "longestProcessingJobMs",
          CAST(COALESCE(SUM("attempt_count"), 0) AS INTEGER) AS "totalRetries",
          AVG("attempt_count")::double precision AS "averageRetryCount"
        FROM "queue_items"
        WHERE "workspace_id" = ${workspaceId}
      `),
    ]);
    const counts = Object.fromEntries(Object.values(QueueStatus).map((s) => [s, 0])) as Record<
      QueueStatus,
      number
    >;
    for (const group of groups) {
      counts[group.status] = group._count._all;
    }
    const agg = rows[0];
    return {
      counts,
      oldestQueuedAt: agg?.oldestQueuedAt ?? null,
      newestQueuedAt: agg?.newestQueuedAt ?? null,
      averageQueueAgeMs: agg?.averageQueueAgeMs ?? null,
      averageWaitTimeMs: agg?.averageWaitTimeMs ?? null,
      averageProcessingTimeMs: agg?.averageProcessingTimeMs ?? null,
      longestProcessingJobMs: agg?.longestProcessingJobMs ?? null,
      totalRetries: agg?.totalRetries ?? 0,
      averageRetryCount: agg?.averageRetryCount ?? null,
    };
  }
}

/** Process-wide queue item repository bound to the shared Prisma client. */
export const queueItemRepository = new QueueItemRepository();
