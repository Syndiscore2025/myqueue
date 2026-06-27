/**
 * Billing domain: subscription plans and their entitlements.
 *
 * Framework-free, single-source-of-truth value sets and pure rules for the SaaS
 * tier model. Members mirror the Prisma `WorkspacePlan` / plan-status columns
 * exactly (same string literals) so repository code can pass them to/from Prisma
 * without casts while the domain layer stays free of any infrastructure import.
 * Entitlement enforcement happens in the application layer; this module only
 * answers "what does plan X allow?" and "is N within that allowance?".
 */

/** The subscription tier a workspace is on. */
export const WorkspacePlan = {
  FREE: 'FREE',
  PRO: 'PRO',
  BUSINESS: 'BUSINESS',
} as const;
export type WorkspacePlan = (typeof WorkspacePlan)[keyof typeof WorkspacePlan];

/**
 * Billing status of a workspace's subscription. `ACTIVE` is the only state that
 * grants paid entitlements; `PAST_DUE` keeps access during dunning, `CANCELED`
 * has fallen back to Free-tier limits. Mirrors the Prisma column literals.
 */
export const WorkspacePlanStatus = {
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
} as const;
export type WorkspacePlanStatus = (typeof WorkspacePlanStatus)[keyof typeof WorkspacePlanStatus];

/**
 * What a plan allows. A `null` limit means "unlimited"; a numeric limit is the
 * inclusive maximum. Feature flags gate non-countable capabilities.
 */
export interface PlanEntitlements {
  /** Maximum number of simultaneously active (non-terminal) queue items. */
  readonly maxActiveItems: number | null;
  /** Maximum registered worker processes. */
  readonly maxWorkers: number | null;
  /** Maximum enabled recurrence rules. */
  readonly maxRecurrenceRules: number | null;
  /** Whether the opt-in daily digest notification is available. */
  readonly dailyDigest: boolean;
  /** Whether the analytics/usage reporting surface is available. */
  readonly analytics: boolean;
}

/** The entitlements granted by each plan. The Free tier is the safe default. */
export const PLAN_ENTITLEMENTS: Readonly<Record<WorkspacePlan, PlanEntitlements>> = {
  [WorkspacePlan.FREE]: {
    maxActiveItems: 50,
    maxWorkers: 1,
    maxRecurrenceRules: 3,
    dailyDigest: false,
    analytics: false,
  },
  [WorkspacePlan.PRO]: {
    maxActiveItems: 1000,
    maxWorkers: 10,
    maxRecurrenceRules: 50,
    dailyDigest: true,
    analytics: true,
  },
  [WorkspacePlan.BUSINESS]: {
    maxActiveItems: null,
    maxWorkers: null,
    maxRecurrenceRules: null,
    dailyDigest: true,
    analytics: true,
  },
};

/** Display order / upgrade ranking; higher rank is a richer plan. */
export const PLAN_RANK: Readonly<Record<WorkspacePlan, number>> = {
  [WorkspacePlan.FREE]: 0,
  [WorkspacePlan.PRO]: 1,
  [WorkspacePlan.BUSINESS]: 2,
};

/** The plans a workspace can purchase (everything above the free default). */
export const PURCHASABLE_PLANS: readonly WorkspacePlan[] = [
  WorkspacePlan.PRO,
  WorkspacePlan.BUSINESS,
];

/** Type guard: whether an arbitrary string is a known plan. */
export function isWorkspacePlan(value: unknown): value is WorkspacePlan {
  return typeof value === 'string' && value in PLAN_ENTITLEMENTS;
}

/**
 * The entitlements in force for a workspace. A non-active billing status (past
 * a grace period) falls back to the Free tier so a lapsed subscription cannot
 * retain paid limits. `PAST_DUE` retains the plan's entitlements during dunning.
 */
export function effectiveEntitlements(
  plan: WorkspacePlan,
  status: WorkspacePlanStatus = WorkspacePlanStatus.ACTIVE,
): PlanEntitlements {
  const effectivePlan = status === WorkspacePlanStatus.CANCELED ? WorkspacePlan.FREE : plan;
  return PLAN_ENTITLEMENTS[effectivePlan];
}

/**
 * Whether `count` items fit within `limit`. A `null` limit is unlimited. The
 * comparison is "would `count` be allowed", i.e. count must be <= limit.
 */
export function isWithinLimit(limit: number | null, count: number): boolean {
  return limit === null || count <= limit;
}

/**
 * Whether one more unit may be added given a limit and the current count. A
 * `null` limit is unlimited. Used by entitlement checks before a create.
 */
export function hasHeadroom(limit: number | null, currentCount: number): boolean {
  return limit === null || currentCount < limit;
}
