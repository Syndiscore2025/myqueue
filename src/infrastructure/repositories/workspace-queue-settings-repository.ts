import type { PrismaClient, WorkspaceQueueSettings } from '@prisma/client';
import type { QueueRankingMode } from '../../domain/queue';
import { getPrisma } from '../database/prisma';

/** Mutable per-workspace queue configuration fields. */
export interface WorkspaceQueueSettingsUpdate {
  rankingMode?: QueueRankingMode;
  includeWaitingInActive?: boolean;
  includeWorkingInActive?: boolean;
}

/**
 * Persistence for per-workspace queue settings. Each workspace has exactly one
 * settings row, which also holds the monotonic counter used to mint permanent
 * queue ids. Every method is scoped to a single workspace.
 */
export class WorkspaceQueueSettingsRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Ensure a settings row exists for the workspace, returning it. */
  async ensure(workspaceId: string): Promise<WorkspaceQueueSettings> {
    return this.prisma.workspaceQueueSettings.upsert({
      where: { workspaceId },
      create: { workspaceId },
      update: {},
    });
  }

  /** Read the settings row for a workspace, or null if none exists yet. */
  async find(workspaceId: string): Promise<WorkspaceQueueSettings | null> {
    return this.prisma.workspaceQueueSettings.findUnique({ where: { workspaceId } });
  }

  /** Apply configuration changes, creating the row first if necessary. */
  async update(
    workspaceId: string,
    changes: WorkspaceQueueSettingsUpdate,
  ): Promise<WorkspaceQueueSettings> {
    const data = {
      ...(changes.rankingMode === undefined ? {} : { rankingMode: changes.rankingMode }),
      ...(changes.includeWaitingInActive === undefined
        ? {}
        : { includeWaitingInActive: changes.includeWaitingInActive }),
      ...(changes.includeWorkingInActive === undefined
        ? {}
        : { includeWorkingInActive: changes.includeWorkingInActive }),
    };
    return this.prisma.workspaceQueueSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });
  }
}

/** Process-wide queue settings repository bound to the shared Prisma client. */
export const workspaceQueueSettingsRepository = new WorkspaceQueueSettingsRepository();
