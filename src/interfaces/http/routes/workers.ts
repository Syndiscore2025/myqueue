import { Router } from 'express';
import { workerRegistryService } from '../../../application/queue';
import { asyncHandler } from '../../../utils/async-handler';
import { requireWorkspaceContext, workspaceContext } from '../middleware/workspace-context';

/**
 * Operator-facing worker registry API. Workers themselves auto-register on their
 * first claim or heartbeat (see {@link QueueClaimService}); this read-only route
 * lets an operator inspect the workspace's known workers. Guarded by
 * {@link workspaceContext} like the rest of the internal API.
 */
export const workersRouter = Router();

workersRouter.use(workspaceContext);

// List the workspace's registered workers, each with a live processing count.
workersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const workers = await workerRegistryService.list(ctx.workspaceId);
    res.status(200).json({ workers });
  }),
);
