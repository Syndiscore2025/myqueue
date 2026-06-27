import {
  PLAN_ENTITLEMENTS,
  PLAN_RANK,
  PURCHASABLE_PLANS,
  WorkspacePlan,
  WorkspacePlanStatus,
  effectiveEntitlements,
  hasHeadroom,
  isWithinLimit,
  isWorkspacePlan,
} from '../../src/domain/billing';

describe('plan entitlements table', () => {
  it('grants Free the safe, capped defaults', () => {
    expect(PLAN_ENTITLEMENTS[WorkspacePlan.FREE]).toEqual({
      maxActiveItems: 50,
      maxWorkers: 1,
      maxRecurrenceRules: 3,
      dailyDigest: false,
      analytics: false,
    });
  });

  it('unlocks paid features on Pro and removes all caps on Business', () => {
    expect(PLAN_ENTITLEMENTS[WorkspacePlan.PRO].analytics).toBe(true);
    expect(PLAN_ENTITLEMENTS[WorkspacePlan.PRO].dailyDigest).toBe(true);
    const business = PLAN_ENTITLEMENTS[WorkspacePlan.BUSINESS];
    expect(business.maxActiveItems).toBeNull();
    expect(business.maxWorkers).toBeNull();
    expect(business.maxRecurrenceRules).toBeNull();
    expect(business.analytics).toBe(true);
  });
});

describe('plan ranking and purchasable tiers', () => {
  it('ranks Free < Pro < Business', () => {
    expect(PLAN_RANK[WorkspacePlan.FREE]).toBeLessThan(PLAN_RANK[WorkspacePlan.PRO]);
    expect(PLAN_RANK[WorkspacePlan.PRO]).toBeLessThan(PLAN_RANK[WorkspacePlan.BUSINESS]);
  });

  it('lists only the paid tiers as purchasable, excluding Free', () => {
    expect(PURCHASABLE_PLANS).toEqual([WorkspacePlan.PRO, WorkspacePlan.BUSINESS]);
    expect(PURCHASABLE_PLANS).not.toContain(WorkspacePlan.FREE);
  });
});

describe('isWorkspacePlan', () => {
  it('accepts known plan literals and rejects everything else', () => {
    expect(isWorkspacePlan(WorkspacePlan.PRO)).toBe(true);
    expect(isWorkspacePlan('FREE')).toBe(true);
    expect(isWorkspacePlan('gold')).toBe(false);
    expect(isWorkspacePlan(null)).toBe(false);
    expect(isWorkspacePlan(2)).toBe(false);
  });
});

describe('effectiveEntitlements', () => {
  it('returns the plan entitlements while ACTIVE (the default status)', () => {
    expect(effectiveEntitlements(WorkspacePlan.PRO)).toBe(PLAN_ENTITLEMENTS[WorkspacePlan.PRO]);
  });

  it('retains the plan entitlements during PAST_DUE dunning', () => {
    expect(effectiveEntitlements(WorkspacePlan.BUSINESS, WorkspacePlanStatus.PAST_DUE)).toBe(
      PLAN_ENTITLEMENTS[WorkspacePlan.BUSINESS],
    );
  });

  it('falls back to Free entitlements once CANCELED', () => {
    expect(effectiveEntitlements(WorkspacePlan.BUSINESS, WorkspacePlanStatus.CANCELED)).toBe(
      PLAN_ENTITLEMENTS[WorkspacePlan.FREE],
    );
  });
});

describe('limit helpers', () => {
  it('isWithinLimit treats null as unlimited and is inclusive of the limit', () => {
    expect(isWithinLimit(null, 10_000)).toBe(true);
    expect(isWithinLimit(50, 50)).toBe(true);
    expect(isWithinLimit(50, 51)).toBe(false);
  });

  it('hasHeadroom treats null as unlimited and is exclusive of the limit', () => {
    expect(hasHeadroom(null, 10_000)).toBe(true);
    expect(hasHeadroom(50, 49)).toBe(true);
    expect(hasHeadroom(50, 50)).toBe(false);
  });
});
