import {
  isWithinLimit,
  type PlanEntitlements,
  type WorkspacePlan,
  type WorkspacePlanStatus,
} from '../../domain/billing';
import { PaymentRequiredError } from '../../domain/errors';
import type {
  QueueItemRepository,
  QueueRecurrenceRepository,
  WorkerRegistryRepository,
} from '../../infrastructure/repositories';
import {
  queueItemRepository,
  queueRecurrenceRepository,
  workerRegistryRepository,
} from '../../infrastructure/repositories';
import { entitlementService, type EntitlementService } from './entitlement-service';

/** A single countable resource measured against its plan limit. */
export interface LimitUsage {
  /** How many of the resource the workspace is currently using. */
  used: number;
  /** The plan's inclusive maximum, or null when unlimited. */
  limit: number | null;
  /** How many more may be added before hitting the limit; null when unlimited. */
  remaining: number | null;
  /** Whether current usage is within the limit (always true when unlimited). */
  withinLimit: boolean;
}

/** A workspace's plan together with its usage of each countable entitlement. */
export interface UsageReport {
  plan: WorkspacePlan;
  status: WorkspacePlanStatus;
  entitlements: PlanEntitlements;
  usage: {
    activeItems: LimitUsage;
    workers: LimitUsage;
    recurrenceRules: LimitUsage;
  };
}

/** Collaborators the service reads from; injectable for testing. */
export interface UsageServiceDeps {
  entitlements?: EntitlementService;
  items?: QueueItemRepository;
  workers?: WorkerRegistryRepository;
  recurrence?: QueueRecurrenceRepository;
}

/** Compute a {@link LimitUsage} from a current count and a (possibly null) limit. */
function measure(used: number, limit: number | null): LimitUsage {
  return {
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    withinLimit: isWithinLimit(limit, used),
  };
}

/**
 * Application service for the analytics/usage reporting surface. It pairs a
 * workspace's effective entitlements with live tenant-scoped counts so an
 * operator can see capacity headroom and a billing/upgrade signal at a glance.
 *
 * The surface is a paid feature: access is gated by the `analytics` entitlement,
 * so a Free-tier workspace receives a {@link PaymentRequiredError} (HTTP 402)
 * rather than the report. Every read is scoped to a single workspace.
 */
export class UsageService {
  private readonly entitlements: EntitlementService;
  private readonly items: QueueItemRepository;
  private readonly workers: WorkerRegistryRepository;
  private readonly recurrence: QueueRecurrenceRepository;

  constructor(deps: UsageServiceDeps = {}) {
    this.entitlements = deps.entitlements ?? entitlementService;
    this.items = deps.items ?? queueItemRepository;
    this.workers = deps.workers ?? workerRegistryRepository;
    this.recurrence = deps.recurrence ?? queueRecurrenceRepository;
  }

  /**
   * Build the workspace's usage report. Rejects with a 402 when the workspace's
   * plan does not include the analytics surface, so the feature flag is enforced
   * at the edge of the service rather than only in the UI.
   */
  async getUsage(workspaceId: string): Promise<UsageReport> {
    const { plan, status, entitlements } = await this.entitlements.getEntitlements(workspaceId);
    if (!entitlements.analytics) {
      throw new PaymentRequiredError(
        `Usage analytics is not available on the ${plan} plan. Upgrade to enable it.`,
      );
    }
    const [activeItems, workers, rules] = await Promise.all([
      this.items.countActive(workspaceId),
      this.workers.list(workspaceId),
      this.recurrence.list(workspaceId),
    ]);
    return {
      plan,
      status,
      entitlements,
      usage: {
        activeItems: measure(activeItems, entitlements.maxActiveItems),
        workers: measure(workers.length, entitlements.maxWorkers),
        recurrenceRules: measure(rules.length, entitlements.maxRecurrenceRules),
      },
    };
  }
}

/** Process-wide usage service bound to the shared service/repository singletons. */
export const usageService = new UsageService();
