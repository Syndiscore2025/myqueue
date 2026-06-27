import type { KnownBlock } from '@slack/types';
import { QueuePriority } from '../../domain/queue';
import type { NotificationMessage } from './notifier';

/** The per-item notifications MyQueue can deliver as a direct message. */
export type NotificationKind = 'assignment' | 'snooze-wake' | 'follow-up-due';

/**
 * The minimal item projection these builders render. A domain/Prisma QueueItem
 * is structurally assignable, so callers pass items straight through while the
 * builders stay pure and free of persistence types. Builders never touch a Slack
 * client — they only shape a {@link NotificationMessage}.
 */
export interface NotifiableItem {
  permanentQueueId: string;
  title: string;
  summary: string | null;
  priority: QueuePriority;
  followUpDueAt?: Date | null;
}

/** Coloured dot for each priority, mirroring the App Home presenter. */
const PRIORITY_EMOJI: Readonly<Record<QueuePriority, string>> = {
  [QueuePriority.Red]: '🔴',
  [QueuePriority.Yellow]: '🟡',
  [QueuePriority.Green]: '🟢',
};

/** Escape the three characters Slack mrkdwn treats specially. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render a date as a localized Slack timestamp with a plain-text fallback. */
function slackDate(date: Date): string {
  const ts = Math.floor(date.getTime() / 1000);
  return `<!date^${ts}^{date_short_pretty} at {time}|${date.toISOString()}>`;
}

function section(text: string): KnownBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function context(text: string): KnownBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

/** Shared "title + meta" body for a single item, with an optional meta suffix. */
function itemBody(item: NotifiableItem, extra?: string): KnownBlock[] {
  const title = escapeMrkdwn(item.title);
  const summary = item.summary === null ? '' : `\n${escapeMrkdwn(item.summary)}`;
  const tail = extra === undefined ? '' : ` · ${extra}`;
  const meta = `\`${item.permanentQueueId}\` · ${PRIORITY_EMOJI[item.priority]} ${item.priority}${tail}`;
  return [section(`${PRIORITY_EMOJI[item.priority]} *${title}*${summary}`), context(meta)];
}

/** A new item reached the top of the owner's queue. */
export function buildAssignmentMessage(item: NotifiableItem): NotificationMessage {
  return {
    text: `🆕 New item on your queue: ${item.title} (${item.permanentQueueId})`,
    blocks: [section('🆕 *A new item is on your queue*'), ...itemBody(item)],
  };
}

/** A previously snoozed item has woken and is active again. */
export function buildSnoozeWakeMessage(item: NotifiableItem): NotificationMessage {
  return {
    text: `⏰ Snoozed item is back on your queue: ${item.title} (${item.permanentQueueId})`,
    blocks: [section('⏰ *A snoozed item is back on your queue*'), ...itemBody(item)],
  };
}

/** A follow-up reminder has come due for an item. */
export function buildFollowUpDueMessage(item: NotifiableItem): NotificationMessage {
  const extra =
    item.followUpDueAt === null || item.followUpDueAt === undefined
      ? 'Follow Up'
      : `due ${slackDate(item.followUpDueAt)}`;
  return {
    text: `🔁 Follow-up due: ${item.title} (${item.permanentQueueId})`,
    blocks: [section('🔁 *A follow-up is due*'), ...itemBody(item, extra)],
  };
}

/**
 * A scheduled daily summary of the owner's active queue. Lists up to ten items
 * (highest-ranked first, as the caller orders them) and notes any remainder.
 */
export function buildDigestMessage(items: NotifiableItem[]): NotificationMessage {
  const count = items.length;
  if (count === 0) {
    return {
      text: '☀️ Your MyQueue digest: your queue is clear',
      blocks: [
        section('☀️ *Your daily MyQueue digest*'),
        section('🎉 Your active queue is clear. Nice work!'),
      ],
    };
  }

  const plural = count === 1 ? '' : 's';
  const blocks: KnownBlock[] = [
    section('☀️ *Your daily MyQueue digest*'),
    context(`${count} item${plural} waiting for you`),
  ];
  for (const item of items.slice(0, 10)) {
    blocks.push(
      section(
        `${PRIORITY_EMOJI[item.priority]} *${escapeMrkdwn(item.title)}*  \`${item.permanentQueueId}\``,
      ),
    );
  }
  if (count > 10) {
    blocks.push(context(`…and ${count - 10} more`));
  }
  return { text: `☀️ Your MyQueue digest: ${count} item${plural} in your queue`, blocks };
}
