import type { WorkerRegistration } from '@prisma/client';
import { WorkerRegistryService } from '../../src/application/queue';
import { WorkerStatus } from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { WorkerRegistryRepository } from '../../src/infrastructure/repositories/worker-registry-repository';

interface Mocks {
  registry: { register: jest.Mock; list: jest.Mock };
  items: { countProcessingByWorker: jest.Mock };
}

function build(): { svc: WorkerRegistryService; m: Mocks } {
  const m: Mocks = {
    registry: { register: jest.fn(), list: jest.fn() },
    items: { countProcessingByWorker: jest.fn() },
  };
  const svc = new WorkerRegistryService({
    registry: m.registry as unknown as WorkerRegistryRepository,
    items: m.items as unknown as QueueItemRepository,
  });
  return { svc, m };
}

/** A WorkerRegistration fixture with sensible defaults, overridable per test. */
function makeWorker(over: Partial<WorkerRegistration> = {}): WorkerRegistration {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'wr1',
    workspaceId: 'w1',
    workerId: 'worker-1',
    hostname: 'host-a',
    status: WorkerStatus.ACTIVE,
    processingCount: 0,
    startedAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('WorkerRegistryService.register', () => {
  it('registers the worker with its context identity and host', async () => {
    const { svc, m } = build();
    const worker = makeWorker();
    m.registry.register.mockResolvedValue(worker);

    const result = await svc.register({
      workspaceId: 'w1',
      workerId: 'worker-1',
      hostname: 'host-a',
    });

    expect(result).toBe(worker);
    expect(m.registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', workerId: 'worker-1', hostname: 'host-a' }),
    );
  });

  it('passes null hostname when the context has none', async () => {
    const { svc, m } = build();
    m.registry.register.mockResolvedValue(makeWorker({ hostname: null }));

    await svc.register({ workspaceId: 'w1', workerId: 'worker-1' });

    expect(m.registry.register).toHaveBeenCalledWith(expect.objectContaining({ hostname: null }));
  });
});

describe('WorkerRegistryService.list', () => {
  it('merges each worker with its live processing count', async () => {
    const { svc, m } = build();
    m.registry.list.mockResolvedValue([
      makeWorker({ workerId: 'worker-1' }),
      makeWorker({ id: 'wr2', workerId: 'worker-2' }),
    ]);
    m.items.countProcessingByWorker.mockResolvedValue({ 'worker-1': 3 });

    const result = await svc.list('w1');

    expect(m.registry.list).toHaveBeenCalledWith('w1');
    expect(m.items.countProcessingByWorker).toHaveBeenCalledWith('w1');
    expect(result[0]!.processingCount).toBe(3);
    expect(result[1]!.processingCount).toBe(0);
  });

  it('returns an empty list when the workspace has no workers', async () => {
    const { svc, m } = build();
    m.registry.list.mockResolvedValue([]);
    m.items.countProcessingByWorker.mockResolvedValue({});

    const result = await svc.list('w1');

    expect(result).toEqual([]);
  });
});
