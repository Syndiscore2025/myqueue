import type { WorkspaceQueueSettings } from '@prisma/client';
import { QueueEventType } from '../../domain/queue';
import type {
  QueueEventRepository,
  QueueItemRepository,
  WorkspaceQueueSettingsRepository,
  WorkspaceRepository,
} from '../../infrastructure/repositories';
import {
  queueEventRepository,
  queueItemRepository,
  workspaceQueueSettingsRepository,
  workspaceRepository,
} from '../../infrastructure/repositories';
import { slackNotifier } from '../../infrastructure/slack/slack-notifier';
import { createLogger } from '../../utils/logger';
import {
  buildAssignmentMessage,
  buildDigestMessage,
  buildFollowUpDueMessage,
  buildSnoozeWakeMessage,
  type NotifiableItem,
  type NotificationKind,
} from './messages';
import type { NotificationMessage, Notifier } from './notifier';

/** Collaborators the notification service orchestrates; injectable for testing. */
export interface NotificationServiceDeps {
  notifier?: Notifier;
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  workspaces?: WorkspaceRepository;
  settings?: WorkspaceQueueSettingsRepository;
}

/** The settings flag and message builder backing each notification kind. */
const KIND_CONFIG: Readonly<
  Record<
    NotificationKind,
    {
      pref: 'notifyOnAssignment' | 'notifyOnSnoozeWake' | 'notifyOnFollowUpDue';
      build: (item: NotifiableItem) => NotificationMessage;
    }
  >
> = {
  assignment: { pref: 'notifyOnAssignment', build: buildAssignmentMessage },
  'snooze-wake': { pref: 'notifyOnSnoozeWake', build: buildSnoozeWakeMessage },
  'follow-up-due': { pref: 'notifyOnFollowUpDue', build: buildFollowUpDueMessage },
};

/**
 * Orchestrates per-item Slack notifications. For each kind it gates on the
 * workspace's preference, resolves the owner's Slack id, delivers the DM through
 * the {@link Notifier} port, and records a `NOTIFIED` audit event on success.
 *
 * Every path is tenant-scoped by `workspaceId`. Like the notifier it fails safe:
 * a disabled preference, missing item/user, or a failed delivery returns `false`
 * rather than throwing, so a notification never breaks the caller.
 */
export class NotificationService {
  private readonly notifier: Notifier;
  private readonly items: QueueItemRepository;
  private readonly events: QueueEventRepository;
  private readonly workspaces: WorkspaceRepository;
  private readonly settings: WorkspaceQueueSettingsRepository;
  private readonly log = createLogger('notification-service');

  constructor(deps: NotificationServiceDeps = {}) {
    this.notifier = deps.notifier ?? slackNotifier;
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.workspaces = deps.workspaces ?? workspaceRepository;
    this.settings = deps.settings ?? workspaceQueueSettingsRepository;
  }

  /** Notify the owner that a new item reached the top of their queue. */
  async notifyAssignment(workspaceId: string, queueItemId: string): Promise<boolean> {
    return this.notifyItem(workspaceId, queueItemId, 'assignment');
  }

  /** Notify the owner that a snoozed item has woken and is active again. */
  async notifySnoozeWake(workspaceId: string, queueItemId: string): Promise<boolean> {
    return this.notifyItem(workspaceId, queueItemId, 'snooze-wake');
  }

  /** Notify the owner that a follow-up reminder has come due. */
  async notifyFollowUpDue(workspaceId: string, queueItemId: string): Promise<boolean> {
    return this.notifyItem(workspaceId, queueItemId, 'follow-up-due');
  }

  /**
   * DM an owner their daily digest of active items. The `items` must already be
   * ranked/ordered by the caller; this method only resolves the owner, delivers
   * the summary, and records a `NOTIFIED` event on success. Unlike the per-item
   * notifications the digest is gated at the workspace level by the caller, so
   * there is no preference check here. Fails safe: a missing owner or failed
   * delivery returns `false` rather than throwing.
   */
  async notifyDigest(
    workspaceId: string,
    ownerWorkspaceUserId: string,
    items: NotifiableItem[],
  ): Promise<boolean> {
    const user = await this.workspaces.findUserById(workspaceId, ownerWorkspaceUserId);
    if (user === null) {
      this.log.warn({ workspaceId, ownerWorkspaceUserId }, 'owner not found; skipping digest');
      return false;
    }

    const delivered = await this.notifier.dmUser(
      workspaceId,
      user.slackUserId,
      buildDigestMessage(items),
    );
    if (!delivered) {
      return false;
    }

    await this.events.record({
      workspaceId,
      eventType: QueueEventType.NOTIFIED,
      actorWorkspaceUserId: ownerWorkspaceUserId,
      metadata: { kind: 'digest', count: items.length },
    });
    return true;
  }

  /**
   * Shared flow: gate on the kind's preference, load the item and its owner,
   * deliver the DM, and record a `NOTIFIED` event when delivery succeeds.
   */
  private async notifyItem(
    workspaceId: string,
    queueItemId: string,
    kind: NotificationKind,
  ): Promise<boolean> {
    const config = KIND_CONFIG[kind];
    const settings = await this.settings.find(workspaceId);
    if (!prefEnabled(settings, config.pref)) {
      return false;
    }

    const item = await this.items.findById(workspaceId, queueItemId);
    if (item === null) {
      this.log.warn({ workspaceId, queueItemId, kind }, 'item not found; skipping notification');
      return false;
    }

    const user = await this.workspaces.findUserById(workspaceId, item.ownerWorkspaceUserId);
    if (user === null) {
      this.log.warn({ workspaceId, queueItemId, kind }, 'owner not found; skipping notification');
      return false;
    }

    const delivered = await this.notifier.dmUser(workspaceId, user.slackUserId, config.build(item));
    if (!delivered) {
      return false;
    }

    await this.events.record({
      workspaceId,
      eventType: QueueEventType.NOTIFIED,
      queueItemId: item.id,
      actorWorkspaceUserId: item.ownerWorkspaceUserId,
      metadata: { kind },
    });
    return true;
  }
}

/** A preference defaults to enabled when the workspace has no settings row yet. */
function prefEnabled(
  settings: WorkspaceQueueSettings | null,
  pref: 'notifyOnAssignment' | 'notifyOnSnoozeWake' | 'notifyOnFollowUpDue',
): boolean {
  return settings === null ? true : settings[pref];
}

/** Process-wide notification service bound to the shared collaborators. */
export const notificationService = new NotificationService();
