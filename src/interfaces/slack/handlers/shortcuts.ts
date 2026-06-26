import type { App, Context, MessageShortcut } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { queueService } from '../../../application/queue';
import { QueueSourceType } from '../../../domain/queue';
import { createLogger } from '../../../utils/logger';
import { SLACK_CALLBACK_IDS } from '../constants';
import { buildItemCreatedModal, buildNoticeModal } from '../views';
import { resolveContext } from './identity';

const log = createLogger('slack-shortcuts');

/** Longest title we derive from a message before truncating with an ellipsis. */
const MAX_TITLE_LENGTH = 200;

/**
 * Derive a concise queue-item title from a Slack message body: the first
 * non-empty line, trimmed and truncated. Falls back to a generic label when the
 * message has no text (e.g. a file-only or block-only message).
 */
export function deriveTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) {
    return 'Slack message';
  }
  return firstLine.length > MAX_TITLE_LENGTH
    ? `${firstLine.slice(0, MAX_TITLE_LENGTH - 1)}…`
    : firstLine;
}

/**
 * Create a queue item from the message the user invoked the shortcut on, then
 * open a confirmation modal. The item is owned by the acting user, tagged with
 * the {@link QueueSourceType.SLACK_MESSAGE} source, and its priority is
 * auto-classified by the queue service. On failure a notice modal explains the
 * problem instead of leaving the user without feedback.
 */
export async function handleAddMessage(
  shortcut: MessageShortcut,
  client: WebClient,
  context: Context,
): Promise<void> {
  const text = shortcut.message.text ?? '';
  try {
    const ctx = await resolveContext(context, shortcut.user.id);
    const item = await queueService.createItem(ctx, {
      title: deriveTitle(text),
      summary: text.length > 0 ? text : null,
      sourceType: QueueSourceType.SLACK_MESSAGE,
    });
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: buildItemCreatedModal(item),
    });
  } catch (error) {
    log.error({ err: error, user: shortcut.user.id }, 'failed to add message to queue');
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: buildNoticeModal(
        'MyQueue',
        'Could not add this message. Make sure MyQueue is installed for this workspace.',
      ),
    });
  }
}

/** Register the "Add to MyQueue" message shortcut listener. */
export function registerShortcuts(app: App): void {
  app.shortcut(
    SLACK_CALLBACK_IDS.addMessageShortcut,
    async ({ shortcut, ack, client, context }) => {
      await ack();
      if (shortcut.type !== 'message_action') {
        return;
      }
      await handleAddMessage(shortcut, client, context);
    },
  );
}
