import type { QueuePriority, QueueSourceType, QueueStatus } from './enums';

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
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Minimal projection required to rank an item. The ranking engine depends only
 * on these fields, so callers can rank lightweight rows without loading the full
 * entity.
 */
export interface RankableItem {
  readonly status: QueueStatus;
  readonly priority: QueuePriority;
  readonly rankingTimestamp: Date;
  /** Stable, deterministic tiebreaker when timestamps are equal. */
  readonly permanentQueueId: string;
}

/** A ranked active item paired with its computed 1-based queue position. */
export interface RankedQueueItem<T extends RankableItem = RankableItem> {
  readonly item: T;
  /** 1-based position in the active queue (1 = next up). */
  readonly position: number;
}
