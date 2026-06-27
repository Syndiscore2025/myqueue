/**
 * Queue domain enumerations.
 *
 * These are framework-free, single-source-of-truth value sets for the queue
 * engine. Their members mirror the Prisma schema exactly (same string literals),
 * so repository code can pass them to/from Prisma without casts while the domain
 * layer stays free of any infrastructure import.
 */

/**
 * Lifecycle state of a queue item.
 *
 * `Processing` and `DeadLetter` are the Phase 3B processing states (additive —
 * the Phase 3A states are unchanged): `Processing` for an item currently claimed
 * by a worker, `DeadLetter` for an item that exhausted its retry budget.
 */
export const QueueStatus = {
  New: 'New',
  Working: 'Working',
  Waiting: 'Waiting',
  FollowUp: 'FollowUp',
  Snoozed: 'Snoozed',
  Done: 'Done',
  Archived: 'Archived',
  Processing: 'Processing',
  DeadLetter: 'DeadLetter',
} as const;
export type QueueStatus = (typeof QueueStatus)[keyof typeof QueueStatus];

/** Urgency of a queue item. Red = urgent, Yellow = needs attention, Green = low. */
export const QueuePriority = {
  Red: 'Red',
  Yellow: 'Yellow',
  Green: 'Green',
} as const;
export type QueuePriority = (typeof QueuePriority)[keyof typeof QueuePriority];

/** How an owner's active queue is ordered. */
export const QueueRankingMode = {
  FIFO: 'FIFO',
  PRIORITY: 'PRIORITY',
} as const;
export type QueueRankingMode = (typeof QueueRankingMode)[keyof typeof QueueRankingMode];

/** Origin of a queue item. */
export const QueueSourceType = {
  SLACK_MESSAGE: 'SLACK_MESSAGE',
  SLACK_COMMAND: 'SLACK_COMMAND',
  MANUAL: 'MANUAL',
  API: 'API',
} as const;
export type QueueSourceType = (typeof QueueSourceType)[keyof typeof QueueSourceType];

/**
 * Auditable queue actions recorded in the append-only event log.
 *
 * The trailing members are Phase 3B processing-lifecycle actions (additive).
 * Phase 3C adds scheduling/orchestration actions (additive). Phase 5 adds the
 * NOTIFIED action recorded when a user-facing DM notification is delivered.
 */
export const QueueEventType = {
  CREATED: 'CREATED',
  ASSIGNED: 'ASSIGNED',
  REASSIGNED: 'REASSIGNED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  MOVED_TO_WAITING: 'MOVED_TO_WAITING',
  MOVED_TO_FOLLOW_UP: 'MOVED_TO_FOLLOW_UP',
  SNOOZED: 'SNOOZED',
  UNSNOOZED: 'UNSNOOZED',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
  RECALCULATED: 'RECALCULATED',
  CLAIMED: 'CLAIMED',
  RELEASED: 'RELEASED',
  RECOVERED: 'RECOVERED',
  FAILED: 'FAILED',
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  DEAD_LETTERED: 'DEAD_LETTERED',
  REQUEUED: 'REQUEUED',
  // Phase 3C — scheduling & orchestration
  DELAYED: 'DELAYED',
  SCHEDULED: 'SCHEDULED',
  ACTIVATED: 'ACTIVATED',
  RECURRENCE_CREATED: 'RECURRENCE_CREATED',
  RECURRENCE_PAUSED: 'RECURRENCE_PAUSED',
  RECURRENCE_RESUMED: 'RECURRENCE_RESUMED',
  RECURRENCE_DISABLED: 'RECURRENCE_DISABLED',
  RECURRING_ITEM_CREATED: 'RECURRING_ITEM_CREATED',
  RATE_LIMITED: 'RATE_LIMITED',
  DEPENDENCY_BLOCKED: 'DEPENDENCY_BLOCKED',
  DEPENDENCY_UNBLOCKED: 'DEPENDENCY_UNBLOCKED',
  // Phase 5 — automation & notifications
  NOTIFIED: 'NOTIFIED',
} as const;
export type QueueEventType = (typeof QueueEventType)[keyof typeof QueueEventType];

/** Liveness of a registered worker process within a workspace. */
export const WorkerStatus = {
  ACTIVE: 'ACTIVE',
  IDLE: 'IDLE',
  DEAD: 'DEAD',
} as const;
export type WorkerStatus = (typeof WorkerStatus)[keyof typeof WorkerStatus];

/**
 * Rank weight of each priority for ordering (lower sorts first / higher up the
 * queue). Red outranks Yellow outranks Green.
 */
export const PRIORITY_RANK: Readonly<Record<QueuePriority, number>> = {
  [QueuePriority.Red]: 0,
  [QueuePriority.Yellow]: 1,
  [QueuePriority.Green]: 2,
};

/**
 * Why the scheduler moved an item back to claimable state. Mirrors the Prisma
 * enum `QueueActivationReason` without importing any infrastructure.
 */
export const QueueActivationReason = {
  SCHEDULED: 'SCHEDULED',
  DELAYED: 'DELAYED',
  SNOOZED: 'SNOOZED',
  DEPENDENCY_RESOLVED: 'DEPENDENCY_RESOLVED',
  RATE_LIMIT_CLEARED: 'RATE_LIMIT_CLEARED',
  MANUAL: 'MANUAL',
} as const;
export type QueueActivationReason =
  (typeof QueueActivationReason)[keyof typeof QueueActivationReason];

/**
 * How a dependent item reacts when its upstream dependency is dead-lettered.
 * Mirrors the Prisma enum `QueueDependencyType`.
 */
export const QueueDependencyType = {
  COMPLETE_REQUIRED: 'COMPLETE_REQUIRED',
  FAIL_IF_DEPENDENCY_FAILS: 'FAIL_IF_DEPENDENCY_FAILS',
  CONTINUE_IF_DEPENDENCY_FAILS: 'CONTINUE_IF_DEPENDENCY_FAILS',
} as const;
export type QueueDependencyType = (typeof QueueDependencyType)[keyof typeof QueueDependencyType];
