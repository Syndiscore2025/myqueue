import { Router } from 'express';
import { entitlementService } from '../../../application/billing';
import { queueService } from '../../../application/queue';
import { asyncHandler } from '../../../utils/async-handler';
import { requireWorkspaceContext, workspaceContext } from '../middleware/workspace-context';
import { updateWorkspaceSettingsSchema } from './workspace.schemas';

/**
 * Workspace settings API. Tenant-scoped by {@link workspaceContext}. Exposes the
 * workspace's queue + notification settings (read/patch) and a consolidated view
 * of its plan and entitlements, giving the SaaS surface user-facing control over
 * the notification preferences Phase 5 introduced but never surfaced.
 */
export const workspaceRouter = Router();

workspaceRouter.use(workspaceContext);

// Read the workspace's queue + notification settings together with its plan and
// the entitlements currently in force.
workspaceRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const [settings, plan] = await Promise.all([
      queueService.getSettings(ctx),
      entitlementService.getEntitlements(ctx.workspaceId),
    ]);
    res.status(200).json({ settings, plan });
  }),
);

// Patch one or more queue/notification settings for the workspace.
workspaceRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const parsed = updateWorkspaceSettingsSchema.parse(req.body);
    // Spread only the provided keys so optional fields stay absent rather than
    // explicitly `undefined`, matching WorkspaceQueueSettingsUpdate under
    // exactOptionalPropertyTypes.
    const changes = {
      ...(parsed.rankingMode === undefined ? {} : { rankingMode: parsed.rankingMode }),
      ...(parsed.includeWaitingInActive === undefined
        ? {}
        : { includeWaitingInActive: parsed.includeWaitingInActive }),
      ...(parsed.includeWorkingInActive === undefined
        ? {}
        : { includeWorkingInActive: parsed.includeWorkingInActive }),
      ...(parsed.notifyOnAssignment === undefined
        ? {}
        : { notifyOnAssignment: parsed.notifyOnAssignment }),
      ...(parsed.notifyOnSnoozeWake === undefined
        ? {}
        : { notifyOnSnoozeWake: parsed.notifyOnSnoozeWake }),
      ...(parsed.notifyOnFollowUpDue === undefined
        ? {}
        : { notifyOnFollowUpDue: parsed.notifyOnFollowUpDue }),
      ...(parsed.dailyDigestEnabled === undefined
        ? {}
        : { dailyDigestEnabled: parsed.dailyDigestEnabled }),
      ...(parsed.dailyDigestHourUtc === undefined
        ? {}
        : { dailyDigestHourUtc: parsed.dailyDigestHourUtc }),
    };
    const settings = await queueService.updateSettings(ctx, changes);
    res.status(200).json({ settings });
  }),
);
