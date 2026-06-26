import type { WorkerRegistration } from '@prisma/client';
import type {
  QueueItemRepository,
  WorkerRegistryRepository,
} from '../../infrastructure/repositories';
import { queueItemRepository, workerRegistryRepository } from '../../infrastructure/repositories';
import type { WorkerContext } from './queue-claim-service';

/** Collaborators the worker-registry service orchestrates; injectable for testing. */
export interface WorkerRegistryServiceDeps {
  registry?: WorkerRegistryRepository;
  items?: QueueItemRepository;
}

/**
 * Application service for the worker registry. Workers auto-register on their
 * first claim or heartbeat (see {@link QueueClaimService}); this service backs
 * that registration and the operator-facing `GET /api/v1/workers` listing.
 *
 * The reported `processingCount` is derived live from item state rather than
 * read from the stored column, so it stays correct even when items leave a
 * worker by recovery, completion, or failure. All operations are scoped by
 * workspace.
 */
export class WorkerRegistryService {
  private readonly registry: WorkerRegistryRepository;
  private readonly items: QueueItemRepository;

  constructor(deps: WorkerRegistryServiceDeps = {}) {
    this.registry = deps.registry ?? workerRegistryRepository;
    this.items = deps.items ?? queueItemRepository;
  }

  /** Register a worker or refresh its liveness; called on claim and heartbeat. */
  async register(ctx: WorkerContext): Promise<WorkerRegistration> {
    return this.registry.register({
      workspaceId: ctx.workspaceId,
      workerId: ctx.workerId,
      hostname: ctx.hostname ?? null,
      now: new Date(),
    });
  }

  /**
   * List the workspace's registered workers, each with a live `processingCount`
   * reflecting the items it currently holds in Processing.
   */
  async list(workspaceId: string): Promise<WorkerRegistration[]> {
    const [workers, counts] = await Promise.all([
      this.registry.list(workspaceId),
      this.items.countProcessingByWorker(workspaceId),
    ]);
    return workers.map((worker) => ({
      ...worker,
      processingCount: counts[worker.workerId] ?? 0,
    }));
  }
}

/** Process-wide worker-registry service bound to the shared repository singletons. */
export const workerRegistryService = new WorkerRegistryService();
