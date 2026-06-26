import { QueueStatisticsService } from '../../src/application/queue';
import { QueueStatus } from '../../src/domain/queue';
import type { QueueStatistics } from '../../src/infrastructure/repositories';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { WorkerRegistryRepository } from '../../src/infrastructure/repositories/worker-registry-repository';

interface Mocks {
  items: { getStatistics: jest.Mock; countProcessingByWorker: jest.Mock };
  registry: { list: jest.Mock };
}

function build(): { svc: QueueStatisticsService; m: Mocks } {
  const m: Mocks = {
    items: { getStatistics: jest.fn(), countProcessingByWorker: jest.fn() },
    registry: { list: jest.fn() },
  };
  const svc = new QueueStatisticsService({
    items: m.items as unknown as QueueItemRepository,
    registry: m.registry as unknown as WorkerRegistryRepository,
  });
  return { svc, m };
}

/** A QueueStatistics fixture with all-zero counts, overridable per test. */
function makeStats(over: Partial<QueueStatistics> = {}): QueueStatistics {
  const counts = Object.fromEntries(Object.values(QueueStatus).map((s) => [s, 0])) as Record<
    QueueStatus,
    number
  >;
  return {
    counts,
    averageWaitTimeMs: null,
    averageProcessingTimeMs: null,
    totalRetries: 0,
    averageRetryCount: null,
    oldestQueuedAt: null,
    newestQueuedAt: null,
    averageQueueAgeMs: null,
    longestProcessingJobMs: null,
    ...over,
  };
}

describe('QueueStatisticsService.get', () => {
  it('passes the queue aggregates through and scopes every read to the workspace', async () => {
    const { svc, m } = build();
    const stats = makeStats({ totalRetries: 7, averageWaitTimeMs: 1234 });
    m.items.getStatistics.mockResolvedValue(stats);
    m.items.countProcessingByWorker.mockResolvedValue({});
    m.registry.list.mockResolvedValue([]);

    const result = await svc.get('w1');

    expect(m.items.getStatistics).toHaveBeenCalledWith('w1');
    expect(m.items.countProcessingByWorker).toHaveBeenCalledWith('w1');
    expect(m.registry.list).toHaveBeenCalledWith('w1');
    expect(result.totalRetries).toBe(7);
    expect(result.averageWaitTimeMs).toBe(1234);
    expect(result.counts[QueueStatus.New]).toBe(0);
  });

  it('computes worker utilization as busy over total workers', async () => {
    const { svc, m } = build();
    m.items.getStatistics.mockResolvedValue(makeStats());
    m.items.countProcessingByWorker.mockResolvedValue({ 'worker-1': 3, 'worker-2': 1 });
    m.registry.list.mockResolvedValue([
      { workerId: 'worker-1' },
      { workerId: 'worker-2' },
      { workerId: 'worker-3' },
    ]);

    const result = await svc.get('w1');

    expect(result.workerUtilization.totalWorkers).toBe(3);
    expect(result.workerUtilization.busyWorkers).toBe(2);
    expect(result.workerUtilization.ratio).toBeCloseTo(2 / 3);
  });

  it('reports a zero utilization ratio when no workers are registered', async () => {
    const { svc, m } = build();
    m.items.getStatistics.mockResolvedValue(makeStats());
    m.items.countProcessingByWorker.mockResolvedValue({});
    m.registry.list.mockResolvedValue([]);

    const result = await svc.get('w1');

    expect(result.workerUtilization).toEqual({ totalWorkers: 0, busyWorkers: 0, ratio: 0 });
  });
});
