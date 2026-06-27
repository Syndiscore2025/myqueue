import { AuditAction } from '@prisma/client';
import { BillingService } from '../../src/application/billing';
import { NotFoundError, ValidationError } from '../../src/domain/errors';
import {
  WorkspacePlan,
  WorkspacePlanStatus,
  type BillingEvent,
  type BillingProvider,
} from '../../src/domain/billing';
import type {
  WorkspaceAuditLogRepository,
  WorkspaceRepository,
} from '../../src/infrastructure/repositories';

const WID = 'w1';

function build(): {
  svc: BillingService;
  workspaces: { findById: jest.Mock; updateBilling: jest.Mock; findByStripeCustomerId: jest.Mock };
  audit: { record: jest.Mock };
  provider: {
    createCheckoutSession: jest.Mock;
    createPortalSession: jest.Mock;
    verifyAndParseEvent: jest.Mock;
  };
} {
  const workspaces = {
    findById: jest.fn(),
    updateBilling: jest.fn(),
    findByStripeCustomerId: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const provider = {
    createCheckoutSession: jest.fn(),
    createPortalSession: jest.fn(),
    verifyAndParseEvent: jest.fn(),
  };
  const svc = new BillingService({
    workspaces: workspaces as unknown as WorkspaceRepository,
    audit: audit as unknown as WorkspaceAuditLogRepository,
    provider: provider as unknown as BillingProvider,
  });
  return { svc, workspaces, audit, provider };
}

function event(over: Partial<BillingEvent> = {}): BillingEvent {
  return {
    id: 'evt_1',
    type: 'customer.subscription.updated',
    subscriptionChange: {
      workspaceId: WID,
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      plan: WorkspacePlan.PRO,
      status: WorkspacePlanStatus.ACTIVE,
    },
    ...over,
  };
}

describe('BillingService.startCheckout', () => {
  it('rejects a non-purchasable plan before touching the provider', async () => {
    const { svc, provider } = build();
    await expect(svc.startCheckout(WID, WorkspacePlan.FREE)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown workspace', async () => {
    const { svc, workspaces } = build();
    workspaces.findById.mockResolvedValue(null);
    await expect(svc.startCheckout(WID, WorkspacePlan.PRO)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('creates a session reusing the existing Stripe customer id', async () => {
    const { svc, workspaces, provider } = build();
    workspaces.findById.mockResolvedValue({ id: WID, stripeCustomerId: 'cus_existing' });
    provider.createCheckoutSession.mockResolvedValue({ url: 'https://pay/x' });

    const result = await svc.startCheckout(WID, WorkspacePlan.PRO);

    expect(result).toEqual({ url: 'https://pay/x' });
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WID,
        plan: WorkspacePlan.PRO,
        stripeCustomerId: 'cus_existing',
      }),
    );
  });
});

describe('BillingService.startPortalSession', () => {
  it('rejects an unknown workspace', async () => {
    const { svc, workspaces } = build();
    workspaces.findById.mockResolvedValue(null);
    await expect(svc.startPortalSession(WID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a workspace with no billing customer', async () => {
    const { svc, workspaces } = build();
    workspaces.findById.mockResolvedValue({ id: WID, stripeCustomerId: null });
    await expect(svc.startPortalSession(WID)).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns the portal url for a customer', async () => {
    const { svc, workspaces, provider } = build();
    workspaces.findById.mockResolvedValue({ id: WID, stripeCustomerId: 'cus_1' });
    provider.createPortalSession.mockResolvedValue({ url: 'https://portal/x' });

    await expect(svc.startPortalSession(WID)).resolves.toEqual({ url: 'https://portal/x' });
  });
});

describe('BillingService.handleWebhook', () => {
  it('verifies, applies the change, and records a PLAN_CHANGED audit entry', async () => {
    const { svc, workspaces, audit, provider } = build();
    provider.verifyAndParseEvent.mockReturnValue(event());
    workspaces.findById.mockResolvedValue({ id: WID, plan: WorkspacePlan.FREE });
    workspaces.updateBilling.mockResolvedValue({
      plan: WorkspacePlan.PRO,
      planStatus: WorkspacePlanStatus.ACTIVE,
    });

    await svc.handleWebhook('{"raw":true}', 't=1,v1=sig');

    expect(provider.verifyAndParseEvent).toHaveBeenCalledWith('{"raw":true}', 't=1,v1=sig');
    expect(workspaces.updateBilling).toHaveBeenCalledWith(
      WID,
      expect.objectContaining({ plan: WorkspacePlan.PRO, planStatus: WorkspacePlanStatus.ACTIVE }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WID, action: AuditAction.PLAN_CHANGED }),
    );
  });

  it('acks and ignores a non-actionable event without writing', async () => {
    const { svc, workspaces, audit, provider } = build();
    provider.verifyAndParseEvent.mockReturnValue(event({ subscriptionChange: null }));

    await svc.handleWebhook('{}', 'sig');

    expect(workspaces.updateBilling).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('resolves the tenant by Stripe customer id when the event lacks a workspace id', async () => {
    const { svc, workspaces, provider } = build();
    provider.verifyAndParseEvent.mockReturnValue(
      event({ subscriptionChange: { ...event().subscriptionChange!, workspaceId: null } }),
    );
    workspaces.findByStripeCustomerId.mockResolvedValue({ id: WID });
    workspaces.findById.mockResolvedValue({ id: WID, plan: WorkspacePlan.FREE });
    workspaces.updateBilling.mockResolvedValue({
      plan: WorkspacePlan.PRO,
      planStatus: WorkspacePlanStatus.ACTIVE,
    });

    await svc.handleWebhook('{}', 'sig');

    expect(workspaces.findByStripeCustomerId).toHaveBeenCalledWith('cus_1');
    expect(workspaces.updateBilling).toHaveBeenCalled();
  });

  it('drops an event whose tenant cannot be resolved', async () => {
    const { svc, workspaces, provider } = build();
    provider.verifyAndParseEvent.mockReturnValue(
      event({
        subscriptionChange: {
          ...event().subscriptionChange!,
          workspaceId: null,
          stripeCustomerId: null,
        },
      }),
    );

    await svc.handleWebhook('{}', 'sig');

    expect(workspaces.updateBilling).not.toHaveBeenCalled();
  });
});
