import { queueService, type QueueContext } from '../../../application/queue';
import { QueuePriority, QueueStatus } from '../../../domain/queue';
import { QueueView, SLACK_ACTION_IDS, SLACK_DEFAULT_SNOOZE_MINUTES } from '../constants';
import type { QueueItemView } from '../views';

/** The priority each colour-filter view selects from the active queue. */
const VIEW_PRIORITY: Partial<Record<QueueView, QueuePriority>> = {
  [QueueView.Red]: QueuePriority.Red,
  [QueueView.Yellow]: QueuePriority.Yellow,
  [QueueView.Green]: QueuePriority.Green,
};

/**
 * Load the items backing a {@link QueueView} for the acting user, tenant-scoped
 * via the {@link QueueContext}. Priority views filter the ranked active queue;
 * status views delegate to the matching queue service reader. A Prisma
 * `QueueItem` is structurally a {@link QueueItemView}, so the result feeds the
 * presenters directly.
 */
export async function loadQueueView(
  ctx: QueueContext,
  view: QueueView,
): Promise<readonly QueueItemView[]> {
  const priority = VIEW_PRIORITY[view];
  if (view === QueueView.All || priority !== undefined) {
    const ranked = await queueService.getActiveQueue(ctx);
    const items = ranked.map((entry) => entry.item);
    return priority === undefined ? items : items.filter((item) => item.priority === priority);
  }
  switch (view) {
    case QueueView.Working:
      return queueService.getWorkingQueue(ctx);
    case QueueView.FollowUp:
      return queueService.getFollowUpQueue(ctx);
    case QueueView.Waiting:
      return queueService.getWaitingQueue(ctx);
    case QueueView.Snooze:
      return queueService.getSnoozedQueue(ctx);
    case QueueView.Archive:
      return queueService.getArchive(ctx);
    default:
      return [];
  }
}

/** A single-item action a user can trigger from the Slack surface. */
export type ItemAction =
  | 'working'
  | 'waiting'
  | 'followup'
  | 'snooze'
  | 'complete'
  | 'archive'
  | 'priority_red'
  | 'priority_yellow'
  | 'priority_green';

/** Map a primary button `action_id` to its {@link ItemAction}. */
export const ACTION_ID_TO_ITEM_ACTION: Readonly<Record<string, ItemAction>> = {
  [SLACK_ACTION_IDS.itemWorking]: 'working',
  [SLACK_ACTION_IDS.itemWaiting]: 'waiting',
  [SLACK_ACTION_IDS.itemFollowUp]: 'followup',
  [SLACK_ACTION_IDS.itemSnooze]: 'snooze',
  [SLACK_ACTION_IDS.itemResolved]: 'complete',
};

/**
 * Apply a single-item lifecycle action through the queue service, enforcing the
 * domain state machine. Snooze uses the default one-tap duration. Returns the
 * resulting item status for logging/audit by callers.
 */
export async function applyItemAction(
  ctx: QueueContext,
  action: ItemAction,
  permanentQueueId: string,
): Promise<QueueStatus> {
  switch (action) {
    case 'working':
      return (await queueService.changeStatus(ctx, permanentQueueId, QueueStatus.Working)).status;
    case 'waiting':
      return (await queueService.moveToWaiting(ctx, permanentQueueId)).status;
    case 'followup':
      return (await queueService.moveToFollowUp(ctx, permanentQueueId)).status;
    case 'snooze': {
      const until = new Date(Date.now() + SLACK_DEFAULT_SNOOZE_MINUTES * 60_000);
      return (await queueService.snooze(ctx, permanentQueueId, until)).status;
    }
    case 'complete':
      return (await queueService.complete(ctx, permanentQueueId)).status;
    case 'archive':
      return (await queueService.archive(ctx, permanentQueueId)).status;
    case 'priority_red':
      return (await queueService.updatePriority(ctx, permanentQueueId, QueuePriority.Red)).status;
    case 'priority_yellow':
      return (await queueService.updatePriority(ctx, permanentQueueId, QueuePriority.Yellow)).status;
    case 'priority_green':
      return (await queueService.updatePriority(ctx, permanentQueueId, QueuePriority.Green)).status;
  }
}
