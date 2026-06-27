import {
  WorkspacePlan,
  WorkspacePlanStatus,
  type BillingEvent,
  type SubscriptionChange,
} from '../../domain/billing';

/** The Stripe configuration the adapter and mappers read. */
export interface StripeProviderConfig {
  secretKey: string;
  webhookSecret: string;
  priceProId: string;
  priceBusinessId: string;
}

/** The subscription lifecycle events the application acts on. */
const ACTIONABLE_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

/** Resolve the configured Stripe price id for a purchasable plan ('' if none). */
export function priceIdForPlan(config: StripeProviderConfig, plan: WorkspacePlan): string {
  switch (plan) {
    case WorkspacePlan.PRO:
      return config.priceProId;
    case WorkspacePlan.BUSINESS:
      return config.priceBusinessId;
    default:
      return '';
  }
}

/** Reverse lookup: map a Stripe price id back to its plan, or null if unknown. */
export function planForPriceId(
  config: StripeProviderConfig,
  priceId: string,
): WorkspacePlan | null {
  if (priceId.length > 0 && priceId === config.priceProId) {
    return WorkspacePlan.PRO;
  }
  if (priceId.length > 0 && priceId === config.priceBusinessId) {
    return WorkspacePlan.BUSINESS;
  }
  return null;
}

/**
 * Map a Stripe subscription status to the domain billing status. `active` and
 * `trialing` grant entitlements; `past_due`/`unpaid` keep access during dunning;
 * everything else (canceled, incomplete, paused, ...) falls back to CANCELED so
 * a lapsed subscription cannot retain paid limits.
 */
export function mapStripeStatus(stripeStatus: string): WorkspacePlanStatus {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return WorkspacePlanStatus.ACTIVE;
    case 'past_due':
    case 'unpaid':
      return WorkspacePlanStatus.PAST_DUE;
    default:
      return WorkspacePlanStatus.CANCELED;
  }
}

/** Safely read a nested string field from an untyped object graph. */
function str(obj: unknown, ...path: string[]): string | null {
  let current: unknown = obj;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : null;
}

/**
 * Extract the first line-item / subscription price id from a Stripe event's data
 * object, checking the shapes used by checkout sessions and subscription objects.
 */
function extractPriceId(dataObject: Record<string, unknown>): string | null {
  const items = dataObject.items;
  if (typeof items === 'object' && items !== null) {
    const data = (items as Record<string, unknown>).data;
    if (Array.isArray(data) && data.length > 0) {
      const price = str(data[0], 'price', 'id');
      if (price !== null) return price;
    }
  }
  return null;
}

/**
 * Parse a verified Stripe event payload into a domain {@link BillingEvent}. For
 * actionable subscription events it derives a {@link SubscriptionChange} mapped
 * to domain enums; non-actionable events parse to a null change so callers can
 * acknowledge and ignore them.
 */
export function parseStripeEvent(
  config: StripeProviderConfig,
  payload: Record<string, unknown>,
): BillingEvent {
  const id = str(payload, 'id') ?? '';
  const type = str(payload, 'type') ?? '';
  if (!ACTIONABLE_EVENT_TYPES.has(type)) {
    return { id, type, subscriptionChange: null };
  }
  const dataObject = (payload.data as Record<string, unknown> | undefined)?.object as
    | Record<string, unknown>
    | undefined;
  if (dataObject === undefined) {
    return { id, type, subscriptionChange: null };
  }

  const workspaceId =
    str(dataObject, 'metadata', 'workspaceId') ?? str(dataObject, 'client_reference_id');
  const stripeCustomerId = str(dataObject, 'customer');
  const stripeSubscriptionId =
    str(dataObject, 'subscription') ?? (type.startsWith('customer.subscription') ? id : null);

  let plan: WorkspacePlan = WorkspacePlan.FREE;
  let status: WorkspacePlanStatus = WorkspacePlanStatus.ACTIVE;
  if (type === 'customer.subscription.deleted') {
    status = WorkspacePlanStatus.CANCELED;
  } else {
    const priceId = extractPriceId(dataObject);
    plan = (priceId !== null ? planForPriceId(config, priceId) : null) ?? WorkspacePlan.FREE;
    const stripeStatus = str(dataObject, 'status');
    status = stripeStatus !== null ? mapStripeStatus(stripeStatus) : WorkspacePlanStatus.ACTIVE;
  }

  const change: SubscriptionChange = {
    workspaceId,
    stripeCustomerId,
    stripeSubscriptionId: stripeSubscriptionId === id ? null : stripeSubscriptionId,
    plan,
    status,
  };
  return { id, type, subscriptionChange: change };
}
