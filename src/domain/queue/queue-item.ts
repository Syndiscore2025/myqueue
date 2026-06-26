import type { QueueActivationReason, QueuePriority, QueueSourceType, QueueStatus } from './enums';

/**
 * A single tracked work item in an owner's queue.
 *
 * This is the framework-free domain shape. It carries a PERMANENT,
 * per-workspace identifier (`permanentQueueId`, e.g. `MQ-000842`) that never
 * changes. The visible "#position" is NOT stored here — it is computed on demand
 * by the ranking engine from `status`, `priority`, and `rankingTimestamp`.
 */
export interface QueueItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly permanentQueueId: string;
  readonly ownerWorkspaceUserId: string;
  readonly creatorWorkspaceUserId: string | null;
  readonly sourceType: QueueSourceType;
  readonly sourceSlackChannelId: string | null;
  readonly sourceSlackMessageTs: string | null;
  readonly sourceSlackThreadTs: string | null;
  readonly sourceSlackPermalink: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly status: QueueStatus;
  readonly priority: QueuePriority;
  /** Timestamp the ranking engine orders by (oldest first within a tier). */
  readonly rankingTimestamp: Date;
  readonly snoozedUntil: Date | null;
  readonly followUpDueAt: Date | null;
  readonly assignedAt: Date | null;
  readonly completedAt: Date | null;
  readonly archivedAt: Date | null;

  // Phase 3C — scheduling & orchestration fields.
  /** Single claim gate. Null = claimable immediately; future = not yet available. */
  readonly availableAt: Date | null;
  /** User-specified calendar time at which the item becomes claimable. Feeds availableAt. */
  readonly scheduledFor: Date | null;
  /** Delay expiry — feeds availableAt when a delay is applied after creation. */
  readonly delayUntil: Date | null;
  /** Set by dependency resolution when a blocking item has not yet finished. */
  readonly blockedUntil: Date | null;
  /** Why the scheduler moved this item back to claimable state. */
  readonly activationReason: QueueActivationReason | null;
  /** FK to the QueueRecurrenceRule that spawned this item, if any. */
  readonly recurrenceRuleId: string | null;
  /** ID of the first item created by a recurring rule (chain anchor). */
  readonly parentRecurringItemId: string | null;
  /** Key used to look up the rate-limit bucket for this item. */
  readonly rateLimitKey: string | null;
  /** Partition workers filter by. Null = global partition (all workers can claim). */
  readonly partitionKey: string | null;
  /** Logical group for dependency resolution (all members share a dependency set). */
  readonly dependencyGroupId: string | null;

  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Minimal projection required to rank an item. The ranking engine depends only
 * on these fields, so callers can rank lightweight rows without loading the full
 * entity.
 *
 * Phase 3C adds `availableAt` so the ranking engine can exclude future-dated
 * items from active queue positions (preventing scheduled/delayed items from
 * polluting visible rank numbers).
 */
export interface RankableItem {
  readonly status: QueueStatus;
  readonly priority: QueuePriority;
  readonly rankingTimestamp: Date;
  /** Stable, deterministic tiebreaker when timestamps are equal. */
  readonly permanentQueueId: string;
  /** Phase 3C — null means immediately available; future = not yet available. */
  readonly availableAt: Date | null;
}

/** A ranked active item paired with its computed 1-based queue position. */
export interface RankedQueueItem<T extends RankableItem = RankableItem> {
  readonly item: T;
  /** 1-based position in the active queue (1 = next up). */
  readonly position: number;
}
