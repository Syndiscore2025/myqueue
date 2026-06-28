import type {
  QueueItemRepository,
  QueueRateLimitRepository,
  QueueRecurrenceRepository,
  RecurrenceSchedulerSummary,
  SchedulerStatistics,
} from '../../infrastructure/repositories';
import {
  queueItemRepository,
  queueRateLimitRepository,
  queueRecurrenceRepository,
} from '../../infrastructure/repositories';
import type { DmFailureCounts, NotificationMetrics } from '../../infrastructure/observability';
import { notificationMetrics } from '../../infrastructure/observability';

/** Collaborators the service orchestrates; injectable for testing. */
export interface SchedulerStatisticsServiceDeps {
  items?: QueueItemRepository;
  recurrence?: QueueRecurrenceRepository;
  rateLimit?: QueueRateLimitRepository;
  metrics?: NotificationMetrics;
}

/**
 * Operator-facing observability view: what the scheduler is gating, the state of
 * recurrence and rate-limit orchestration, and notification-delivery health.
 */
export interface SchedulerStatisticsView {
  /** Items held back by the activation gate, with a why-breakdown. */
  scheduler: SchedulerStatistics;
  /** Enabled recurrence rules and the next spawn time. */
  recurrence: RecurrenceSchedulerSummary;
  /** Rate-limit orchestration footprint. */
  rateLimit: { buckets: number };
  /** Notification delivery health (DM send failures by reason). */
  notifications: { dmFailures: DmFailureCounts };
}

/**
 * Application service for `GET /api/v1/queue/scheduler`. Aggregates the
 * scheduler-gating statistics, recurrence summary, rate-limit footprint, and
 * notification-failure metrics for a workspace. All operations are scoped by
 * workspace and read-only.
 */
export class SchedulerStatisticsService {
  private readonly items: QueueItemRepository;
  private readonly recurrence: QueueRecurrenceRepository;
  private readonly rateLimit: QueueRateLimitRepository;
  private readonly metrics: NotificationMetrics;

  constructor(deps: SchedulerStatisticsServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.recurrence = deps.recurrence ?? queueRecurrenceRepository;
    this.rateLimit = deps.rateLimit ?? queueRateLimitRepository;
    this.metrics = deps.metrics ?? notificationMetrics;
  }

  /** Compute the workspace's scheduler/orchestration/notification statistics. */
  async get(workspaceId: string, now: Date = new Date()): Promise<SchedulerStatisticsView> {
    const [scheduler, recurrence, buckets, dmFailures] = await Promise.all([
      this.items.getSchedulerStatistics(workspaceId, now),
      this.recurrence.getSchedulerSummary(workspaceId),
      this.rateLimit.countBuckets(workspaceId),
      this.metrics.getDmFailureCounts(workspaceId),
    ]);
    return {
      scheduler,
      recurrence,
      rateLimit: { buckets },
      notifications: { dmFailures },
    };
  }
}

/** Process-wide scheduler statistics service bound to the shared singletons. */
export const schedulerStatisticsService = new SchedulerStatisticsService();
