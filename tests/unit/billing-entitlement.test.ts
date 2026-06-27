import { EntitlementService, UsageService } from '../../src/application/billing';
import { PaymentRequiredError } from '../../src/domain/errors';
import { WorkspacePlan, WorkspacePlanStatus } from '../../src/domain/billing';
import type {
  QueueItemRepository,
  WorkspaceRepository,
} from '../../src/infrastructure/repositories';

const WID = 'w1';

function buildEntitlement(): {
  svc: EntitlementService;
  workspaces: { findById: jest.Mock };
  items: { countActive: jest.Mock };
} {
  const workspaces = { findById: jest.fn() };
  const items = { countActive: jest.fn() };
  const svc = new EntitlementService({
    workspaces: workspaces as unknown as WorkspaceRepository,
    items: items as unknown as QueueItemRepository,
  });
  return { svc, workspaces, items };
}

describe('EntitlementService.getEntitlements', () => {
  it('fails safe to the Free tier when the workspace is unknown', async () => {
    const { svc, workspaces } = buildEntitlement();
    workspaces.findById.mockResolvedValue(null);

    const result = await svc.getEntitlements(WID);

    expect(result.plan).toBe(WorkspacePlan.FREE);
    expect(result.status).toBe(WorkspacePlanStatus.ACTIVE);
    expect(result.entitlements.analytics).toBe(false);
    expect(workspaces.findById).toHaveBeenCalledWith(WID);
  });

  it('returns the workspace plan and live entitlements when ACTIVE', async () => {
    const { svc, workspaces } = buildEntitlement();
    workspaces.findById.mockResolvedValue({
      plan: WorkspacePlan.PRO,
      planStatus: WorkspacePlanStatus.ACTIVE,
    });

    const result = await svc.getEntitlements(WID);

    expect(result.plan).toBe(WorkspacePlan.PRO);
    expect(result.entitlements.analytics).toBe(true);
  });

  it('reports the plan but drops to Free entitlements once CANCELED', async () => {
    const { svc, workspaces } = buildEntitlement();
    workspaces.findById.mockResolvedValue({
      plan: WorkspacePlan.BUSINESS,
      planStatus: WorkspacePlanStatus.CANCELED,
    });

    const result = await svc.getEntitlements(WID);

    expect(result.plan).toBe(WorkspacePlan.BUSINESS);
    expect(result.entitlements.maxActiveItems).toBe(50);
    expect(result.entitlements.analytics).toBe(false);
  });
});

describe('EntitlementService item-cap enforcement', () => {
  it('allows creation without counting when the plan is unlimited (Business)', async () => {
    const { svc, workspaces, items } = buildEntitlement();
    workspaces.findById.mockResolvedValue({
      plan: WorkspacePlan.BUSINESS,
      planStatus: WorkspacePlanStatus.ACTIVE,
    });

    await expect(svc.canCreateItem(WID)).resolves.toBe(true);
    await expect(svc.assertCanCreateItem(WID)).resolves.toBeUndefined();
    expect(items.countActive).not.toHaveBeenCalled();
  });

  it('allows creation with headroom and blocks at the cap (Free)', async () => {
    const { svc, workspaces, items } = buildEntitlement();
    workspaces.findById.mockResolvedValue({
      plan: WorkspacePlan.FREE,
      planStatus: WorkspacePlanStatus.ACTIVE,
    });
    items.countActive.mockResolvedValueOnce(49).mockResolvedValueOnce(50);

    await expect(svc.canCreateItem(WID)).resolves.toBe(true);
    await expect(svc.canCreateItem(WID)).resolves.toBe(false);
    expect(items.countActive).toHaveBeenCalledWith(WID);
  });

  it('throws a 402 PaymentRequiredError at the active-item cap', async () => {
    const { svc, workspaces, items } = buildEntitlement();
    workspaces.findById.mockResolvedValue({
      plan: WorkspacePlan.FREE,
      planStatus: WorkspacePlanStatus.ACTIVE,
    });
    items.countActive.mockResolvedValue(50);

    await expect(svc.assertCanCreateItem(WID)).rejects.toBeInstanceOf(PaymentRequiredError);
  });
});

describe('UsageService.getUsage', () => {
  function buildUsage(entitlements: unknown): {
    svc: UsageService;
    ent: { getEntitlements: jest.Mock };
    items: { countActive: jest.Mock };
    workers: { list: jest.Mock };
    recurrence: { list: jest.Mock };
  } {
    const ent = { getEntitlements: jest.fn().mockResolvedValue(entitlements) };
    const items = { countActive: jest.fn().mockResolvedValue(10) };
    const workers = { list: jest.fn().mockResolvedValue([{}, {}]) };
    const recurrence = { list: jest.fn().mockResolvedValue([{}]) };
    const svc = new UsageService({
      entitlements: ent as unknown as EntitlementService,
      items: items as never,
      workers: workers as never,
      recurrence: recurrence as never,
    });
    return { svc, ent, items, workers, recurrence };
  }

  it('rejects with 402 and never counts when analytics is not entitled', async () => {
    const { svc, items } = buildUsage({
      plan: WorkspacePlan.FREE,
      status: WorkspacePlanStatus.ACTIVE,
      entitlements: { ...{ maxActiveItems: 50 }, analytics: false },
    });

    await expect(svc.getUsage(WID)).rejects.toBeInstanceOf(PaymentRequiredError);
    expect(items.countActive).not.toHaveBeenCalled();
  });

  it('reports usage with remaining headroom for a capped Pro plan', async () => {
    const { svc } = buildUsage({
      plan: WorkspacePlan.PRO,
      status: WorkspacePlanStatus.ACTIVE,
      entitlements: {
        maxActiveItems: 1000,
        maxWorkers: 10,
        maxRecurrenceRules: 50,
        analytics: true,
      },
    });

    const report = await svc.getUsage(WID);

    expect(report.usage.activeItems).toEqual({
      used: 10,
      limit: 1000,
      remaining: 990,
      withinLimit: true,
    });
    expect(report.usage.workers.remaining).toBe(8);
    expect(report.usage.recurrenceRules.remaining).toBe(49);
  });

  it('reports null limits/remaining for an unlimited Business plan', async () => {
    const { svc } = buildUsage({
      plan: WorkspacePlan.BUSINESS,
      status: WorkspacePlanStatus.ACTIVE,
      entitlements: {
        maxActiveItems: null,
        maxWorkers: null,
        maxRecurrenceRules: null,
        analytics: true,
      },
    });

    const report = await svc.getUsage(WID);

    expect(report.usage.activeItems).toEqual({
      used: 10,
      limit: null,
      remaining: null,
      withinLimit: true,
    });
  });
});
