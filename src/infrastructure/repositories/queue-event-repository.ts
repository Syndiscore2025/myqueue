import type { Prisma, PrismaClient, QueueEvent } from '@prisma/client';
import type { QueueEventType } from '../../domain/queue';
import { getPrisma } from '../database/prisma';

/**
 * Details of a single auditable queue event. queueItemId is optional so
 * queue-wide events (e.g. RECALCULATED) can be recorded without an item.
 */
export interface QueueEventEntry {
  workspaceId: string;
  eventType: QueueEventType;
  queueItemId?: string | null;
  actorWorkspaceUserId?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only audit trail of queue events, scoped per workspace. Entries are
 * never updated or deleted — only recorded and read back in order.
 */
export class QueueEventRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Record a queue event for a workspace. */
  async record(entry: QueueEventEntry): Promise<QueueEvent> {
    return this.prisma.queueEvent.create({
      data: {
        workspaceId: entry.workspaceId,
        eventType: entry.eventType,
        queueItemId: entry.queueItemId ?? null,
        actorWorkspaceUserId: entry.actorWorkspaceUserId ?? null,
        previousValue: entry.previousValue ?? null,
        newValue: entry.newValue ?? null,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      },
    });
  }

  /** List the most recent events for a workspace, newest first. */
  async listForWorkspace(workspaceId: string, limit = 50): Promise<QueueEvent[]> {
    return this.prisma.queueEvent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** List the most recent events for a single item within a workspace. */
  async listForItem(workspaceId: string, queueItemId: string, limit = 50): Promise<QueueEvent[]> {
    return this.prisma.queueEvent.findMany({
      where: { workspaceId, queueItemId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

/** Process-wide queue event repository bound to the shared Prisma client. */
export const queueEventRepository = new QueueEventRepository();
