import type {
  ActionsBlock,
  Button,
  ContextBlock,
  DividerBlock,
  HeaderBlock,
  KnownBlock,
  Overflow,
  SectionBlock,
} from '@slack/types';
import { QueuePriority, QueueStatus, canTransition } from '../../../domain/queue';
import { SLACK_ACTION_IDS, SLACK_OVERFLOW_ACTIONS } from '../constants';

/**
 * The minimal, framework-free shape these presenters render. A Prisma
 * `QueueItem` is structurally assignable, so handlers can pass items straight
 * through while the presenters stay decoupled from persistence types.
 */
export interface QueueItemView {
  permanentQueueId: string;
  title: string;
  summary: string | null;
  priority: QueuePriority;
  status: QueueStatus;
  snoozedUntil?: Date | null;
  followUpDueAt?: Date | null;
  sourceSlackChannelId?: string | null;
  sourceSlackUserId?: string | null;
  sourceSlackPermalink?: string | null;
}

/** Coloured dot for each priority, used in list lines. */
const PRIORITY_EMOJI: Readonly<Record<QueuePriority, string>> = {
  [QueuePriority.Red]: '🔴',
  [QueuePriority.Yellow]: '🟡',
  [QueuePriority.Green]: '🟢',
};

/** Human-friendly status labels for context lines. */
const STATUS_LABEL: Readonly<Record<QueueStatus, string>> = {
  [QueueStatus.New]: 'New',
  [QueueStatus.Working]: 'Working',
  [QueueStatus.Waiting]: 'Waiting',
  [QueueStatus.FollowUp]: 'Follow Up',
  [QueueStatus.Snoozed]: 'Snoozed',
  [QueueStatus.Done]: 'Done',
  [QueueStatus.Archived]: 'Archived',
  [QueueStatus.Processing]: 'Processing',
  [QueueStatus.DeadLetter]: 'Dead Letter',
};

/** Escape the three characters Slack mrkdwn treats specially. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Keep untrusted labels from breaking Slack's `<url|label>` link syntax. */
function escapeLinkLabel(text: string): string {
  return escapeMrkdwn(text).replace(/\|/g, '¦');
}

/** Only render Slack entity links for ids that look like native Slack ids. */
function slackChannelLink(channelId: string | null | undefined): string | null {
  return channelId !== null && channelId !== undefined && /^[A-Z0-9]+$/.test(channelId)
    ? `<#${channelId}>`
    : null;
}

function slackUserLink(userId: string | null | undefined): string | null {
  return userId !== null && userId !== undefined && /^[A-Z0-9]+$/.test(userId)
    ? `<@${userId}>`
    : null;
}

/** URL buttons should only point back into Slack, never arbitrary destinations. */
function safeSlackPermalink(url: string | null | undefined): string | null {
  if (url === null || url === undefined) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.slack.com') ? url : null;
  } catch {
    return null;
  }
}

export function header(text: string): HeaderBlock {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}

export function divider(): DividerBlock {
  return { type: 'divider' };
}

export function context(text: string): ContextBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

/** A simple section paragraph rendered as mrkdwn. */
export function section(text: string): SectionBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function button(actionId: string, text: string, permanentQueueId: string): Button {
  return {
    type: 'button',
    action_id: actionId,
    text: { type: 'plain_text', text, emoji: true },
    value: permanentQueueId,
  };
}

function openChatButton(item: QueueItemView): Button | null {
  const permalink = safeSlackPermalink(item.sourceSlackPermalink);
  if (permalink === null) {
    return null;
  }
  return {
    type: 'button',
    action_id: SLACK_ACTION_IDS.itemOpenChat,
    text: { type: 'plain_text', text: 'Open chat', emoji: true },
    url: permalink,
    value: item.permanentQueueId,
  };
}

function sourceAction(item: QueueItemView): ActionsBlock | null {
  const open = openChatButton(item);
  return open === null
    ? null
    : { type: 'actions', block_id: `mq_source:${item.permanentQueueId}`, elements: [open] };
}

/** Primary status buttons, in display order, gated by the lifecycle machine. */
const PRIMARY_ACTIONS: ReadonlyArray<{ to: QueueStatus; actionId: string; label: string }> = [
  { to: QueueStatus.Working, actionId: SLACK_ACTION_IDS.itemWorking, label: '⚡ Start' },
  { to: QueueStatus.Waiting, actionId: SLACK_ACTION_IDS.itemWaiting, label: '⏳ Waiting' },
  { to: QueueStatus.FollowUp, actionId: SLACK_ACTION_IDS.itemFollowUp, label: '🔁 Follow Up' },
  { to: QueueStatus.Snoozed, actionId: SLACK_ACTION_IDS.itemSnooze, label: '😴 Snooze' },
];

/** Build the per-item actions row, or null when no legal action remains. */
export function itemActions(item: QueueItemView): ActionsBlock | null {
  const elements: Array<Button | Overflow> = [];
  for (const action of PRIMARY_ACTIONS) {
    if (canTransition(item.status, action.to)) {
      elements.push(button(action.actionId, action.label, item.permanentQueueId));
    }
  }

  const overflowOptions = [];
  if (canTransition(item.status, QueueStatus.Done)) {
    overflowOptions.push({
      text: { type: 'plain_text' as const, text: '✅ Mark Done', emoji: true },
      value: `${SLACK_OVERFLOW_ACTIONS.complete}:${item.permanentQueueId}`,
    });
  }
  if (canTransition(item.status, QueueStatus.Archived)) {
    overflowOptions.push({
      text: { type: 'plain_text' as const, text: '🗂️ Archive', emoji: true },
      value: `${SLACK_OVERFLOW_ACTIONS.archive}:${item.permanentQueueId}`,
    });
  }
  if (overflowOptions.length > 0) {
    elements.push({
      type: 'overflow',
      action_id: SLACK_ACTION_IDS.itemOverflow,
      options: overflowOptions,
    });
  }

  if (elements.length === 0) {
    return null;
  }
  return { type: 'actions', block_id: `mq_item:${item.permanentQueueId}`, elements };
}

/** Render a single item as a section + context (+ actions when interactive). */
export function itemBlocks(
  item: QueueItemView,
  opts: { withActions?: boolean } = {},
): KnownBlock[] {
  const title = escapeMrkdwn(item.title);
  const summary = item.summary === null ? '' : `\n${escapeMrkdwn(item.summary)}`;
  const permalink = safeSlackPermalink(item.sourceSlackPermalink);
  const titleText =
    permalink === null ? `*${title}*` : `*<${permalink}|${escapeLinkLabel(item.title)}>*`;
  const user = slackUserLink(item.sourceSlackUserId);
  const source = slackChannelLink(item.sourceSlackChannelId);
  const sourceParts = [user, source].filter((part): part is string => part !== null);
  const sourceMeta = sourceParts.length === 0 ? '' : ` · Source ${sourceParts.join(' in ')}`;
  const meta = `\`${item.permanentQueueId}\` · ${PRIORITY_EMOJI[item.priority]} ${item.priority} · ${STATUS_LABEL[item.status]}${sourceMeta}`;
  const blocks: KnownBlock[] = [
    section(`${PRIORITY_EMOJI[item.priority]} ${titleText}${summary}`),
    context(meta),
  ];
  const openAction = sourceAction(item);
  if (openAction !== null) {
    blocks.push(openAction);
  }
  if (opts.withActions === true) {
    const actions = itemActions(item);
    if (actions !== null) {
      blocks.push(actions);
    }
  }
  return blocks;
}
