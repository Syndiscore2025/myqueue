import { PRIORITY_RANK, QueueRankingMode, QueueStatus } from './enums';
import type { RankableItem, RankedQueueItem } from './queue-item';

/**
 * Settings that govern which items count toward the active queue and how that
 * queue is ordered. These mirror the per-workspace WorkspaceQueueSettings.
 */
export interface RankingOptions {
  readonly mode: QueueRankingMode;
  /** Whether `Working` items appear in the active queue (default behavior: yes). */
  readonly includeWorkingInActive: boolean;
  /** Whether `Waiting` items appear in the active queue (default behavior: no). */
  readonly includeWaitingInActive: boolean;
}

/**
 * Decide whether a status belongs to the active queue under the given options.
 *
 * `New` is always active. `Working` and `Waiting` are configurable. Every other
 * status (`FollowUp`, `Snoozed`, `Done`, `Archived`) is never part of the active
 * queue — those live in their own views.
 */
export function isActiveStatus(status: QueueStatus, options: RankingOptions): boolean {
  switch (status) {
    case QueueStatus.New:
      return true;
    case QueueStatus.Working:
      return options.includeWorkingInActive;
    case QueueStatus.Waiting:
      return options.includeWaitingInActive;
    default:
      return false;
  }
}

/** Filter a set of items down to those that are active under `options`. */
export function filterActive<T extends RankableItem>(
  items: readonly T[],
  options: RankingOptions,
): T[] {
  return items.filter((item) => isActiveStatus(item.status, options));
}

/**
 * Ordering comparator for two active items.
 *
 * FIFO: oldest `rankingTimestamp` first. PRIORITY: by priority tier (Red, then
 * Yellow, then Green), then oldest first within a tier. Both modes use
 * `permanentQueueId` as a final, deterministic tiebreaker so equal timestamps
 * never produce an unstable order.
 */
export function compareForRanking(
  a: RankableItem,
  b: RankableItem,
  mode: QueueRankingMode,
): number {
  if (mode === QueueRankingMode.PRIORITY) {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) {
      return byPriority;
    }
  }

  const byTime = a.rankingTimestamp.getTime() - b.rankingTimestamp.getTime();
  if (byTime !== 0) {
    return byTime;
  }

  return a.permanentQueueId.localeCompare(b.permanentQueueId);
}

/**
 * Rank an owner's items into their active queue with 1-based positions.
 *
 * Non-active items are dropped. Positions are assigned purely from the computed
 * order, so completing or removing any item (even out of order) and re-ranking
 * the remainder yields a correct, gap-free sequence — positions are never stored
 * as identity.
 */
export function rankActiveQueue<T extends RankableItem>(
  items: readonly T[],
  options: RankingOptions,
): RankedQueueItem<T>[] {
  const active = filterActive(items, options);
  active.sort((a, b) => compareForRanking(a, b, options.mode));
  return active.map((item, index) => ({ item, position: index + 1 }));
}

/**
 * Find the 1-based position of a single item within its owner's active queue,
 * or `null` when the item is not part of the active queue.
 */
export function positionOf<T extends RankableItem>(
  target: T,
  items: readonly T[],
  options: RankingOptions,
  isSame: (a: T, b: T) => boolean,
): number | null {
  if (!isActiveStatus(target.status, options)) {
    return null;
  }
  const ranked = rankActiveQueue(items, options);
  const match = ranked.find((entry) => isSame(entry.item, target));
  return match ? match.position : null;
}
