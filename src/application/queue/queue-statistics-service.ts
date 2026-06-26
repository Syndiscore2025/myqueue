import type {
  QueueItemRepository,
  WorkerRegistryRepository,
} from '../../infrastructure/repositories';
import { type QueueStatistics } from '../../infrastructure/repositories';
import { queueItemRepository, workerRegistryRepository } from '../../infrastructure/repositories';

/** Collaborators the statistics service orchestrates; injectable for testing. */
export interface QueueStatisticsServiceDeps {
  items?: QueueItemRepository;
  registry?: WorkerRegistryRepository;
}

/** How busy the workspace's registered workers currently are. */
export interface WorkerUtilization {
  /** Workers known to the registry for this workspace. */
  totalWorkers: number;
  /** Workers currently holding at least one item in Processing. */
  busyWorkers: number;
  /** busyWorkers / totalWorkers in [0, 1]; 0 when there are no workers. */
  ratio: number;
}

/** The full operator-facing statistics view: queue aggregates plus utilization. */
export interface QueueStatisticsView extends QueueStatistics {
  workerUtilization: WorkerUtilization;
}

/**
 * Application service for the `GET /api/v1/queue/statistics` endpoint. It pairs
 * the queue's stored/derived aggregates (counts, wait/processing times, retries,
 * oldest/newest, queue age, longest in-flight job) with live worker utilization
 * computed from the registry and current Processing assignments. Worker busyness
 * is derived from item state, so it stays correct even when items leave a worker
 * by recovery, completion, or failure. All operations are scoped by workspace.
 */
export class QueueStatisticsService {
  private readonly items: QueueItemRepository;
  private readonly registry: WorkerRegistryRepository;

  constructor(deps: QueueStatisticsServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.registry = deps.registry ?? workerRegistryRepository;
  }

  /** Compute the workspace's queue statistics plus current worker utilization. */
  async get(workspaceId: string): Promise<QueueStatisticsView> {
    const [stats, busyByWorker, workers] = await Promise.all([
      this.items.getStatistics(workspaceId),
      this.items.countProcessingByWorker(workspaceId),
      this.registry.list(workspaceId),
    ]);
    const totalWorkers = workers.length;
    const busyWorkers = Object.keys(busyByWorker).length;
    const ratio = totalWorkers === 0 ? 0 : busyWorkers / totalWorkers;
    return { ...stats, workerUtilization: { totalWorkers, busyWorkers, ratio } };
  }
}

/** Process-wide statistics service bound to the shared repository singletons. */
export const queueStatisticsService = new QueueStatisticsService();
