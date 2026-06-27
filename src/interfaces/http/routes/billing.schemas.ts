import { z } from 'zod';
import { PURCHASABLE_PLANS, WorkspacePlan } from '../../../domain/billing';

/** Schema mirroring the full plan value set (includes the non-purchasable FREE). */
export const workspacePlanSchema = z.nativeEnum(WorkspacePlan);

/**
 * The plan accepted when starting checkout. Restricted to purchasable tiers so a
 * request to "buy" the Free plan is rejected at the edge with a 400 rather than
 * reaching the billing service.
 */
export const purchasablePlanSchema = z.enum(
  PURCHASABLE_PLANS as [WorkspacePlan, ...WorkspacePlan[]],
);

/** Body for starting a hosted checkout session for a workspace plan purchase. */
export const startCheckoutSchema = z.object({
  plan: purchasablePlanSchema,
});
