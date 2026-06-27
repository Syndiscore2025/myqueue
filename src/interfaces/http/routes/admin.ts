import { Router } from 'express';
import { entitlementService } from '../../../application/billing';
import { queueStatisticsService } from '../../../application/queue';
import { workspaceRepository } from '../../../infrastructure/repositories';
import { NotFoundError } from '../../../domain/errors';
import { asyncHandler } from '../../../utils/async-handler';
import { requireWorkspaceContext, workspaceContext } from '../middleware/workspace-context';

/**
 * Workspace-admin overview API. Tenant-scoped by {@link workspaceContext}: every
 * read is confined to the acting workspace, so this never exposes another
 * tenant's data. It consolidates the workspace's identity, billing posture, the
 * entitlements currently in force, and live queue statistics into a single view
 * for an operator/admin dashboard. Raw Stripe identifiers are intentionally not
 * echoed; only whether a paid subscription is connected is surfaced.
 */
export const adminRouter = Router();

adminRouter.use(workspaceContext);

adminRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const [workspace, plan, statistics] = await Promise.all([
      workspaceRepository.findById(ctx.workspaceId),
      entitlementService.getEntitlements(ctx.workspaceId),
      queueStatisticsService.get(ctx.workspaceId),
    ]);
    if (workspace === null) {
      throw new NotFoundError('Workspace not found');
    }
    res.status(200).json({
      workspace: {
        id: workspace.id,
        slackTeamName: workspace.slackTeamName,
        isEnterpriseInstall: workspace.isEnterpriseInstall,
        status: workspace.status,
        installedAt: workspace.installedAt,
        createdAt: workspace.createdAt,
      },
      billing: {
        plan: workspace.plan,
        status: workspace.planStatus,
        hasActiveSubscription: workspace.stripeSubscriptionId !== null,
        planUpdatedAt: workspace.planUpdatedAt,
      },
      entitlements: plan.entitlements,
      statistics,
    });
  }),
);
