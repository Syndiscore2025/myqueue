import type { PrismaClient, WorkerRegistration } from '@prisma/client';
import { WorkerStatus } from '../../domain/queue';
import { getPrisma } from '../database/prisma';

/** Inputs for registering or refreshing a worker's liveness record. */
export interface RegisterWorkerParams {
  workspaceId: string;
  workerId: string;
  hostname?: string | null;
  now?: Date;
}

/**
 * Tenant-scoped persistence for the worker registry. A worker is uniquely
 * identified by (workspaceId, workerId); workers auto-register on their first
 * claim or heartbeat and refresh `lastSeenAt` on every subsequent activity. All
 * reads and writes are scoped by workspaceId.
 */
export class WorkerRegistryRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /**
   * Register a worker, or refresh it if already known. On first sight the row is
   * created with `startedAt`/`lastSeenAt` set to now; subsequent calls bump
   * `lastSeenAt`, mark it ACTIVE, and update `hostname` when one is supplied.
   */
  async register(params: RegisterWorkerParams): Promise<WorkerRegistration> {
    const now = params.now ?? new Date();
    const hostname = params.hostname ?? null;
    return this.prisma.workerRegistration.upsert({
      where: {
        workspaceId_workerId: {
          workspaceId: params.workspaceId,
          workerId: params.workerId,
        },
      },
      create: {
        workspaceId: params.workspaceId,
        workerId: params.workerId,
        hostname,
        status: WorkerStatus.ACTIVE,
        startedAt: now,
        lastSeenAt: now,
      },
      update: {
        status: WorkerStatus.ACTIVE,
        lastSeenAt: now,
        ...(hostname === null ? {} : { hostname }),
      },
    });
  }

  /** List a workspace's registered workers, earliest-started first. */
  async list(workspaceId: string): Promise<WorkerRegistration[]> {
    return this.prisma.workerRegistration.findMany({
      where: { workspaceId },
      orderBy: { startedAt: 'asc' },
    });
  }
}

/** Process-wide worker registry repository bound to the shared Prisma client. */
export const workerRegistryRepository = new WorkerRegistryRepository();
