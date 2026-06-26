import type { ActionsBlock, Button, HomeView, KnownBlock, ModalView } from '@slack/types';
import { QueueView, SLACK_ACTION_IDS } from '../constants';
import {
  context,
  divider,
  escapeMrkdwn,
  header,
  itemBlocks,
  section,
  type QueueItemView,
} from './blocks';

/** Title shown at the top of each view. */
const VIEW_TITLES: Readonly<Record<QueueView, string>> = {
  [QueueView.All]: 'MyQueue',
  [QueueView.Red]: 'MyQueue · 🔴 Red',
  [QueueView.Yellow]: 'MyQueue · 🟡 Yellow',
  [QueueView.Green]: 'MyQueue · 🟢 Green',
  [QueueView.Working]: 'MyQueue · ⚡ Working',
  [QueueView.FollowUp]: 'MyQueue · 🔁 Follow Up',
  [QueueView.Waiting]: 'MyQueue · ⏳ Waiting',
  [QueueView.Snooze]: 'MyQueue · 😴 Snoozed',
  [QueueView.Archive]: 'MyQueue · 🗂️ Archive',
};

/** Friendly empty-state copy per view. */
const EMPTY_TEXT: Readonly<Record<QueueView, string>> = {
  [QueueView.All]: '🎉 Your active queue is empty.',
  [QueueView.Red]: 'No 🔴 red-priority items right now.',
  [QueueView.Yellow]: 'No 🟡 yellow-priority items right now.',
  [QueueView.Green]: 'No 🟢 green-priority items right now.',
  [QueueView.Working]: 'Nothing in progress.',
  [QueueView.FollowUp]: 'No follow-ups pending.',
  [QueueView.Waiting]: 'Nothing is waiting.',
  [QueueView.Snooze]: 'No snoozed items.',
  [QueueView.Archive]: 'Nothing archived yet.',
};

function navButton(view: QueueView, label: string, current: QueueView): Button {
  return {
    type: 'button',
    action_id: SLACK_ACTION_IDS.selectView,
    text: { type: 'plain_text', text: label, emoji: true },
    value: view,
    ...(view === current ? { style: 'primary' } : {}),
  };
}

/** Two rows of navigation: priority filters + refresh, then status views. */
function navBlocks(current: QueueView): ActionsBlock[] {
  const priorityRow: Button[] = [
    navButton(QueueView.All, 'All', current),
    navButton(QueueView.Red, '🔴 Red', current),
    navButton(QueueView.Yellow, '🟡 Yellow', current),
    navButton(QueueView.Green, '🟢 Green', current),
    {
      type: 'button',
      action_id: SLACK_ACTION_IDS.refresh,
      text: { type: 'plain_text', text: '🔄 Refresh', emoji: true },
      value: current,
    },
  ];
  const statusRow: Button[] = [
    navButton(QueueView.Working, '⚡ Working', current),
    navButton(QueueView.FollowUp, '🔁 Follow Up', current),
    navButton(QueueView.Waiting, '⏳ Waiting', current),
    navButton(QueueView.Snooze, '😴 Snoozed', current),
    navButton(QueueView.Archive, '🗂️ Archive', current),
  ];
  return [
    { type: 'actions', block_id: 'mq_nav_priority', elements: priorityRow },
    { type: 'actions', block_id: 'mq_nav_status', elements: statusRow },
  ];
}

/**
 * Build the Block Kit blocks for a queue view: a header, the navigation rows,
 * and either an empty-state line or the listed items. Archived items render
 * read-only; every other view exposes per-item action buttons.
 */
export function buildQueueBlocks(view: QueueView, items: readonly QueueItemView[]): KnownBlock[] {
  const blocks: KnownBlock[] = [header(VIEW_TITLES[view]), ...navBlocks(view), divider()];
  if (items.length === 0) {
    blocks.push(section(EMPTY_TEXT[view]));
    return blocks;
  }
  const withActions = view !== QueueView.Archive;
  items.forEach((item, index) => {
    if (index > 0) {
      blocks.push(divider());
    }
    blocks.push(...itemBlocks(item, { withActions }));
  });
  return blocks;
}

/**
 * Wrap the queue blocks as an App Home (`home`) view payload. The active view is
 * stored in `private_metadata` so interaction handlers can re-render the same
 * view after an action without tracking client state.
 */
export function buildAppHomeView(view: QueueView, items: readonly QueueItemView[]): HomeView {
  return { type: 'home', private_metadata: view, blocks: buildQueueBlocks(view, items) };
}

/** Confirmation modal shown after the "Add to MyQueue" shortcut creates an item. */
export function buildItemCreatedModal(
  item: Pick<QueueItemView, 'permanentQueueId' | 'title' | 'priority'>,
): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Added to MyQueue' },
    close: { type: 'plain_text', text: 'Done' },
    blocks: [
      section(`:white_check_mark: *${escapeMrkdwn(item.title)}* was added to your queue.`),
      context(`\`${item.permanentQueueId}\` · ${item.priority} priority`),
    ],
  };
}

/** Generic single-message modal, used to surface a shortcut failure to the user. */
export function buildNoticeModal(title: string, message: string): ModalView {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: title },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [section(message)],
  };
}
