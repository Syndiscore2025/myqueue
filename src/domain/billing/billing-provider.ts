import type { WorkspacePlan, WorkspacePlanStatus } from './plan';

/**
 * Billing domain: the payment-provider port.
 *
 * The abstract contract the application layer depends on to start a paid
 * subscription and to react to provider lifecycle events. It is framework- and
 * vendor-free: the concrete Stripe adapter lives in the infrastructure layer and
 * implements this interface. Keeping the port here means the application's
 * BillingService never imports Stripe-specific code.
 */

/** Request to open a hosted checkout for a workspace upgrading to `plan`. */
export interface CheckoutSessionRequest {
  /** The tenant initiating checkout; carried back on the resulting event. */
  workspaceId: string;
  /** The plan being purchased (must be a purchasable tier, not FREE). */
  plan: WorkspacePlan;
  /** Existing provider customer id to reuse, when the workspace already has one. */
  stripeCustomerId?: string | null;
  /** Where the provider returns the user after a completed/cancelled checkout. */
  successUrl: string;
  cancelUrl: string;
}

/** The hosted checkout URL the caller redirects the user to. */
export interface CheckoutSession {
  url: string;
}

/** Request to open the provider's self-serve billing/management portal. */
export interface PortalSessionRequest {
  stripeCustomerId: string;
  returnUrl: string;
}

/** The hosted portal URL the caller redirects the user to. */
export interface PortalSession {
  url: string;
}

/**
 * The provider-agnostic subscription change distilled from a verified webhook.
 * `plan`/`status` are already mapped to the domain's own enums so the
 * application layer never sees Stripe vocabulary. `workspaceId` is resolved from
 * the event when present; otherwise the caller maps via `stripeCustomerId`.
 */
export interface SubscriptionChange {
  workspaceId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: WorkspacePlan;
  status: WorkspacePlanStatus;
}

/**
 * A verified, parsed billing event. `subscriptionChange` is present for the
 * subscription lifecycle events the application acts on; it is null for events
 * that were verified but are not actionable (so callers can ack-and-ignore).
 */
export interface BillingEvent {
  id: string;
  type: string;
  subscriptionChange: SubscriptionChange | null;
}

/**
 * The payment provider port. Implementations MUST verify webhook authenticity
 * before returning a {@link BillingEvent}; an unverifiable payload must throw so
 * the application never acts on a forged event.
 */
export interface BillingProvider {
  /** Create a hosted checkout session for a workspace's plan purchase. */
  createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession>;

  /** Create a self-serve billing portal session for an existing customer. */
  createPortalSession(request: PortalSessionRequest): Promise<PortalSession>;

  /**
   * Verify a raw webhook body against its signature header and parse it into a
   * domain {@link BillingEvent}. Throws when the signature is missing/invalid.
   */
  verifyAndParseEvent(rawBody: string, signatureHeader: string): BillingEvent;
}
