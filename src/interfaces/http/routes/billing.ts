import { Router } from 'express';
import { billingService, entitlementService } from '../../../application/billing';
import { asyncHandler } from '../../../utils/async-handler';
import { requireWorkspaceContext, workspaceContext } from '../middleware/workspace-context';
import { startCheckoutSchema } from './billing.schemas';

/**
 * Workspace-facing billing API. Every route is tenant-scoped by
 * {@link workspaceContext}; the webhook receiver is intentionally NOT here — it
 * lives in {@link billingWebhookRouter}, mounted before the JSON parser so the
 * raw signed body is preserved for signature verification.
 */
export const billingRouter = Router();

billingRouter.use(workspaceContext);

// Read the workspace's current plan, billing status, and entitlements in force.
billingRouter.get(
  '/plan',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const plan = await entitlementService.getEntitlements(ctx.workspaceId);
    res.status(200).json({ plan });
  }),
);

// Start a hosted checkout session for upgrading to a purchasable plan. Returns
// the provider URL the client redirects the admin to.
billingRouter.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const body = startCheckoutSchema.parse(req.body);
    const session = await billingService.startCheckout(ctx.workspaceId, body.plan);
    res.status(200).json({ url: session.url });
  }),
);

// Open the self-serve billing portal so admins can manage/cancel a subscription.
billingRouter.post(
  '/portal',
  asyncHandler(async (req, res) => {
    const ctx = requireWorkspaceContext(req);
    const session = await billingService.startPortalSession(ctx.workspaceId);
    res.status(200).json({ url: session.url });
  }),
);
