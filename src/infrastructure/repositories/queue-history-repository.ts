import type {
  PrismaClient,
  QueueAssignment,
  QueuePriorityHistory,
  QueueStatusHistory,
} from '@prisma/client';
import type { QueuePriority, QueueStatus } from '../../domain/queue';
import { getPrisma } from '../database/prisma';

/** A single status transition to append to an item's history. */
export interface StatusHistoryEntry {
  workspaceId: string;
  queueItemId: string;
  toStatus: QueueStatus;
  fromStatus?: QueueStatus | null;
  actorWorkspaceUserId?: string | null;
}

/** A single priority change to append to an item's history. */
export interface PriorityHistoryEntry {
  workspaceId: string;
  queueItemId: string;
  toPriority: QueuePriority;
  source: string;
  fromPriority?: QueuePriority | null;
  reason?: string | null;
  automatic?: boolean;
  actorWorkspaceUserId?: string | null;
}

/** A single ownership assignment to append to an item's history. */
export interface AssignmentEntry {
  workspaceId: string;
  queueItemId: string;
  ownerWorkspaceUserId: string;
  previousOwnerWorkspaceUserId?: string | null;
  assignedByWorkspaceUserId?: string | null;
}

/**
 * Append-only history of queue item status transitions, priority changes, and
 * ownership assignments. All reads and writes are scoped by workspaceId to
 * enforce tenant isolation. Entries are recorded and read back in order, never
 * updated or deleted.
 */
export class QueueHistoryRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Append a status transition to an item's history. */
  async recordStatusChange(entry: StatusHistoryEntry): Promise<QueueStatusHistory> {
    return this.prisma.queueStatusHistory.create({
      data: {
        workspaceId: entry.workspaceId,
        queueItemId: entry.queueItemId,
        toStatus: entry.toStatus,
        fromStatus: entry.fromStatus ?? null,
        actorWorkspaceUserId: entry.actorWorkspaceUserId ?? null,
      },
    });
  }

  /** Append a priority change to an item's history. */
  async recordPriorityChange(entry: PriorityHistoryEntry): Promise<QueuePriorityHistory> {
    return this.prisma.queuePriorityHistory.create({
      data: {
        workspaceId: entry.workspaceId,
        queueItemId: entry.queueItemId,
        toPriority: entry.toPriority,
        source: entry.source,
        fromPriority: entry.fromPriority ?? null,
        reason: entry.reason ?? null,
        automatic: entry.automatic ?? false,
        actorWorkspaceUserId: entry.actorWorkspaceUserId ?? null,
      },
    });
  }

  /** Append an ownership assignment to an item's history. */
  async recordAssignment(entry: AssignmentEntry): Promise<QueueAssignment> {
    return this.prisma.queueAssignment.create({
      data: {
        workspaceId: entry.workspaceId,
        queueItemId: entry.queueItemId,
        ownerWorkspaceUserId: entry.ownerWorkspaceUserId,
        previousOwnerWorkspaceUserId: entry.previousOwnerWorkspaceUserId ?? null,
        assignedByWorkspaceUserId: entry.assignedByWorkspaceUserId ?? null,
      },
    });
  }

  /** List an item's status history within a workspace, oldest first. */
  async listStatusHistory(workspaceId: string, queueItemId: string): Promise<QueueStatusHistory[]> {
    return this.prisma.queueStatusHistory.findMany({
      where: { workspaceId, queueItemId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** List an item's priority history within a workspace, oldest first. */
  async listPriorityHistory(
    workspaceId: string,
    queueItemId: string,
  ): Promise<QueuePriorityHistory[]> {
    return this.prisma.queuePriorityHistory.findMany({
      where: { workspaceId, queueItemId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** List an item's assignment history within a workspace, oldest first. */
  async listAssignments(workspaceId: string, queueItemId: string): Promise<QueueAssignment[]> {
    return this.prisma.queueAssignment.findMany({
      where: { workspaceId, queueItemId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

/** Process-wide queue history repository bound to the shared Prisma client. */
export const queueHistoryRepository = new QueueHistoryRepository();
