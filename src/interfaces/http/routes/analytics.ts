import { Router } from 'express';
import { usageService } from '../../../application/billing';
import { asyncHandler } from '../../../utils/async-handler';
import { requireWorkspaceContext, workspaceContext } from '../middleware/workspace-context';

/**
 * Workspace analytics / usage reporting API. Tenant-scoped by
 * {@link workspaceContext}: every read is confined to the acting workspace. The
 * surface is a paid feature — {@link UsageService.getUsage} throws a 402 for a
 * plan without the analytics entitlement, which the error handler renders.
 */
export const analyticsRouter = Router();

analyticsRouter.use(workspaceContext);

// Report the workspace's plan plus its usage of each countable entitlement,
// including remaining headroom, for capacity and billing insight.
analyticsRouter.get(
  '/usage',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const usage = await usageService.getUsage(ctx.workspaceId);
    res.status(200).json({ usage });
  }),
);
