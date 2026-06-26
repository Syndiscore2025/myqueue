import { NotFoundError } from '../../domain/errors';
import { workspaceRepository, type WorkspaceRepository } from '../../infrastructure/repositories';
import type { QueueContext } from '../queue';

/**
 * Slack-side identity of an acting user, as supplied by a verified Slack payload
 * (shortcut, command, interaction, or event). The tenant is identified by team
 * id (or enterprise id for enterprise-grid installs); the actor by Slack user id.
 */
export interface SlackIdentity {
  teamId?: string | null;
  enterpriseId?: string | null;
  isEnterpriseInstall?: boolean;
  slackUserId: string;
  displayName?: string | null;
}

/** Collaborators the service orchestrates; injectable for testing. */
export interface SlackIdentityServiceDeps {
  workspaces?: WorkspaceRepository;
}

/**
 * Translate a verified Slack identity into the internal {@link QueueContext} that
 * the queue application services require. This is the single bridge between the
 * Slack surface and the tenant-scoped queue engine: it resolves the installed
 * workspace by its Slack tenant identity and ensures the acting user exists as a
 * {@link import('@prisma/client').WorkspaceUser}, returning the internal ids so
 * every downstream query and audit record stays scoped by `workspaceId`.
 *
 * It performs no business logic of its own; Slack payload parsing lives in the
 * interface adapters and queue orchestration lives in the queue services.
 */
export class SlackIdentityService {
  private readonly workspaces: WorkspaceRepository;

  constructor(deps: SlackIdentityServiceDeps = {}) {
    this.workspaces = deps.workspaces ?? workspaceRepository;
  }

  /**
   * Resolve the acting tenant/user context for a Slack request. Upserts the
   * Slack user into the workspace (idempotent) so items can be owned by, and
   * audited against, a stable internal `workspaceUserId`. Throws
   * {@link NotFoundError} when no active installation exists for the tenant.
   */
  async resolveContext(identity: SlackIdentity): Promise<QueueContext> {
    const workspace = await this.workspaces.findByTenant({
      teamId: identity.teamId ?? null,
      enterpriseId: identity.enterpriseId ?? null,
      ...(identity.isEnterpriseInstall === undefined
        ? {}
        : { isEnterpriseInstall: identity.isEnterpriseInstall }),
    });
    if (workspace === null) {
      throw new NotFoundError('No MyQueue installation found for this Slack workspace');
    }

    const user = await this.workspaces.upsertUser(workspace.id, {
      slackUserId: identity.slackUserId,
      ...(identity.displayName === undefined || identity.displayName === null
        ? {}
        : { displayName: identity.displayName }),
    });

    return { workspaceId: workspace.id, workspaceUserId: user.id };
  }
}

/** Process-wide identity service bound to the shared workspace repository. */
export const slackIdentityService = new SlackIdentityService();
