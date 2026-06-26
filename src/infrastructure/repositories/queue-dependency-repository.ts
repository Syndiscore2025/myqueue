import type { PrismaClient, QueueDependency } from '@prisma/client';
import { getPrisma } from '../database/prisma';

export interface AddDependencyEdgeInput {
  workspaceId: string;
  permanentQueueId: string;
  dependsOnPermanentQueueId: string;
  dependencyType?:
    | 'COMPLETE_REQUIRED'
    | 'FAIL_IF_DEPENDENCY_FAILS'
    | 'CONTINUE_IF_DEPENDENCY_FAILS';
}

/** A dependency edge enriched with the upstream item's current status. */
export interface DependencyEdgeWithStatus extends QueueDependency {
  upstreamStatus: string;
  upstreamPermanentQueueId: string;
}

/** Items that need to be unblocked because their upstream resolved. */
export interface BlockedDependent {
  queueItemId: string;
  workspaceId: string;
  permanentQueueId: string;
  dependencyType: string;
}

export class QueueDependencyRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async addEdge(input: AddDependencyEdgeInput): Promise<QueueDependency> {
    const [dependent, upstream] = await Promise.all([
      this.prisma.queueItem.findFirst({
        where: { workspaceId: input.workspaceId, permanentQueueId: input.permanentQueueId },
        select: { id: true },
      }),
      this.prisma.queueItem.findFirst({
        where: {
          workspaceId: input.workspaceId,
          permanentQueueId: input.dependsOnPermanentQueueId,
        },
        select: { id: true },
      }),
    ]);
    if (!dependent || !upstream) {
      throw new Error('One or both queue items not found in workspace');
    }
    return this.prisma.queueDependency.create({
      data: {
        workspaceId: input.workspaceId,
        queueItemId: dependent.id,
        dependsOnQueueItemId: upstream.id,
        dependencyType: (input.dependencyType ?? 'COMPLETE_REQUIRED') as never,
      },
    });
  }

  async listForItem(workspaceId: string, permanentQueueId: string): Promise<QueueDependency[]> {
    const item = await this.prisma.queueItem.findFirst({
      where: { workspaceId, permanentQueueId },
      select: { id: true },
    });
    if (!item) return [];
    return this.prisma.queueDependency.findMany({ where: { queueItemId: item.id } });
  }

  /**
   * Find dependents of the given upstream item that can now be unblocked.
   * - For Done upstream: unblock COMPLETE_REQUIRED and FAIL_IF_DEPENDENCY_FAILS edges.
   * - For DeadLetter upstream: unblock only CONTINUE_IF_DEPENDENCY_FAILS edges.
   *   FAIL_IF_DEPENDENCY_FAILS dependents are returned separately so the caller
   *   can dead-letter them.
   */
  async findResolvableDependents(
    upstreamItemId: string,
    upstreamFinalStatus: 'Done' | 'DeadLetter',
  ): Promise<{ toUnblock: BlockedDependent[]; toDeadLetter: BlockedDependent[] }> {
    const edges = await this.prisma.queueDependency.findMany({
      where: { dependsOnQueueItemId: upstreamItemId },
      include: {
        queueItem: { select: { id: true, workspaceId: true, permanentQueueId: true } },
      },
    });

    const toUnblock: BlockedDependent[] = [];
    const toDeadLetter: BlockedDependent[] = [];

    for (const edge of edges) {
      const dep: BlockedDependent = {
        queueItemId: edge.queueItem.id,
        workspaceId: edge.queueItem.workspaceId,
        permanentQueueId: edge.queueItem.permanentQueueId,
        dependencyType: edge.dependencyType,
      };

      if (upstreamFinalStatus === 'Done') {
        toUnblock.push(dep);
      } else {
        // upstreamFinalStatus === 'DeadLetter'
        if (edge.dependencyType === 'CONTINUE_IF_DEPENDENCY_FAILS') {
          toUnblock.push(dep);
        } else if (edge.dependencyType === 'FAIL_IF_DEPENDENCY_FAILS') {
          toDeadLetter.push(dep);
        }
        // COMPLETE_REQUIRED: dependent stays blocked; no action
      }
    }

    return { toUnblock, toDeadLetter };
  }
}

export const queueDependencyRepository = new QueueDependencyRepository();
