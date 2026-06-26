import request from 'supertest';

// The repository/prisma/redis singletons construct at import time; these routes
// drive a mocked service, so stub clients suffice.
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
  queueService: {
    createItem: jest.fn(),
    getItemWithPosition: jest.fn(),
    getActiveQueue: jest.fn(),
    getWaitingQueue: jest.fn(),
    getFollowUpQueue: jest.fn(),
    getCompletedToday: jest.fn(),
    recalculateForOwner: jest.fn(),
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
    changeStatus: jest.fn(),
    complete: jest.fn(),
    archive: jest.fn(),
    moveToWaiting: jest.fn(),
    moveToFollowUp: jest.fn(),
    snooze: jest.fn(),
    unsnooze: jest.fn(),
    updatePriority: jest.fn(),
    assign: jest.fn(),
  },
  queueClaimService: { claim: jest.fn() },
}));

import { createApp } from '../../src/interfaces/http/app';
import { queueClaimService, queueService } from '../../src/application/queue';

const app = createApp();
const headers = { 'x-workspace-id': 'w1', 'x-workspace-user-id': 'u1' };
const workerHeaders = { 'x-workspace-id': 'w1', 'x-worker-id': 'worker-1' };
const item = { id: 'i1', permanentQueueId: 'MQ-000001', title: 'T', status: 'New' };
const mock = (fn: unknown): jest.Mock => fn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mock(queueService.createItem).mockResolvedValue(item);
  mock(queueService.getItemWithPosition).mockResolvedValue({ item, position: 2 });
  mock(queueService.getActiveQueue).mockResolvedValue([{ item, position: 1 }]);
  mock(queueService.complete).mockResolvedValue(item);
  mock(queueService.assign).mockResolvedValue(item);
  mock(queueService.snooze).mockResolvedValue(item);
  mock(queueService.updateSettings).mockResolvedValue({ workspaceId: 'w1', rankingMode: 'FIFO' });
});

describe('queue API guard', () => {
  it('rejects requests without workspace headers (401)', async () => {
    const res = await request(app).post('/api/v1/queue/items').send({ title: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(queueService.createItem).not.toHaveBeenCalled();
  });

  it('rejects when only one of the two context headers is present (401)', async () => {
    const res = await request(app).get('/api/v1/queue/active').set('x-workspace-id', 'w1');
    expect(res.status).toBe(401);
  });
});

describe('queue API create + read', () => {
  it('creates an item and passes the explicit tenant context', async () => {
    const res = await request(app)
      .post('/api/v1/queue/items')
      .set(headers)
      .send({ title: 'Please review', priority: 'Red' });

    expect(res.status).toBe(201);
    expect(res.body.item.permanentQueueId).toBe('MQ-000001');
    expect(queueService.createItem).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'u1' },
      expect.objectContaining({ title: 'Please review', priority: 'Red' }),
    );
  });

  it('rejects an invalid create body (400)', async () => {
    const res = await request(app).post('/api/v1/queue/items').set(headers).send({ title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an item with its computed position', async () => {
    const res = await request(app).get('/api/v1/queue/items/MQ-000001').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.position).toBe(2);
    expect(queueService.getItemWithPosition).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'u1' },
      'MQ-000001',
    );
  });

  it('rejects a malformed permanent id (400)', async () => {
    const res = await request(app).get('/api/v1/queue/items/BAD').set(headers);
    expect(res.status).toBe(400);
    expect(queueService.getItemWithPosition).not.toHaveBeenCalled();
  });

  it('returns the ranked active queue', async () => {
    const res = await request(app).get('/api/v1/queue/active').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ item, position: 1 }]);
  });
});

describe('queue API mutations', () => {
  it('completes an item', async () => {
    const res = await request(app).post('/api/v1/queue/items/MQ-000001/complete').set(headers);
    expect(res.status).toBe(200);
    expect(queueService.complete).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'u1' },
      'MQ-000001',
    );
  });

  it('assigns an item to a new owner', async () => {
    const res = await request(app)
      .post('/api/v1/queue/items/MQ-000001/assign')
      .set(headers)
      .send({ ownerWorkspaceUserId: 'u2' });
    expect(res.status).toBe(200);
    expect(queueService.assign).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'u1' },
      'MQ-000001',
      'u2',
    );
  });

  it('rejects a snooze without a wake time (400)', async () => {
    const res = await request(app)
      .post('/api/v1/queue/items/MQ-000001/snooze')
      .set(headers)
      .send({});
    expect(res.status).toBe(400);
    expect(queueService.snooze).not.toHaveBeenCalled();
  });

  it('updates workspace settings', async () => {
    const res = await request(app)
      .patch('/api/v1/queue/settings')
      .set(headers)
      .send({ rankingMode: 'PRIORITY' });
    expect(res.status).toBe(200);
    expect(queueService.updateSettings).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'u1' },
      { rankingMode: 'PRIORITY' },
    );
  });
});

describe('queue API worker claim', () => {
  it('rejects a claim without the worker id header (401)', async () => {
    const res = await request(app).post('/api/v1/queue/claim').set('x-workspace-id', 'w1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(queueClaimService.claim).not.toHaveBeenCalled();
  });

  it('claims the next item for a worker', async () => {
    mock(queueClaimService.claim).mockResolvedValue(item);
    const res = await request(app).post('/api/v1/queue/claim').set(workerHeaders);
    expect(res.status).toBe(200);
    expect(res.body.item.permanentQueueId).toBe('MQ-000001');
    expect(queueClaimService.claim).toHaveBeenCalledWith({
      workspaceId: 'w1',
      workerId: 'worker-1',
    });
  });

  it('returns a null item when nothing is queued', async () => {
    mock(queueClaimService.claim).mockResolvedValue(null);
    const res = await request(app).post('/api/v1/queue/claim').set(workerHeaders);
    expect(res.status).toBe(200);
    expect(res.body.item).toBeNull();
  });
});

describe('queue API documentation', () => {
  it('documents the queue routes in the OpenAPI document', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/api/v1/queue/items']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/active']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/items/{permanentQueueId}/assign']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/claim']).toBeDefined();
  });
});
