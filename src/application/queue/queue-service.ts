import type { QueueItem, WorkspaceQueueSettings } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../domain/errors';
import type { PriorityClassificationService } from '../../domain/queue';
import {
  QueueEventType,
  QueueStatus,
  assertTransition,
  positionOf,
  priorityClassificationService,
  rankActiveQueue,
  type QueuePriority,
  type QueueSourceType,
  type RankedQueueItem,
  type RankingOptions,
} from '../../domain/queue';
import type {
  QueueEventRepository,
  QueueHistoryRepository,
  QueueItemRepository,
  WorkspaceQueueSettingsRepository,
} from '../../infrastructure/repositories';
import {
  queueEventRepository,
  queueHistoryRepository,
  queueItemRepository,
  workspaceQueueSettingsRepository,
  type WorkspaceQueueSettingsUpdate,
} from '../../infrastructure/repositories';
import { createLogger } from '../../utils/logger';
import { notificationService } from '../notifications/notification-service';
import { entitlementService } from '../billing/entitlement-service';

/** Who is acting and in which tenant. Both ids are explicit (no faked auth). */
export interface QueueContext {
  readonly workspaceId: string;
  readonly workspaceUserId: string;
}

/** Fields accepted when creating a queue item. Priority is auto-classified when omitted. */
export interface CreateItemInput {
  title: string;
  summary?: string | null;
  /** Optional derived classifier explanation. Never store raw Slack message text here. */
  priorityReason?: string | null;
  ownerWorkspaceUserId?: string;
  priority?: QueuePriority;
  sourceType?: QueueSourceType;
  /**
   * Privacy-safe references back to an originating Slack message. We persist only
   * pointers (channel/message/thread ids and a permalink), never the message body.
   */
  sourceSlackChannelId?: string | null;
  sourceSlackUserId?: string | null;
  sourceSlackMessageTs?: string | null;
  sourceSlackThreadTs?: string | null;
  sourceSlackPermalink?: string | null;
  sourceSlackMessageCount?: number;
}

export interface SlackAttentionInput extends CreateItemInput {
  ownerWorkspaceUserId: string;
  sourceSlackChannelId: string;
  sourceSlackUserId: string;
  sourceSlackMessageTs: string;
  sourceSlackThreadTs?: string | null;
}

/** Optional side-data for a status change (e.g. snooze/follow-up timing). */
export interface StatusChangeOptions {
  snoozedUntil?: Date;
  followUpDueAt?: Date;
  eventType?: QueueEventType;
  clearSnoozedUntil?: boolean;
}

/** An item paired with its computed active-queue position (null if not active). */
export interface ItemWithPosition {
  item: QueueItem;
  position: number | null;
}

/**
 * Minimal notifier the queue service fires after an assignment. Kept narrow so
 * the service depends only on the one capability it needs, and so unit tests can
 * omit it entirely (an undefined dep means no notifications are attempted).
 */
export interface AssignmentNotifier {
  notifyAssignment(workspaceId: string, queueItemId: string): Promise<boolean>;
}

/**
 * Minimal entitlement guard the queue service consults before creating an item.
 * Kept narrow so the service depends only on the one capability it needs, and so
 * unit tests can omit it entirely (an undefined dep means no plan cap is
 * enforced — items are unlimited). The guard throws when the plan limit is hit.
 */
export interface EntitlementGuard {
  assertCanCreateItem(workspaceId: string): Promise<void>;
}

/** Collaborators the service orchestrates; injectable for testing. */
export interface QueueServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  history?: QueueHistoryRepository;
  settings?: WorkspaceQueueSettingsRepository;
  classifier?: PriorityClassificationService;
  notifier?: AssignmentNotifier;
  entitlements?: EntitlementGuard;
}

/** Start of the current local day, for "completed today" views. */
function startOfDay(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Application service orchestrating queue use cases over the tenant-scoped
 * repositories and the pure domain engine. Every method takes an explicit
 * {@link QueueContext} so all reads and writes are scoped by workspace and every
 * audit record attributes the acting user. Positions are always computed, never
 * stored as identity.
 */
export class QueueService {
  private readonly items: QueueItemRepository;
  private readonly events: QueueEventRepository;
  private readonly history: QueueHistoryRepository;
  private readonly settings: WorkspaceQueueSettingsRepository;
  private readonly classifier: PriorityClassificationService;
  private readonly notifier: AssignmentNotifier | undefined;
  private readonly entitlements: EntitlementGuard | undefined;
  private readonly log = createLogger('queue-service');

  constructor(deps: QueueServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.history = deps.history ?? queueHistoryRepository;
    this.settings = deps.settings ?? workspaceQueueSettingsRepository;
    this.classifier = deps.classifier ?? priorityClassificationService;
    // Optional by design: when omitted (e.g. in unit tests) no DM is attempted.
    this.notifier = deps.notifier;
    // Optional by design: when omitted (e.g. in unit tests) no plan cap applies.
    this.entitlements = deps.entitlements;
  }

  /** Create an item, auto-classifying priority when not supplied, and record audit trail. */
  async createItem(ctx: QueueContext, input: CreateItemInput): Promise<QueueItem> {
    // Enforce the plan's active-item cap up front so a workspace at its limit is
    // rejected with a 402 before any row is written. Unlimited when no guard is wired.
    if (this.entitlements !== undefined) {
      await this.entitlements.assertCanCreateItem(ctx.workspaceId);
    }
    const owner = input.ownerWorkspaceUserId ?? ctx.workspaceUserId;
    const classification =
      input.priority === undefined
        ? this.classifier.classify({ text: [input.title, input.summary ?? ''].join(' ') })
        : null;
    const priority = input.priority ?? classification!.priority;
    const item = await this.items.create({
      workspaceId: ctx.workspaceId,
      ownerWorkspaceUserId: owner,
      creatorWorkspaceUserId: ctx.workspaceUserId,
      title: input.title,
      summary: input.summary ?? null,
      priority,
      ...(input.sourceType === undefined ? {} : { sourceType: input.sourceType }),
      sourceSlackChannelId: input.sourceSlackChannelId ?? null,
      sourceSlackUserId: input.sourceSlackUserId ?? null,
      sourceSlackMessageTs: input.sourceSlackMessageTs ?? null,
      sourceSlackThreadTs: input.sourceSlackThreadTs ?? null,
      sourceSlackPermalink: input.sourceSlackPermalink ?? null,
      sourceSlackMessageCount: input.sourceSlackMessageCount ?? 1,
    });
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      actorWorkspaceUserId: ctx.workspaceUserId,
      eventType: QueueEventType.CREATED,
      newValue: item.status,
    });
    await this.history.recordStatusChange({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      toStatus: item.status,
      actorWorkspaceUserId: ctx.workspaceUserId,
    });
    if (classification !== null) {
      await this.history.recordPriorityChange({
        workspaceId: ctx.workspaceId,
        queueItemId: item.id,
        toPriority: priority,
        source: 'auto-classification',
        reason: classification.reason,
        automatic: true,
        actorWorkspaceUserId: ctx.workspaceUserId,
      });
    } else if (input.priorityReason !== undefined && input.priorityReason !== null) {
      await this.history.recordPriorityChange({
        workspaceId: ctx.workspaceId,
        queueItemId: item.id,
        toPriority: priority,
        source: 'auto-classification',
        reason: input.priorityReason,
        automatic: true,
        actorWorkspaceUserId: ctx.workspaceUserId,
      });
    }
    return item;
  }

  /**
   * Create or update a Slack attention pointer. Messages from the same sender in
   * the same Slack conversation/thread within `windowMs` increment one queue item
   * instead of spamming the owner with duplicates.
   */
  async createOrUpdateSlackAttention(
    ctx: QueueContext,
    input: SlackAttentionInput,
    windowMs: number,
    now: Date = new Date(),
  ): Promise<QueueItem> {
    const existing = await this.findRecentSlackAttention(ctx, input, windowMs, now);
    if (existing !== null) {
      const updated = await this.applyUpdate(ctx, existing.id, {
        sourceSlackMessageTs: input.sourceSlackMessageTs,
        sourceSlackPermalink: input.sourceSlackPermalink ?? existing.sourceSlackPermalink,
        sourceSlackMessageCount: existing.sourceSlackMessageCount + 1,
      });
      await this.events.record({
        workspaceId: ctx.workspaceId,
        queueItemId: existing.id,
        actorWorkspaceUserId: ctx.workspaceUserId,
        eventType: QueueEventType.RECALCULATED,
        previousValue: String(existing.sourceSlackMessageCount),
        newValue: String(updated.sourceSlackMessageCount),
      });
      return updated;
    }
    return this.createItem(ctx, input);
  }

  /** Mark every active Slack attention pointer for the same source conversation done. */
  async completeSlackAttentionGroup(ctx: QueueContext, permanentQueueId: string): Promise<number> {
    const anchor = await this.requireItem(ctx, permanentQueueId);
    const siblings = await this.items.listByOwner(ctx.workspaceId, anchor.ownerWorkspaceUserId, {
      statuses: [
        QueueStatus.New,
        QueueStatus.Working,
        QueueStatus.Waiting,
        QueueStatus.FollowUp,
        QueueStatus.Snoozed,
      ],
    });
    const group = siblings.filter((item) => this.sameSlackAttentionGroup(anchor, item));
    for (const item of group) {
      if (item.status !== QueueStatus.Done) {
        await this.changeStatus(ctx, item.permanentQueueId, QueueStatus.Done);
      }
    }
    return group.length;
  }

  /** Resolve an item by permanent id within the workspace, or throw 404. */
  async getItem(ctx: QueueContext, permanentQueueId: string): Promise<QueueItem> {
    return this.requireItem(ctx, permanentQueueId);
  }

  /** Resolve an item together with its computed position in the owner's active queue. */
  async getItemWithPosition(
    ctx: QueueContext,
    permanentQueueId: string,
  ): Promise<ItemWithPosition> {
    const item = await this.requireItem(ctx, permanentQueueId);
    const options = await this.rankingOptions(ctx);
    const siblings = await this.items.listByOwner(ctx.workspaceId, item.ownerWorkspaceUserId);
    const position = positionOf(item, siblings, options, (a, b) => a.id === b.id);
    return { item, position };
  }

  /** Move an item to a new status, enforcing the lifecycle and recording audit trail. */
  async changeStatus(
    ctx: QueueContext,
    permanentQueueId: string,
    toStatus: QueueStatus,
    options: StatusChangeOptions = {},
  ): Promise<QueueItem> {
    const item = await this.requireItem(ctx, permanentQueueId);
    assertTransition(item.status, toStatus);
    const updated = await this.applyUpdate(ctx, item.id, {
      status: toStatus,
      ...this.statusTimestamps(toStatus, options),
    });
    await this.history.recordStatusChange({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      fromStatus: item.status,
      toStatus,
      actorWorkspaceUserId: ctx.workspaceUserId,
    });
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      actorWorkspaceUserId: ctx.workspaceUserId,
      eventType: options.eventType ?? this.statusEventType(toStatus),
      previousValue: item.status,
      newValue: toStatus,
    });
    return updated;
  }

  /** Mark an item done. */
  async complete(ctx: QueueContext, permanentQueueId: string): Promise<QueueItem> {
    return this.changeStatus(ctx, permanentQueueId, QueueStatus.Done);
  }

  /** Archive an item (terminal). */
  async archive(ctx: QueueContext, permanentQueueId: string): Promise<QueueItem> {
    return this.changeStatus(ctx, permanentQueueId, QueueStatus.Archived);
  }

  /** Move an item to the waiting state. */
  async moveToWaiting(ctx: QueueContext, permanentQueueId: string): Promise<QueueItem> {
    return this.changeStatus(ctx, permanentQueueId, QueueStatus.Waiting);
  }

  /** Move an item to follow-up, optionally with a due date. */
  async moveToFollowUp(
    ctx: QueueContext,
    permanentQueueId: string,
    followUpDueAt?: Date,
  ): Promise<QueueItem> {
    return this.changeStatus(ctx, permanentQueueId, QueueStatus.FollowUp, {
      ...(followUpDueAt === undefined ? {} : { followUpDueAt }),
    });
  }

  /** Snooze an item until the given time. */
  async snooze(
    ctx: QueueContext,
    permanentQueueId: string,
    snoozedUntil: Date,
  ): Promise<QueueItem> {
    return this.changeStatus(ctx, permanentQueueId, QueueStatus.Snoozed, { snoozedUntil });
  }

  /** Wake a snoozed item back into the active queue, clearing its snooze time. */
  async unsnooze(ctx: QueueContext, permanentQueueId: string): Promise<QueueItem> {
    return this.changeStatus(ctx, permanentQueueId, QueueStatus.New, {
      eventType: QueueEventType.UNSNOOZED,
      clearSnoozedUntil: true,
    });
  }

  /**
   * Schedule a `New` item to become available at a specific calendar time.
   * Sets both `scheduledFor` (the user-visible intent) and `availableAt` (the
   * single claim gate). The item stays `New` but is excluded from claim selection
   * and ranking until the time passes. Records a `SCHEDULED` audit event.
   */
  async schedule(
    ctx: QueueContext,
    permanentQueueId: string,
    scheduledFor: Date,
  ): Promise<QueueItem> {
    const item = await this.requireItem(ctx, permanentQueueId);
    if (item.status !== QueueStatus.New) {
      throw new ConflictError(`Only New items can be scheduled (current status: "${item.status}")`);
    }
    const updated = await this.applyUpdate(ctx, item.id, {
      scheduledFor,
      availableAt: scheduledFor,
    });
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      actorWorkspaceUserId: ctx.workspaceUserId,
      eventType: QueueEventType.SCHEDULED,
      previousValue: item.scheduledFor?.toISOString() ?? null,
      newValue: scheduledFor.toISOString(),
    });
    return updated;
  }

  /**
   * List items that have been explicitly scheduled to become available in the
   * future. Optionally filtered to a single owner.
   */
  async getScheduled(ctx: QueueContext, ownerWorkspaceUserId?: string): Promise<QueueItem[]> {
    return this.items.listScheduled(ctx.workspaceId, ownerWorkspaceUserId);
  }

  /**
   * Delay a `New` item until `availableAt`. The item stays `New` but is gated
   * out of both claim selection and active-queue ranking until the timestamp
   * passes. Records a `DELAYED` audit event.
   */
  async delay(ctx: QueueContext, permanentQueueId: string, availableAt: Date): Promise<QueueItem> {
    const item = await this.requireItem(ctx, permanentQueueId);
    if (item.status !== QueueStatus.New) {
      throw new ConflictError(`Only New items can be delayed (current status: "${item.status}")`);
    }
    const updated = await this.applyUpdate(ctx, item.id, { availableAt, delayUntil: availableAt });
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      actorWorkspaceUserId: ctx.workspaceUserId,
      eventType: QueueEventType.DELAYED,
      previousValue: item.availableAt?.toISOString() ?? null,
      newValue: availableAt.toISOString(),
    });
    return updated;
  }

  /** Change an item's priority manually and record the change. */
  async updatePriority(
    ctx: QueueContext,
    permanentQueueId: string,
    toPriority: QueuePriority,
    options: { reason?: string } = {},
  ): Promise<QueueItem> {
    const item = await this.requireItem(ctx, permanentQueueId);
    const updated = await this.applyUpdate(ctx, item.id, { priority: toPriority });
    await this.history.recordPriorityChange({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      fromPriority: item.priority,
      toPriority,
      source: 'manual',
      reason: options.reason ?? null,
      automatic: false,
      actorWorkspaceUserId: ctx.workspaceUserId,
    });
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      actorWorkspaceUserId: ctx.workspaceUserId,
      eventType: QueueEventType.PRIORITY_CHANGED,
      previousValue: item.priority,
      newValue: toPriority,
    });
    return updated;
  }

  /** Reassign an item to a new owner and record the assignment. */
  async assign(
    ctx: QueueContext,
    permanentQueueId: string,
    newOwnerWorkspaceUserId: string,
  ): Promise<QueueItem> {
    const item = await this.requireItem(ctx, permanentQueueId);
    const previousOwner = item.ownerWorkspaceUserId;
    const updated = await this.applyUpdate(ctx, item.id, {
      ownerWorkspaceUserId: newOwnerWorkspaceUserId,
      assignedAt: new Date(),
    });
    await this.history.recordAssignment({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      previousOwnerWorkspaceUserId: previousOwner,
      ownerWorkspaceUserId: newOwnerWorkspaceUserId,
      assignedByWorkspaceUserId: ctx.workspaceUserId,
    });
    await this.events.record({
      workspaceId: ctx.workspaceId,
      queueItemId: item.id,
      actorWorkspaceUserId: ctx.workspaceUserId,
      eventType:
        previousOwner === newOwnerWorkspaceUserId
          ? QueueEventType.ASSIGNED
          : QueueEventType.REASSIGNED,
      previousValue: previousOwner,
      newValue: newOwnerWorkspaceUserId,
    });
    this.fireAssignmentNotification(ctx, item.id, newOwnerWorkspaceUserId);
    return updated;
  }

  /**
   * Best-effort DM to the new owner that an item landed on their queue. Skipped
   * for self-assignment (the actor doesn't need to notify themselves) and when no
   * notifier is wired. Fire-and-forget: the assignment never waits on or fails
   * because of delivery, and any error is swallowed after logging.
   */
  private fireAssignmentNotification(
    ctx: QueueContext,
    queueItemId: string,
    newOwnerWorkspaceUserId: string,
  ): void {
    if (this.notifier === undefined || newOwnerWorkspaceUserId === ctx.workspaceUserId) {
      return;
    }
    void this.notifier.notifyAssignment(ctx.workspaceId, queueItemId).catch((err: unknown) => {
      this.log.error(
        { err, workspaceId: ctx.workspaceId, queueItemId },
        'assignment notification failed',
      );
    });
  }

  /** Compute an owner's active queue with 1-based positions (ranking is on read). */
  async getActiveQueue(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<RankedQueueItem<QueueItem>[]> {
    const options = await this.rankingOptions(ctx);
    const items = await this.items.listByOwner(ctx.workspaceId, ownerWorkspaceUserId);
    return rankActiveQueue(items, options);
  }

  /** Alias of {@link getActiveQueue} expressing intent at call sites. */
  async calculatePositions(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<RankedQueueItem<QueueItem>[]> {
    return this.getActiveQueue(ctx, ownerWorkspaceUserId);
  }

  /** Recompute an owner's positions and record a queue-wide RECALCULATED event. */
  async recalculateForOwner(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<RankedQueueItem<QueueItem>[]> {
    const ranked = await this.getActiveQueue(ctx, ownerWorkspaceUserId);
    await this.events.record({
      workspaceId: ctx.workspaceId,
      actorWorkspaceUserId: ctx.workspaceUserId,
      eventType: QueueEventType.RECALCULATED,
      newValue: String(ranked.length),
    });
    return ranked;
  }

  /** List an owner's waiting items. */
  async getWaitingQueue(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<QueueItem[]> {
    return this.items.listByOwner(ctx.workspaceId, ownerWorkspaceUserId, {
      statuses: [QueueStatus.Waiting],
    });
  }

  /** List an owner's follow-up items. */
  async getFollowUpQueue(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<QueueItem[]> {
    return this.items.listByOwner(ctx.workspaceId, ownerWorkspaceUserId, {
      statuses: [QueueStatus.FollowUp],
    });
  }

  /** List an owner's in-progress (working) items. */
  async getWorkingQueue(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<QueueItem[]> {
    return this.items.listByOwner(ctx.workspaceId, ownerWorkspaceUserId, {
      statuses: [QueueStatus.Working],
    });
  }

  /** List an owner's snoozed items. */
  async getSnoozedQueue(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<QueueItem[]> {
    return this.items.listByOwner(ctx.workspaceId, ownerWorkspaceUserId, {
      statuses: [QueueStatus.Snoozed],
    });
  }

  /** List an owner's archived items. */
  async getArchive(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<QueueItem[]> {
    return this.items.listByOwner(ctx.workspaceId, ownerWorkspaceUserId, {
      statuses: [QueueStatus.Archived],
    });
  }

  /** List an owner's items completed since the start of the current day. */
  async getCompletedToday(
    ctx: QueueContext,
    ownerWorkspaceUserId: string = ctx.workspaceUserId,
  ): Promise<QueueItem[]> {
    const done = await this.items.listByOwner(ctx.workspaceId, ownerWorkspaceUserId, {
      statuses: [QueueStatus.Done],
    });
    const since = startOfDay();
    return done.filter((item) => item.completedAt !== null && item.completedAt >= since);
  }

  /** Read the workspace queue settings, creating defaults if absent. */
  async getSettings(ctx: QueueContext): Promise<WorkspaceQueueSettings> {
    return this.settings.ensure(ctx.workspaceId);
  }

  /** Update the workspace queue settings. */
  async updateSettings(
    ctx: QueueContext,
    changes: WorkspaceQueueSettingsUpdate,
  ): Promise<WorkspaceQueueSettings> {
    return this.settings.update(ctx.workspaceId, changes);
  }

  /** Load an item by permanent id or throw a 404. */
  private async requireItem(ctx: QueueContext, permanentQueueId: string): Promise<QueueItem> {
    const item = await this.items.findByPermanentId(ctx.workspaceId, permanentQueueId);
    if (item === null) {
      throw new NotFoundError(`Queue item "${permanentQueueId}" not found in this workspace`);
    }
    return item;
  }

  private async findRecentSlackAttention(
    ctx: QueueContext,
    input: SlackAttentionInput,
    windowMs: number,
    now: Date,
  ): Promise<QueueItem | null> {
    const cutoff = now.getTime() - windowMs;
    const active = await this.items.listByOwner(ctx.workspaceId, input.ownerWorkspaceUserId, {
      statuses: [
        QueueStatus.New,
        QueueStatus.Working,
        QueueStatus.Waiting,
        QueueStatus.FollowUp,
        QueueStatus.Snoozed,
      ],
    });
    return (
      active.find(
        (item) =>
          item.sourceType === input.sourceType &&
          item.sourceSlackChannelId === input.sourceSlackChannelId &&
          item.sourceSlackUserId === input.sourceSlackUserId &&
          item.sourceSlackThreadTs === (input.sourceSlackThreadTs ?? null) &&
          item.updatedAt.getTime() >= cutoff,
      ) ?? null
    );
  }

  private sameSlackAttentionGroup(anchor: QueueItem, item: QueueItem): boolean {
    return (
      (item.id !== anchor.id || item.status !== QueueStatus.Done) &&
      item.sourceType === anchor.sourceType &&
      item.sourceSlackChannelId === anchor.sourceSlackChannelId &&
      item.sourceSlackUserId === anchor.sourceSlackUserId &&
      item.sourceSlackThreadTs === anchor.sourceSlackThreadTs
    );
  }

  /** Apply a scoped update, treating a missing row as a 404 (lost the race). */
  private async applyUpdate(
    ctx: QueueContext,
    id: string,
    changes: Parameters<QueueItemRepository['updateScoped']>[2],
  ): Promise<QueueItem> {
    const updated = await this.items.updateScoped(ctx.workspaceId, id, changes);
    if (updated === null) {
      throw new NotFoundError('Queue item not found in this workspace');
    }
    return updated;
  }

  /** Resolve the active-ranking options from the workspace settings. */
  private async rankingOptions(ctx: QueueContext): Promise<RankingOptions> {
    const settings = await this.settings.ensure(ctx.workspaceId);
    return {
      mode: settings.rankingMode,
      includeWorkingInActive: settings.includeWorkingInActive,
      includeWaitingInActive: settings.includeWaitingInActive,
    };
  }

  /** Timestamp side effects that accompany entering a given status. */
  private statusTimestamps(
    toStatus: QueueStatus,
    options: StatusChangeOptions,
  ): Parameters<QueueItemRepository['updateScoped']>[2] {
    const changes: Parameters<QueueItemRepository['updateScoped']>[2] = {};
    if (toStatus === QueueStatus.Done) {
      changes.completedAt = new Date();
    }
    if (toStatus === QueueStatus.Archived) {
      changes.archivedAt = new Date();
    }
    if (toStatus === QueueStatus.Snoozed) {
      changes.snoozedUntil = options.snoozedUntil ?? null;
      // Phase 3C: gate the claim engine on the snooze wake-up time so snoozed
      // items are automatically skipped by workers until the scheduler activates them.
      changes.availableAt = options.snoozedUntil ?? null;
    }
    if (toStatus === QueueStatus.FollowUp) {
      changes.followUpDueAt = options.followUpDueAt ?? null;
    }
    if (options.clearSnoozedUntil === true) {
      changes.snoozedUntil = null;
      // Phase 3C: clear the claim gate when un-snoozing so the item re-enters
      // the active queue immediately.
      changes.availableAt = null;
    }
    return changes;
  }

  /** Map a target status to its canonical audit event type. */
  private statusEventType(toStatus: QueueStatus): QueueEventType {
    switch (toStatus) {
      case QueueStatus.Waiting:
        return QueueEventType.MOVED_TO_WAITING;
      case QueueStatus.FollowUp:
        return QueueEventType.MOVED_TO_FOLLOW_UP;
      case QueueStatus.Snoozed:
        return QueueEventType.SNOOZED;
      case QueueStatus.Done:
        return QueueEventType.COMPLETED;
      case QueueStatus.Archived:
        return QueueEventType.ARCHIVED;
      default:
        return QueueEventType.STATUS_CHANGED;
    }
  }
}

/**
 * Process-wide queue service bound to the shared repository singletons, the
 * shared notification service (so assignments made through it DM the new owner),
 * and the shared entitlement service (so creates respect the workspace plan cap).
 */
export const queueService = new QueueService({
  notifier: notificationService,
  entitlements: entitlementService,
});
