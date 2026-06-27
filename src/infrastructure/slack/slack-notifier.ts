import type { KnownBlock } from '@slack/types';
import { WebClient } from '@slack/web-api';
import type { NotificationMessage, Notifier } from '../../application/notifications/notifier';
import { createLogger } from '../../utils/logger';
import { slackInstallationRepository, type SlackInstallationRepository } from '../repositories';

/**
 * The minimal slice of the Slack Web API the notifier needs: opening a DM
 * channel with a user and posting a message to it. Narrowing the surface keeps
 * the adapter testable with a tiny fake client and free of the full WebClient
 * type in its seams.
 */
export interface SlackDmClient {
  conversations: {
    open(options: { users: string }): Promise<{ channel?: { id?: string | undefined } | null }>;
  };
  chat: {
    postMessage(options: {
      channel: string;
      text: string;
      blocks?: KnownBlock[];
    }): Promise<unknown>;
  };
}

/** Builds a per-workspace Slack client from a decrypted bot token. */
export type SlackDmClientFactory = (token: string) => SlackDmClient;

/** Collaborators the notifier uses; injectable for testing. */
export interface SlackNotifierDeps {
  installations?: SlackInstallationRepository;
  clientFactory?: SlackDmClientFactory;
}

const defaultClientFactory: SlackDmClientFactory = (token) => new WebClient(token);

/**
 * Slack-backed {@link Notifier}. Resolves the target workspace's encrypted bot
 * token, opens (or reuses) the IM channel with the user, and posts the message.
 *
 * Every failure path — no installation, revoked/empty token, or a Slack API
 * error — is logged and reported as `false`. The adapter never throws, so a
 * notification can never break the use case or sweep that requested it.
 */
export class SlackNotifier implements Notifier {
  private readonly installations: SlackInstallationRepository;
  private readonly clientFactory: SlackDmClientFactory;
  private readonly log = createLogger('slack-notifier');

  constructor(deps: SlackNotifierDeps = {}) {
    this.installations = deps.installations ?? slackInstallationRepository;
    this.clientFactory = deps.clientFactory ?? defaultClientFactory;
  }

  async dmUser(
    workspaceId: string,
    slackUserId: string,
    message: NotificationMessage,
  ): Promise<boolean> {
    try {
      const token = await this.installations.getBotToken(workspaceId);
      if (token === null || token.length === 0) {
        this.log.warn({ workspaceId }, 'no bot token for workspace; skipping notification');
        return false;
      }

      const client = this.clientFactory(token);
      const opened = await client.conversations.open({ users: slackUserId });
      const channel = opened.channel?.id;
      if (channel === undefined || channel === null || channel.length === 0) {
        this.log.warn({ workspaceId, slackUserId }, 'could not open DM channel; skipping');
        return false;
      }

      await client.chat.postMessage({
        channel,
        text: message.text,
        ...(message.blocks === undefined ? {} : { blocks: message.blocks }),
      });
      return true;
    } catch (error) {
      this.log.error(
        { err: error, workspaceId, slackUserId },
        'failed to deliver Slack notification',
      );
      return false;
    }
  }
}

/** Process-wide Slack notifier bound to the shared installation repository. */
export const slackNotifier = new SlackNotifier();
