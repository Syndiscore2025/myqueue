import request from 'supertest';

// The repository/prisma/redis singletons construct at import time; these routes
// drive mocked services, so stub clients suffice.
jest.mock('../../src/infrastructure/database/prisma', () => ({
  checkDatabaseHealth: jest.fn(),
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  getPrisma: jest.fn(() => ({})),
}));

jest.mock('../../src/infrastructure/redis/redis', () => ({
  checkRedisHealth: jest.fn(),
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  createBullConnection: jest.fn(),
}));

jest.mock('../../src/application/queue', () => ({
  queueService: { getSettings: jest.fn(), updateSettings: jest.fn() },
  queueClaimService: {},
  queueDeadLetterService: {},
  workerRegistryService: { list: jest.fn() },
  queueStatisticsService: { get: jest.fn() },
}));

jest.mock('../../src/application/billing', () => ({
  billingService: {
    startCheckout: jest.fn(),
    startPortalSession: jest.fn(),
    handleWebhook: jest.fn(),
  },
  entitlementService: { getEntitlements: jest.fn() },
  usageService: { getUsage: jest.fn() },
}));

jest.mock('../../src/infrastructure/repositories', () => ({
  workspaceRepository: { findById: jest.fn() },
  queueRateLimitRepository: {},
  queueDependencyRepository: {},
}));

import { createApp } from '../../src/interfaces/http/app';
import { billingService, entitlementService, usageService } from '../../src/application/billing';
import { queueService, queueStatisticsService } from '../../src/application/queue';
import { workspaceRepository } from '../../src/infrastructure/repositories';
import { PaymentRequiredError } from '../../src/domain/errors';
import { WorkspacePlan, WorkspacePlanStatus, PLAN_ENTITLEMENTS } from '../../src/domain/billing';

const app = createApp();
const headers = { 'x-workspace-id': 'w1', 'x-workspace-user-id': 'u1' };
const mock = (fn: unknown): jest.Mock => fn as jest.Mock;

const entitlements = {
  plan: WorkspacePlan.PRO,
  status: WorkspacePlanStatus.ACTIVE,
  entitlements: PLAN_ENTITLEMENTS[WorkspacePlan.PRO],
};

beforeEach(() => {
  jest.clearAllMocks();
  mock(entitlementService.getEntitlements).mockResolvedValue(entitlements);
  mock(queueService.getSettings).mockResolvedValue({ workspaceId: 'w1', rankingMode: 'FIFO' });
  mock(queueService.updateSettings).mockResolvedValue({ workspaceId: 'w1', rankingMode: 'FIFO' });
  mock(billingService.startCheckout).mockResolvedValue({ url: 'https://pay/x' });
  mock(billingService.startPortalSession).mockResolvedValue({ url: 'https://portal/x' });
  mock(queueStatisticsService.get).mockResolvedValue({ counts: {} });
});

describe('workspace settings API', () => {
  it('rejects without workspace context (401)', async () => {
    const res = await request(app).get('/api/v1/workspace/settings');
    expect(res.status).toBe(401);
    expect(entitlementService.getEntitlements).not.toHaveBeenCalled();
  });

  it('returns settings and plan scoped to the acting workspace', async () => {
    const res = await request(app).get('/api/v1/workspace/settings').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.plan.plan).toBe(WorkspacePlan.PRO);
    expect(res.body.settings).toBeDefined();
    expect(entitlementService.getEntitlements).toHaveBeenCalledWith('w1');
    expect(queueService.getSettings).toHaveBeenCalledWith({
      workspaceId: 'w1',
      workspaceUserId: 'u1',
    });
  });

  it('patches notification preferences for the workspace', async () => {
    const res = await request(app)
      .patch('/api/v1/workspace/settings')
      .set(headers)
      .send({ dailyDigestEnabled: true });
    expect(res.status).toBe(200);
    expect(queueService.updateSettings).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'u1' },
      { dailyDigestEnabled: true },
    );
  });
});

describe('billing API', () => {
  it('returns the current plan and entitlements', async () => {
    const res = await request(app).get('/api/v1/billing/plan').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.plan.plan).toBe(WorkspacePlan.PRO);
    expect(entitlementService.getEntitlements).toHaveBeenCalledWith('w1');
  });

  it('rejects a checkout for the non-purchasable Free plan (400)', async () => {
    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set(headers)
      .send({ plan: 'FREE' });
    expect(res.status).toBe(400);
    expect(billingService.startCheckout).not.toHaveBeenCalled();
  });

  it('starts checkout for a purchasable plan scoped to the workspace', async () => {
    const res = await request(app)
      .post('/api/v1/billing/checkout')
      .set(headers)
      .send({ plan: 'PRO' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://pay/x');
    expect(billingService.startCheckout).toHaveBeenCalledWith('w1', 'PRO');
  });

  it('opens the billing portal for the workspace', async () => {
    const res = await request(app).post('/api/v1/billing/portal').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://portal/x');
    expect(billingService.startPortalSession).toHaveBeenCalledWith('w1');
  });
});

describe('admin overview API', () => {
  const workspace = {
    id: 'w1',
    slackTeamName: 'Acme',
    isEnterpriseInstall: false,
    status: 'ACTIVE',
    installedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    plan: WorkspacePlan.PRO,
    planStatus: WorkspacePlanStatus.ACTIVE,
    stripeCustomerId: 'cus_secret',
    stripeSubscriptionId: 'sub_secret',
    planUpdatedAt: new Date('2026-01-02T00:00:00Z'),
  };

  it('rejects without workspace context (401)', async () => {
    const res = await request(app).get('/api/v1/admin/overview');
    expect(res.status).toBe(401);
    expect(workspaceRepository.findById).not.toHaveBeenCalled();
  });

  it('returns 404 when the acting workspace does not exist', async () => {
    mock(workspaceRepository.findById).mockResolvedValue(null);
    const res = await request(app).get('/api/v1/admin/overview').set(headers);
    expect(res.status).toBe(404);
  });

  it('consolidates identity, billing posture, and stats without leaking Stripe ids', async () => {
    mock(workspaceRepository.findById).mockResolvedValue(workspace);
    const res = await request(app).get('/api/v1/admin/overview').set(headers);

    expect(res.status).toBe(200);
    expect(res.body.workspace.id).toBe('w1');
    expect(res.body.billing).toMatchObject({
      plan: WorkspacePlan.PRO,
      status: WorkspacePlanStatus.ACTIVE,
      hasActiveSubscription: true,
    });
    // Raw Stripe identifiers must never be echoed to the client.
    expect(JSON.stringify(res.body)).not.toContain('cus_secret');
    expect(JSON.stringify(res.body)).not.toContain('sub_secret');
    expect(workspaceRepository.findById).toHaveBeenCalledWith('w1');
    expect(queueStatisticsService.get).toHaveBeenCalledWith('w1');
  });
});

describe('analytics usage API', () => {
  it('returns the usage report for an entitled workspace', async () => {
    mock(usageService.getUsage).mockResolvedValue({ plan: WorkspacePlan.PRO, usage: {} });
    const res = await request(app).get('/api/v1/analytics/usage').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.usage).toBeDefined();
    expect(usageService.getUsage).toHaveBeenCalledWith('w1');
  });

  it('returns 402 when the plan does not include analytics', async () => {
    mock(usageService.getUsage).mockRejectedValue(new PaymentRequiredError('upgrade'));
    const res = await request(app).get('/api/v1/analytics/usage').set(headers);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
  });

  it('rejects without workspace context (401)', async () => {
    const res = await request(app).get('/api/v1/analytics/usage');
    expect(res.status).toBe(401);
    expect(usageService.getUsage).not.toHaveBeenCalled();
  });
});

describe('billing webhook receiver', () => {
  it('rejects a request missing the Stripe signature header (400)', async () => {
    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_1"}');
    expect(res.status).toBe(400);
    expect(billingService.handleWebhook).not.toHaveBeenCalled();
  });

  it('acknowledges a verified event, passing the raw body and signature through', async () => {
    mock(billingService.handleWebhook).mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send('{"id":"evt_1"}');
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(billingService.handleWebhook).toHaveBeenCalledWith('{"id":"evt_1"}', 't=1,v1=abc');
  });

  it('answers 400 when verification fails', async () => {
    mock(billingService.handleWebhook).mockRejectedValue(new Error('bad signature'));
    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=bad')
      .send('{"id":"evt_1"}');
    expect(res.status).toBe(400);
  });
});

describe('SaaS API tenant isolation', () => {
  it('blocks every guarded SaaS route without workspace context (401)', async () => {
    const guarded = [
      ['get', '/api/v1/workspace/settings'],
      ['patch', '/api/v1/workspace/settings'],
      ['get', '/api/v1/billing/plan'],
      ['post', '/api/v1/billing/checkout'],
      ['post', '/api/v1/billing/portal'],
      ['get', '/api/v1/admin/overview'],
      ['get', '/api/v1/analytics/usage'],
    ] as const;
    for (const [method, path] of guarded) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  });
});

describe('SaaS API documentation', () => {
  it('documents the Phase 6 routes in the OpenAPI document', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/api/v1/workspace/settings']).toBeDefined();
    expect(res.body.paths['/api/v1/billing/plan']).toBeDefined();
    expect(res.body.paths['/api/v1/billing/checkout']).toBeDefined();
    expect(res.body.paths['/api/v1/billing/portal']).toBeDefined();
    expect(res.body.paths['/api/v1/billing/webhook']).toBeDefined();
    expect(res.body.paths['/api/v1/admin/overview']).toBeDefined();
    expect(res.body.paths['/api/v1/analytics/usage']).toBeDefined();
  });
});
