import { z } from 'zod';
import {
  QueuePriority,
  QueueRankingMode,
  QueueSourceType,
  QueueStatus,
  WorkerStatus,
} from '../../../domain/queue';

/** Reusable enum schemas mirroring the domain value sets. */
export const queueStatusSchema = z.nativeEnum(QueueStatus);
export const queuePrioritySchema = z.nativeEnum(QueuePriority);
export const queueSourceTypeSchema = z.nativeEnum(QueueSourceType);
export const queueRankingModeSchema = z.nativeEnum(QueueRankingMode);
export const workerStatusSchema = z.nativeEnum(WorkerStatus);

/** Body for creating a queue item. Priority is auto-classified when omitted. */
export const createItemSchema = z.object({
  title: z.string().min(1).max(500),
  summary: z.string().max(5000).nullish(),
  ownerWorkspaceUserId: z.string().min(1).optional(),
  priority: queuePrioritySchema.optional(),
  sourceType: queueSourceTypeSchema.optional(),
});

/** Body for an explicit status transition, with optional timing side-data. */
export const changeStatusSchema = z.object({
  toStatus: queueStatusSchema,
  snoozedUntil: z.coerce.date().optional(),
  followUpDueAt: z.coerce.date().optional(),
});

/** Body for moving an item to follow-up. */
export const followUpSchema = z.object({
  followUpDueAt: z.coerce.date().optional(),
});

/** Body for snoozing an item until a wake time. */
export const snoozeSchema = z.object({
  snoozedUntil: z.coerce.date(),
});

/** Body for delaying a New item until a future availability time. */
export const delaySchema = z.object({
  availableAt: z.coerce.date(),
});

/** Body for scheduling a New item to become claimable at a specific calendar time. */
export const scheduleSchema = z.object({
  scheduledFor: z.coerce.date(),
});

/** Body for a manual priority change. */
export const updatePrioritySchema = z.object({
  priority: queuePrioritySchema,
  reason: z.string().max(1000).optional(),
});

/** Body for assigning/reassigning an item to a new owner. */
export const assignSchema = z.object({
  ownerWorkspaceUserId: z.string().min(1),
});

/** Body for recalculating an owner's positions. */
export const recalculateSchema = z.object({
  ownerWorkspaceUserId: z.string().min(1).optional(),
});

/** Partial update of the workspace queue settings. */
export const updateSettingsSchema = z
  .object({
    rankingMode: queueRankingModeSchema,
    includeWaitingInActive: z.boolean(),
    includeWorkingInActive: z.boolean(),
  })
  .partial();

/** Query parameters for owner-scoped list views. */
export const ownerQuerySchema = z.object({
  ownerWorkspaceUserId: z.string().min(1).optional(),
});

/** Path parameter carrying a permanent queue id (e.g. MQ-000123). */
export const permanentIdParamSchema = z.object({
  permanentQueueId: z.string().regex(/^MQ-\d{6,}$/),
});

/** Body for a worker heartbeat, naming the item whose lease to extend. */
export const heartbeatSchema = z.object({
  permanentQueueId: z.string().regex(/^MQ-\d{6,}$/),
});

/** Body for a worker completing or releasing an item (names the item only). */
export const workerItemSchema = z.object({
  permanentQueueId: z.string().regex(/^MQ-\d{6,}$/),
});

/** Body for a worker reporting a processing failure. */
export const failSchema = z.object({
  permanentQueueId: z.string().regex(/^MQ-\d{6,}$/),
  error: z.string().max(2000).nullish(),
  errorStack: z.string().max(10_000).nullish(),
});

/** Body for an operator requeuing a dead-lettered item back to the queue. */
export const requeueDeadLetterSchema = z.object({
  permanentQueueId: z.string().regex(/^MQ-\d{6,}$/),
});

// ---------------------------------------------------------------------------
// Phase 3C — Recurrence rules
// ---------------------------------------------------------------------------

/** Body for creating a recurring cron rule. */
export const createRecurrenceRuleSchema = z.object({
  name: z.string().min(1).max(255),
  cronExpression: z.string().min(1),
  timezone: z.string().default('UTC'),
  ownerWorkspaceUserId: z.string().min(1).optional(),
  maxRuns: z.number().int().positive().optional(),
  priority: queuePrioritySchema.optional(),
  partitionKey: z.string().max(255).optional(),
  rateLimitKey: z.string().max(255).optional(),
});

/** Route param for a recurrence rule id. */
export const recurrenceRuleParamSchema = z.object({
  ruleId: z.string().min(1),
});
