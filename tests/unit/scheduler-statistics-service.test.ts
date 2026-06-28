import { SchedulerStatisticsService } from '../../src/application/observability/scheduler-statistics-service';
import type {
  QueueItemRepository,
  QueueRateLimitRepository,
  QueueRecurrenceRepository,
} from '../../src/infrastructure/repositories';
import type { NotificationMetrics } from '../../src/infrastructure/observability';

interface Built {
  svc: SchedulerStatisticsService;
  getSchedulerStatistics: jest.Mock;
  getSchedulerSummary: jest.Mock;
  countBuckets: jest.Mock;
  getDmFailureCounts: jest.Mock;
}

function build(): Built {
  const getSchedulerStatistics = jest.fn();
  const getSchedulerSummary = jest.fn();
  const countBuckets = jest.fn();
  const getDmFailureCounts = jest.fn();

  const svc = new SchedulerStatisticsService({
    items: { getSchedulerStatistics } as unknown as QueueItemRepository,
    recurrence: { getSchedulerSummary } as unknown as QueueRecurrenceRepository,
    rateLimit: { countBuckets } as unknown as QueueRateLimitRepository,
    metrics: { getDmFailureCounts } as unknown as NotificationMetrics,
  });

  return { svc, getSchedulerStatistics, getSchedulerSummary, countBuckets, getDmFailureCounts };
}

describe('SchedulerStatisticsService.get', () => {
  it('aggregates scheduler, recurrence, rate-limit, and notification metrics', async () => {
    const { svc, getSchedulerStatistics, getSchedulerSummary, countBuckets, getDmFailureCounts } =
      build();
    const now = new Date('2026-06-28T00:00:00.000Z');
    const nextActivationAt = new Date('2026-06-28T01:00:00.000Z');
    const oldestPendingCreatedAt = new Date('2026-06-27T00:00:00.000Z');
    const nextRunAt = new Date('2026-06-28T02:00:00.000Z');

    getSchedulerStatistics.mockResolvedValue({
      snoozed: 3,
      scheduled: 2,
      delayed: 1,
      blocked: 4,
      pendingActivation: 6,
      nextActivationAt,
      oldestPendingCreatedAt,
    });
    getSchedulerSummary.mockResolvedValue({ enabledRules: 5, nextRunAt });
    countBuckets.mockResolvedValue(7);
    getDmFailureCounts.mockResolvedValue({ noToken: 1, noChannel: 0, sendError: 2, total: 3 });

    const view = await svc.get('w1', now);

    expect(getSchedulerStatistics).toHaveBeenCalledWith('w1', now);
    expect(getSchedulerSummary).toHaveBeenCalledWith('w1');
    expect(countBuckets).toHaveBeenCalledWith('w1');
    expect(getDmFailureCounts).toHaveBeenCalledWith('w1');
    expect(view).toEqual({
      scheduler: {
        snoozed: 3,
        scheduled: 2,
        delayed: 1,
        blocked: 4,
        pendingActivation: 6,
        nextActivationAt,
        oldestPendingCreatedAt,
      },
      recurrence: { enabledRules: 5, nextRunAt },
      rateLimit: { buckets: 7 },
      notifications: { dmFailures: { noToken: 1, noChannel: 0, sendError: 2, total: 3 } },
    });
  });
});
