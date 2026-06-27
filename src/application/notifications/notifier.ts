import type { KnownBlock } from '@slack/types';

/**
 * A single direct-message notification. `text` is the required fallback string
 * shown in notifications and on clients that cannot render Block Kit; `blocks`
 * is the optional rich rendering. The shape is transport-agnostic enough that
 * the application layer never touches a Slack client directly — it speaks only
 * to the {@link Notifier} port, which an infrastructure adapter fulfils.
 */
export interface NotificationMessage {
  text: string;
  blocks?: KnownBlock[];
}

/**
 * Port for delivering direct-message notifications to a workspace user. The
 * application layer depends on this interface; the infrastructure layer provides
 * a Slack-backed implementation. Implementations MUST fail safe: a delivery
 * failure (uninstalled tenant, revoked token, transient Slack error) is logged
 * and reported as `false` rather than thrown, so a notification never breaks the
 * use case or background sweep that triggered it.
 */
export interface Notifier {
  /**
   * Deliver a DM to `slackUserId` within `workspaceId`. Resolves to `true` when
   * the message was accepted by the transport and `false` when it could not be
   * delivered. Never rejects.
   */
  dmUser(workspaceId: string, slackUserId: string, message: NotificationMessage): Promise<boolean>;
}
