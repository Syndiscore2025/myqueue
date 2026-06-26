import { Router } from 'express';
import {
  queueClaimService,
  queueDeadLetterService,
  queueService,
  queueStatisticsService,
  type CreateItemInput,
} from '../../../application/queue';
import { asyncHandler } from '../../../utils/async-handler';
import { requireWorkerContext, workerContext } from '../middleware/worker-context';
import { requireWorkspaceContext, workspaceContext } from '../middleware/workspace-context';
import {
  assignSchema,
  changeStatusSchema,
  createItemSchema,
  delaySchema,
  followUpSchema,
  failSchema,
  heartbeatSchema,
  ownerQuerySchema,
  workerItemSchema,
  permanentIdParamSchema,
  recalculateSchema,
  requeueDeadLetterSchema,
  snoozeSchema,
  updatePrioritySchema,
  updateSettingsSchema,
} from './queue.schemas';

/**
 * Internal/development-safe queue API. Every route is guarded by
 * {@link workspaceContext}, which derives the acting tenant from explicit
 * headers rather than a real session (see the guard for the security caveat).
 */
export const queueRouter = Router();

// Worker-facing claim endpoint. Registered before the workspace-user guard so it
// is guarded by {@link workerContext} (x-worker-id) rather than requiring an
// acting workspace user — the worker itself is the actor.
queueRouter.post(
  '/claim',
  workerContext,
  asyncHandler(async (req, res) => {
    const ctx = requireWorkerContext(req);
    const item = await queueClaimService.claim(ctx);
    res.status(200).json({ item });
  }),
);

// Worker heartbeat extending the lease on the item the worker is processing.
queueRouter.post(
  '/heartbeat',
  workerContext,
  asyncHandler(async (req, res) => {
    const ctx = requireWorkerContext(req);
    const body = heartbeatSchema.parse(req.body);
    const item = await queueClaimService.heartbeat(ctx, body.permanentQueueId);
    res.status(200).json({ item });
  }),
);

// Worker: mark the claimed item as successfully completed (Processing -> Done).
queueRouter.post(
  '/complete',
  workerContext,
  asyncHandler(async (req, res) => {
    const ctx = requireWorkerContext(req);
    const body = workerItemSchema.parse(req.body);
    const item = await queueClaimService.complete(ctx, body.permanentQueueId);
    res.status(200).json({ item });
  }),
);

// Worker: gracefully release the claimed item back to the queue (Processing -> New).
queueRouter.post(
  '/release',
  workerContext,
  asyncHandler(async (req, res) => {
    const ctx = requireWorkerContext(req);
    const body = workerItemSchema.parse(req.body);
    const item = await queueClaimService.release(ctx, body.permanentQueueId);
    res.status(200).json({ item });
  }),
);

// Worker: report a processing failure; retries if attempts remain, DLQ otherwise.
queueRouter.post(
  '/fail',
  workerContext,
  asyncHandler(async (req, res) => {
    const ctx = requireWorkerContext(req);
    const body = failSchema.parse(req.body);
    const item = await queueClaimService.fail(ctx, body.permanentQueueId, {
      error: body.error ?? null,
      errorStack: body.errorStack ?? null,
    });
    res.status(200).json({ item });
  }),
);

queueRouter.use(workspaceContext);

// Operator: list the workspace's dead-lettered items.
queueRouter.get(
  '/dead-letter',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const items = await queueDeadLetterService.list(ctx);
    res.status(200).json({ items });
  }),
);

// Operator: requeue a dead-lettered item back to the queue (DeadLetter -> New).
queueRouter.post(
  '/dead-letter/requeue',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const body = requeueDeadLetterSchema.parse(req.body);
    const item = await queueDeadLetterService.requeue(ctx, body.permanentQueueId);
    res.status(200).json({ item });
  }),
);

// Operator: read aggregate statistics for the workspace's queue.
queueRouter.get(
  '/statistics',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const statistics = await queueStatisticsService.get(ctx.workspaceId);
    res.status(200).json({ statistics });
  }),
);

queueRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const body = createItemSchema.parse(req.body);
    const input: CreateItemInput = {
      title: body.title,
      ...(body.summary === undefined ? {} : { summary: body.summary }),
      ...(body.ownerWorkspaceUserId === undefined
        ? {}
        : { ownerWorkspaceUserId: body.ownerWorkspaceUserId }),
      ...(body.priority === undefined ? {} : { priority: body.priority }),
      ...(body.sourceType === undefined ? {} : { sourceType: body.sourceType }),
    };
    const item = await queueService.createItem(ctx, input);
    res.status(201).json({ item });
  }),
);

queueRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { ownerWorkspaceUserId } = ownerQuerySchema.parse(req.query);
    const items = await queueService.getActiveQueue(ctx, ownerWorkspaceUserId);
    res.status(200).json({ items });
  }),
);

queueRouter.get(
  '/waiting',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { ownerWorkspaceUserId } = ownerQuerySchema.parse(req.query);
    const items = await queueService.getWaitingQueue(ctx, ownerWorkspaceUserId);
    res.status(200).json({ items });
  }),
);

queueRouter.get(
  '/follow-up',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { ownerWorkspaceUserId } = ownerQuerySchema.parse(req.query);
    const items = await queueService.getFollowUpQueue(ctx, ownerWorkspaceUserId);
    res.status(200).json({ items });
  }),
);

queueRouter.get(
  '/completed-today',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { ownerWorkspaceUserId } = ownerQuerySchema.parse(req.query);
    const items = await queueService.getCompletedToday(ctx, ownerWorkspaceUserId);
    res.status(200).json({ items });
  }),
);

queueRouter.post(
  '/recalculate',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { ownerWorkspaceUserId } = recalculateSchema.parse(req.body);
    const items = await queueService.recalculateForOwner(ctx, ownerWorkspaceUserId);
    res.status(200).json({ items, count: items.length });
  }),
);

queueRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const settings = await queueService.getSettings(ctx);
    res.status(200).json({ settings });
  }),
);

queueRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const parsed = updateSettingsSchema.parse(req.body);
    const changes = {
      ...(parsed.rankingMode === undefined ? {} : { rankingMode: parsed.rankingMode }),
      ...(parsed.includeWaitingInActive === undefined
        ? {}
        : { includeWaitingInActive: parsed.includeWaitingInActive }),
      ...(parsed.includeWorkingInActive === undefined
        ? {}
        : { includeWorkingInActive: parsed.includeWorkingInActive }),
    };
    const settings = await queueService.updateSettings(ctx, changes);
    res.status(200).json({ settings });
  }),
);

queueRouter.get(
  '/items/:permanentQueueId',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const result = await queueService.getItemWithPosition(ctx, permanentQueueId);
    res.status(200).json(result);
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/status',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const body = changeStatusSchema.parse(req.body);
    const item = await queueService.changeStatus(ctx, permanentQueueId, body.toStatus, {
      ...(body.snoozedUntil === undefined ? {} : { snoozedUntil: body.snoozedUntil }),
      ...(body.followUpDueAt === undefined ? {} : { followUpDueAt: body.followUpDueAt }),
    });
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/complete',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const item = await queueService.complete(ctx, permanentQueueId);
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/archive',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const item = await queueService.archive(ctx, permanentQueueId);
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/waiting',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const item = await queueService.moveToWaiting(ctx, permanentQueueId);
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/follow-up',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const { followUpDueAt } = followUpSchema.parse(req.body);
    const item = await queueService.moveToFollowUp(ctx, permanentQueueId, followUpDueAt);
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/snooze',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const { snoozedUntil } = snoozeSchema.parse(req.body);
    const item = await queueService.snooze(ctx, permanentQueueId, snoozedUntil);
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/unsnooze',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const item = await queueService.unsnooze(ctx, permanentQueueId);
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/priority',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const body = updatePrioritySchema.parse(req.body);
    const item = await queueService.updatePriority(ctx, permanentQueueId, body.priority, {
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/delay',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const { availableAt } = delaySchema.parse(req.body);
    const item = await queueService.delay(ctx, permanentQueueId, availableAt);
    res.status(200).json({ item });
  }),
);

queueRouter.post(
  '/items/:permanentQueueId/assign',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const { permanentQueueId } = permanentIdParamSchema.parse(req.params);
    const { ownerWorkspaceUserId } = assignSchema.parse(req.body);
    const item = await queueService.assign(ctx, permanentQueueId, ownerWorkspaceUserId);
    res.status(200).json({ item });
  }),
);
