import type { App, Context } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { queueService } from '../../../application/queue';
import { slackIdempotencyService } from '../../../application/slack';
import { QueueSourceType, priorityClassificationService, type QueuePriority } from '../../../domain/queue';
import { createLogger } from '../../../utils/logger';
import { resolveContext } from './identity';

const log = createLogger('slack-message-events');
export const SLACK_ATTENTION_BURST_WINDOW_MS = 5 * 60_000;

interface SlackMessageEvent {
  type: 'message';
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  ts?: string;
  thread_ts?: string;
  text?: string;
}

interface SlackEventBody {
  event_id?: string;
}

/** Extract unique Slack user mentions (`<@U...>`) from mrkdwn text. */
export function mentionedUserIds(text: string | undefined): string[] {
  if (text === undefined) {
    return [];
  }
  const users = new Set<string>();
  for (const match of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)) {
    const userId = match[1];
    if (userId !== undefined) {
      users.add(userId);
    }
  }
  return [...users];
}

function shouldIgnoreMessage(event: SlackMessageEvent): boolean {
  return (
    event.subtype !== undefined ||
    event.bot_id !== undefined ||
    event.user === undefined ||
    event.channel === undefined ||
    event.ts === undefined
  );
}

function isDirectMessage(event: SlackMessageEvent): boolean {
  return event.channel_type === 'im';
}

async function directMessageRecipientIds(
  event: SlackMessageEvent,
  context: Context,
  client: WebClient,
): Promise<string[]> {
  if (!isDirectMessage(event)) {
    return [];
  }
  try {
    const userToken = context.userToken;
    const result = await client.conversations.members({
      channel: event.channel!,
      ...(userToken === undefined || userToken.length === 0 ? {} : { token: userToken }),
    });
    const members = Array.isArray(result.members)
      ? result.members.filter((member): member is string => typeof member === 'string')
      : [];
    const recipients = members.filter(
      (member) => member !== event.user && member !== context.botUserId,
    );
    if (userToken !== undefined && userToken.length > 0) {
      return context.userId !== undefined && recipients.includes(context.userId)
        ? [context.userId]
        : [];
    }
    return recipients;
  } catch (error) {
    log.warn({ err: error, channel: event.channel }, 'could not resolve Slack DM recipient');
    return [];
  }
}

async function attentionOwnerIds(
  event: SlackMessageEvent,
  context: Context,
  client: WebClient,
): Promise<string[]> {
  if (isDirectMessage(event)) {
    return directMessageRecipientIds(event, context, client);
  }
  const senderSlackUserId = event.user!;
  const mentioned = mentionedUserIds(event.text).filter((userId) => userId !== senderSlackUserId);
  if (mentioned.length > 0) {
    return mentioned;
  }
  return [];
}

export function classifyAttentionPriority(event: SlackMessageEvent): QueuePriority {
  return priorityClassificationService.classify({
    text: event.text ?? '',
    mentionsOwner: !isDirectMessage(event),
  }).priority;
}

async function getPermalink(
  client: WebClient,
  channel: string,
  messageTs: string,
): Promise<string | null> {
  try {
    const result = await client.chat.getPermalink({ channel, message_ts: messageTs });
    return typeof result.permalink === 'string' ? result.permalink : null;
  } catch (error) {
    log.warn({ err: error, channel }, 'could not resolve Slack message permalink');
    return null;
  }
}

/**
 * Automatically create name-only attention pointers for observable Slack messages.
 * The message body is used only in-memory to detect direct mentions; 1:1 DMs use
 * conversation membership metadata instead. Message text is never persisted or
 * rendered in MyQueue.
 */
export async function handleMessageEvent(
  event: SlackMessageEvent,
  body: SlackEventBody,
  context: Context,
  client: WebClient,
): Promise<void> {
  if (shouldIgnoreMessage(event)) {
    return;
  }

  const senderSlackUserId = event.user!;
  const owners = await attentionOwnerIds(event, context, client);
  if (owners.length === 0) {
    return;
  }

  const senderCtx = await resolveContext(context, senderSlackUserId);
  const permalink = await getPermalink(client, event.channel!, event.ts!);
  const threadKey = event.thread_ts ?? null;
  for (const ownerSlackUserId of owners) {
    const idempotencyKey = `slack:event:message:${body.event_id ?? event.ts}:${ownerSlackUserId}`;
    const fresh = await slackIdempotencyService.claim(idempotencyKey);
    if (!fresh) {
      continue;
    }
    const ownerCtx = await resolveContext(context, ownerSlackUserId);
    if (ownerCtx.workspaceId !== senderCtx.workspaceId) {
      continue;
    }
    await queueService.createOrUpdateSlackAttention(senderCtx, {
      title: 'Slack attention',
      ownerWorkspaceUserId: ownerCtx.workspaceUserId,
      priority: classifyAttentionPriority(event),
      sourceType: QueueSourceType.SLACK_MESSAGE,
      sourceSlackChannelId: event.channel!,
      sourceSlackUserId: senderSlackUserId,
      sourceSlackMessageTs: event.ts!,
      sourceSlackThreadTs: threadKey,
      sourceSlackPermalink: permalink,
    }, SLACK_ATTENTION_BURST_WINDOW_MS);
  }
}

/** Register automatic message capture for Slack Events API message deliveries. */
export function registerMessageEvents(app: App): void {
  app.event('message', async ({ event, body, context, client }) => {
    try {
      await handleMessageEvent(
        event as SlackMessageEvent,
        body,
        context,
        client,
      );
    } catch (error) {
      log.error({ err: error }, 'failed to auto-capture Slack message attention pointer');
    }
  });
}