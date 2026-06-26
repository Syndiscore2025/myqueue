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
  queueClaimService: {
    claim: jest.fn(),
    heartbeat: jest.fn(),
    complete: jest.fn(),
    release: jest.fn(),
    fail: jest.fn(),
  },
  queueDeadLetterService: {
    list: jest.fn(),
    requeue: jest.fn(),
  },
  workerRegistryService: {
    list: jest.fn(),
    register: jest.fn(),
  },
}));

import { createApp } from '../../src/interfaces/http/app';
import {
  queueClaimService,
  queueDeadLetterService,
  queueService,
  workerRegistryService,
} from '../../src/application/queue';

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

  it('extends the lease for the worker on heartbeat', async () => {
    mock(queueClaimService.heartbeat).mockResolvedValue(item);
    const res = await request(app)
      .post('/api/v1/queue/heartbeat')
      .set(workerHeaders)
      .send({ permanentQueueId: 'MQ-000001' });
    expect(res.status).toBe(200);
    expect(res.body.item.permanentQueueId).toBe('MQ-000001');
    expect(queueClaimService.heartbeat).toHaveBeenCalledWith(
      { workspaceId: 'w1', workerId: 'worker-1' },
      'MQ-000001',
    );
  });

  it('rejects a heartbeat without the worker id header (401)', async () => {
    const res = await request(app)
      .post('/api/v1/queue/heartbeat')
      .set('x-workspace-id', 'w1')
      .send({ permanentQueueId: 'MQ-000001' });
    expect(res.status).toBe(401);
    expect(queueClaimService.heartbeat).not.toHaveBeenCalled();
  });

  it('rejects a heartbeat with a malformed permanent id (400)', async () => {
    const res = await request(app)
      .post('/api/v1/queue/heartbeat')
      .set(workerHeaders)
      .send({ permanentQueueId: 'nope' });
    expect(res.status).toBe(400);
    expect(queueClaimService.heartbeat).not.toHaveBeenCalled();
  });

  it('completes an item for a worker', async () => {
    mock(queueClaimService.complete).mockResolvedValue(item);
    const res = await request(app)
      .post('/api/v1/queue/complete')
      .set(workerHeaders)
      .send({ permanentQueueId: 'MQ-000001' });
    expect(res.status).toBe(200);
    expect(queueClaimService.complete).toHaveBeenCalledWith(
      { workspaceId: 'w1', workerId: 'worker-1' },
      'MQ-000001',
    );
  });

  it('releases an item for a worker', async () => {
    mock(queueClaimService.release).mockResolvedValue(item);
    const res = await request(app)
      .post('/api/v1/queue/release')
      .set(workerHeaders)
      .send({ permanentQueueId: 'MQ-000001' });
    expect(res.status).toBe(200);
    expect(queueClaimService.release).toHaveBeenCalledWith(
      { workspaceId: 'w1', workerId: 'worker-1' },
      'MQ-000001',
    );
  });

  it('fails an item for a worker with error details', async () => {
    mock(queueClaimService.fail).mockResolvedValue(item);
    const res = await request(app)
      .post('/api/v1/queue/fail')
      .set(workerHeaders)
      .send({ permanentQueueId: 'MQ-000001', error: 'boom', errorStack: 'stack...' });
    expect(res.status).toBe(200);
    expect(queueClaimService.fail).toHaveBeenCalledWith(
      { workspaceId: 'w1', workerId: 'worker-1' },
      'MQ-000001',
      { error: 'boom', errorStack: 'stack...' },
    );
  });

  it('rejects complete without worker id header (401)', async () => {
    const res = await request(app)
      .post('/api/v1/queue/complete')
      .set('x-workspace-id', 'w1')
      .send({ permanentQueueId: 'MQ-000001' });
    expect(res.status).toBe(401);
  });
});

describe('queue dead-letter API', () => {
  it('lists dead-lettered items for the workspace', async () => {
    mock(queueDeadLetterService.list).mockResolvedValue([item]);
    const res = await request(app).get('/api/v1/queue/dead-letter').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(queueDeadLetterService.list).toHaveBeenCalledWith({
      workspaceId: 'w1',
      workspaceUserId: 'u1',
    });
  });

  it('requeues a dead-lettered item', async () => {
    mock(queueDeadLetterService.requeue).mockResolvedValue(item);
    const res = await request(app)
      .post('/api/v1/queue/dead-letter/requeue')
      .set(headers)
      .send({ permanentQueueId: 'MQ-000001' });
    expect(res.status).toBe(200);
    expect(queueDeadLetterService.requeue).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'u1' },
      'MQ-000001',
    );
  });

  it('rejects requeue with a malformed permanent id (400)', async () => {
    const res = await request(app)
      .post('/api/v1/queue/dead-letter/requeue')
      .set(headers)
      .send({ permanentQueueId: 'nope' });
    expect(res.status).toBe(400);
    expect(queueDeadLetterService.requeue).not.toHaveBeenCalled();
  });

  it('rejects dead-letter listing without workspace context (401)', async () => {
    const res = await request(app).get('/api/v1/queue/dead-letter');
    expect(res.status).toBe(401);
  });
});

describe('worker registry API', () => {
  const worker = {
    id: 'wr1',
    workspaceId: 'w1',
    workerId: 'worker-1',
    hostname: 'host-a',
    status: 'ACTIVE',
    processingCount: 2,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  };

  it('lists the workspace registered workers', async () => {
    mock(workerRegistryService.list).mockResolvedValue([worker]);
    const res = await request(app).get('/api/v1/workers').set(headers);
    expect(res.status).toBe(200);
    expect(res.body.workers).toHaveLength(1);
    expect(res.body.workers[0].workerId).toBe('worker-1');
    expect(workerRegistryService.list).toHaveBeenCalledWith('w1');
  });

  it('rejects worker listing without workspace context (401)', async () => {
    const res = await request(app).get('/api/v1/workers');
    expect(res.status).toBe(401);
    expect(workerRegistryService.list).not.toHaveBeenCalled();
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
    expect(res.body.paths['/api/v1/queue/heartbeat']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/complete']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/release']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/fail']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/dead-letter']).toBeDefined();
    expect(res.body.paths['/api/v1/queue/dead-letter/requeue']).toBeDefined();
    expect(res.body.paths['/api/v1/workers']).toBeDefined();
  });
});
