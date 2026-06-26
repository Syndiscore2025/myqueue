import type { Context } from '@slack/bolt';
import { slackIdentityService, type SlackIdentity } from '../../../application/slack';
import type { QueueContext } from '../../../application/queue';

/**
 * Build a {@link SlackIdentity} from a Bolt {@link Context} (which Bolt populates
 * from the verified request) and the acting Slack user id taken from the specific
 * payload. Keeping this in one place ensures every Slack entry point resolves its
 * tenant the same way.
 */
export function identityFromContext(context: Context, slackUserId: string): SlackIdentity {
  return {
    teamId: context.teamId ?? null,
    enterpriseId: context.enterpriseId ?? null,
    isEnterpriseInstall: context.isEnterpriseInstall ?? false,
    slackUserId,
  };
}

/**
 * Resolve the tenant-scoped {@link QueueContext} for a verified Slack request.
 * Thin wrapper over {@link identityFromContext} + the identity service so handlers
 * read as a single call.
 */
export function resolveContext(context: Context, slackUserId: string): Promise<QueueContext> {
  return slackIdentityService.resolveContext(identityFromContext(context, slackUserId));
}
