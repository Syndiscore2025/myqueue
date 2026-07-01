/**
 * Stable identifiers for the Slack surface: callback ids, command names, action
 * ids, and the set of navigable queue views. Centralised so the handlers and the
 * Block Kit presenters agree on a single source of truth (and so tests can refer
 * to the same constants the runtime registers).
 */

/** Slash command names the app listens on. */
export const SLACK_COMMANDS = {
  myqueue: '/myqueue',
} as const;

/** Interactivity callback ids (shortcuts and views). */
export const SLACK_CALLBACK_IDS = {
  /** Message shortcut: "Add to MyQueue". */
  addMessageShortcut: 'myqueue_add_message',
} as const;

/**
 * Block Kit `action_id`s. Item action buttons carry the target item's permanent
 * queue id in their `value`; the overflow menu encodes `"<action>:<id>"` in each
 * option value. Navigation buttons carry the target {@link QueueView} as value.
 */
export const SLACK_ACTION_IDS = {
  selectView: 'mq_view',
  refresh: 'mq_refresh',
  itemWorking: 'mq_item_working',
  itemWaiting: 'mq_item_waiting',
  itemFollowUp: 'mq_item_followup',
  itemSnooze: 'mq_item_snooze',
  itemResolved: 'mq_item_resolved',
  itemOpenChat: 'mq_item_open_chat',
  itemOverflow: 'mq_item_overflow',
} as const;

/** Overflow option actions (encoded as `"<action>:<permanentQueueId>"`). */
export const SLACK_OVERFLOW_ACTIONS = {
  complete: 'complete',
  archive: 'archive',
  priorityRed: 'priority_red',
  priorityYellow: 'priority_yellow',
  priorityGreen: 'priority_green',
  followUp30m: 'followup_30m',
  followUpToday: 'followup_today',
  followUpTomorrow: 'followup_tomorrow',
  followUpMonday: 'followup_monday',
} as const;
export type SlackOverflowAction =
  (typeof SLACK_OVERFLOW_ACTIONS)[keyof typeof SLACK_OVERFLOW_ACTIONS];

/** The navigable views a user can switch between in App Home / slash replies. */
export const QueueView = {
  All: 'all',
  Red: 'red',
  Yellow: 'yellow',
  Green: 'green',
  Working: 'working',
  FollowUp: 'followup',
  Waiting: 'waiting',
  Snooze: 'snooze',
  Archive: 'archive',
} as const;
export type QueueView = (typeof QueueView)[keyof typeof QueueView];

/** Type guard narrowing an arbitrary string to a known {@link QueueView}. */
export function isQueueView(value: string): value is QueueView {
  return (Object.values(QueueView) as string[]).includes(value);
}

/** Default snooze duration (minutes) applied by the one-tap Snooze button. */
export const SLACK_DEFAULT_SNOOZE_MINUTES = 60;
