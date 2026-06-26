import type { AuditAction, Prisma, PrismaClient, WorkspaceAuditLog } from '@prisma/client';
import { getPrisma } from '../database/prisma';

/** Details of a single auditable platform action. */
export interface AuditEntry {
  workspaceId: string;
  action: AuditAction;
  actorSlackUserId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only audit trail, scoped per workspace. Entries are never updated or
 * deleted through this repository — only recorded and read back in order.
 */
export class WorkspaceAuditLogRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Record an auditable action for a workspace. */
  async record(entry: AuditEntry): Promise<WorkspaceAuditLog> {
    return this.prisma.workspaceAuditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        action: entry.action,
        actorSlackUserId: entry.actorSlackUserId ?? null,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      },
    });
  }

  /** List the most recent audit entries for a workspace, newest first. */
  async listForWorkspace(workspaceId: string, limit = 50): Promise<WorkspaceAuditLog[]> {
    return this.prisma.workspaceAuditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

/** Process-wide audit log repository bound to the shared Prisma client. */
export const workspaceAuditLogRepository = new WorkspaceAuditLogRepository();
