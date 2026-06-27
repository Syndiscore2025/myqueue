import { createHmac } from 'node:crypto';
import { WorkspacePlan, WorkspacePlanStatus } from '../../src/domain/billing';
import {
  mapStripeStatus,
  parseStripeEvent,
  planForPriceId,
  priceIdForPlan,
  type StripeProviderConfig,
} from '../../src/infrastructure/billing/stripe-mappers';
import { StripeBillingProvider } from '../../src/infrastructure/billing/stripe-billing-provider';

const config: StripeProviderConfig = {
  secretKey: 'sk_test',
  webhookSecret: 'whsec_test',
  priceProId: 'price_pro',
  priceBusinessId: 'price_biz',
};

describe('stripe price/plan mapping', () => {
  it('maps purchasable plans to their configured price id and Free to empty', () => {
    expect(priceIdForPlan(config, WorkspacePlan.PRO)).toBe('price_pro');
    expect(priceIdForPlan(config, WorkspacePlan.BUSINESS)).toBe('price_biz');
    expect(priceIdForPlan(config, WorkspacePlan.FREE)).toBe('');
  });

  it('reverse-maps known price ids and returns null for unknown/empty', () => {
    expect(planForPriceId(config, 'price_pro')).toBe(WorkspacePlan.PRO);
    expect(planForPriceId(config, 'price_biz')).toBe(WorkspacePlan.BUSINESS);
    expect(planForPriceId(config, 'price_unknown')).toBeNull();
    expect(planForPriceId({ ...config, priceProId: '' }, '')).toBeNull();
  });
});

describe('mapStripeStatus', () => {
  it('maps lifecycle statuses to the domain billing status', () => {
    expect(mapStripeStatus('active')).toBe(WorkspacePlanStatus.ACTIVE);
    expect(mapStripeStatus('trialing')).toBe(WorkspacePlanStatus.ACTIVE);
    expect(mapStripeStatus('past_due')).toBe(WorkspacePlanStatus.PAST_DUE);
    expect(mapStripeStatus('unpaid')).toBe(WorkspacePlanStatus.PAST_DUE);
    expect(mapStripeStatus('canceled')).toBe(WorkspacePlanStatus.CANCELED);
    expect(mapStripeStatus('incomplete_expired')).toBe(WorkspacePlanStatus.CANCELED);
  });
});

describe('parseStripeEvent', () => {
  it('returns a null change for a non-actionable event type', () => {
    const result = parseStripeEvent(config, { id: 'evt_1', type: 'invoice.paid', data: {} });
    expect(result).toEqual({ id: 'evt_1', type: 'invoice.paid', subscriptionChange: null });
  });

  it('maps a subscription update to plan, status, and tenant via metadata', () => {
    const result = parseStripeEvent(config, {
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          metadata: { workspaceId: 'w1' },
          customer: 'cus_1',
          status: 'active',
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    });

    expect(result.subscriptionChange).toMatchObject({
      workspaceId: 'w1',
      stripeCustomerId: 'cus_1',
      plan: WorkspacePlan.PRO,
      status: WorkspacePlanStatus.ACTIVE,
    });
  });

  it('treats a subscription deletion as a cancellation back to Free', () => {
    const result = parseStripeEvent(config, {
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { workspaceId: 'w1' }, customer: 'cus_1' } },
    });

    expect(result.subscriptionChange).toMatchObject({
      plan: WorkspacePlan.FREE,
      status: WorkspacePlanStatus.CANCELED,
    });
  });
});

describe('StripeBillingProvider.verifyAndParseEvent', () => {
  const NOW_MS = 1_700_000_000_000;
  const now = (): number => NOW_MS;
  const body = JSON.stringify({
    id: 'evt_9',
    type: 'customer.subscription.updated',
    data: {
      object: {
        metadata: { workspaceId: 'w1' },
        customer: 'cus_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      },
    },
  });

  function sign(ts: number, raw: string, secret = config.webhookSecret): string {
    const v1 = createHmac('sha256', secret).update(`${ts}.${raw}`, 'utf8').digest('hex');
    return `t=${ts},v1=${v1}`;
  }

  function provider(): StripeBillingProvider {
    return new StripeBillingProvider({ config, now });
  }

  it('parses an event with a valid, fresh signature', () => {
    const ts = Math.floor(NOW_MS / 1000);
    const event = provider().verifyAndParseEvent(body, sign(ts, body));
    expect(event.id).toBe('evt_9');
    expect(event.subscriptionChange?.plan).toBe(WorkspacePlan.PRO);
  });

  it('rejects a forged signature', () => {
    const ts = Math.floor(NOW_MS / 1000);
    expect(() => provider().verifyAndParseEvent(body, sign(ts, body, 'wrong_secret'))).toThrow();
  });

  it('rejects a stale timestamp outside the tolerance window', () => {
    const staleTs = Math.floor(NOW_MS / 1000) - 600;
    expect(() => provider().verifyAndParseEvent(body, sign(staleTs, body))).toThrow();
  });

  it('rejects a header missing the v1 signature part', () => {
    const ts = Math.floor(NOW_MS / 1000);
    expect(() => provider().verifyAndParseEvent(body, `t=${ts}`)).toThrow();
  });
});
