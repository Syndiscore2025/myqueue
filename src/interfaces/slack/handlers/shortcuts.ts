import type { App, Context, MessageShortcut } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { queueService } from '../../../application/queue';
import { slackIdempotencyService } from '../../../application/slack';
import { QueueSourceType } from '../../../domain/queue';
import { createLogger } from '../../../utils/logger';
import { SLACK_CALLBACK_IDS } from '../constants';
import { buildItemCreatedModal, buildNoticeModal } from '../views';
import { resolveContext } from './identity';

const log = createLogger('slack-shortcuts');

/**
 * Build a generic queue-item title for a captured Slack message. We deliberately
 * never copy the message body — the channel name is the only context we surface,
 * so no third-party message content is ever persisted.
 */
export function buildMessageTitle(channelName: string | undefined): string {
  return channelName !== undefined && channelName.length > 0
    ? `Slack message in #${channelName}`
    : 'Slack message';
}

/**
 * Construct a permalink back to the original Slack message from shortcut metadata
 * alone — no API call and no message text. The link lets the owner jump to the
 * source in Slack, where Slack's own access controls still apply. Returns null
 * when the team domain is unavailable (e.g. some enterprise payloads).
 */
export function buildMessagePermalink(
  teamDomain: string | undefined,
  channelId: string,
  messageTs: string,
): string | null {
  if (teamDomain === undefined || teamDomain.length === 0) {
    return null;
  }
  return `https://${teamDomain}.slack.com/archives/${channelId}/p${messageTs.replace('.', '')}`;
}

/**
 * Create a queue item referencing the message the user invoked the shortcut on,
 * then open a confirmation modal. By design we store ONLY a privacy-safe
 * reference (channel/message/thread ids and a permalink) — never the message
 * body — so capturing someone's message never persists their words. The item is
 * owned by the acting user, tagged with the {@link QueueSourceType.SLACK_MESSAGE}
 * source, and its priority is auto-classified by the queue service. Guarded
 * against Slack retries by the interaction `trigger_id` so a re-delivery never
 * creates a duplicate item. On failure a notice modal explains the problem
 * instead of leaving the user without feedback.
 */
export async function handleAddMessage(
  shortcut: MessageShortcut,
  client: WebClient,
  context: Context,
): Promise<void> {
  try {
    const fresh = await slackIdempotencyService.claim(
      `slack:shortcut:add_message:${shortcut.trigger_id}`,
    );
    if (!fresh) {
      log.info({ user: shortcut.user.id }, 'ignoring duplicate add-message shortcut delivery');
      return;
    }
    const ctx = await resolveContext(context, shortcut.user.id);
    const channelId = shortcut.channel.id;
    const messageTs = shortcut.message_ts;
    const threadTs =
      typeof shortcut.message.thread_ts === 'string' ? shortcut.message.thread_ts : null;
    const item = await queueService.createItem(ctx, {
      title: buildMessageTitle(shortcut.channel.name),
      sourceType: QueueSourceType.SLACK_MESSAGE,
      sourceSlackChannelId: channelId,
      sourceSlackMessageTs: messageTs,
      sourceSlackThreadTs: threadTs,
      sourceSlackPermalink: buildMessagePermalink(shortcut.team?.domain, channelId, messageTs),
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
