import { Prisma, type PrismaClient, type WorkspaceQueueSettings } from '@prisma/client';
import type { QueueRankingMode } from '../../domain/queue';
import { getPrisma } from '../database/prisma';

/** Mutable per-workspace queue configuration fields. */
export interface WorkspaceQueueSettingsUpdate {
  rankingMode?: QueueRankingMode;
  includeWaitingInActive?: boolean;
  includeWorkingInActive?: boolean;
  // Phase 5 — notification preferences.
  notifyOnAssignment?: boolean;
  notifyOnSnoozeWake?: boolean;
  notifyOnFollowUpDue?: boolean;
  dailyDigestEnabled?: boolean;
  dailyDigestHourUtc?: number;
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
    try {
      return await this.prisma.workspaceQueueSettings.upsert({
        where: { workspaceId },
        create: { workspaceId },
        update: {},
      });
    } catch (err) {
      // Many workers making their first claim concurrently can race the upsert's
      // create path and collide on the unique workspace_id. The row exists now,
      // so re-read it rather than failing the claim.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.workspaceQueueSettings.findUnique({
          where: { workspaceId },
        });
        if (existing !== null) {
          return existing;
        }
      }
      throw err;
    }
  }

  /** Read the settings row for a workspace, or null if none exists yet. */
  async find(workspaceId: string): Promise<WorkspaceQueueSettings | null> {
    return this.prisma.workspaceQueueSettings.findUnique({ where: { workspaceId } });
  }

  /**
   * List the settings rows of every workspace that has the daily digest enabled
   * and scheduled for `hourUtc` (0–23). A read-only input for the digest sweep;
   * each row carries the workspace id plus the ranking flags the sweep needs to
   * rank that workspace's items. Tenant isolation is preserved because the caller
   * lists and notifies strictly within each returned workspace.
   */
  async listDigestEnabledForHour(hourUtc: number): Promise<WorkspaceQueueSettings[]> {
    return this.prisma.workspaceQueueSettings.findMany({
      where: { dailyDigestEnabled: true, dailyDigestHourUtc: hourUtc },
    });
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
      ...(changes.notifyOnAssignment === undefined
        ? {}
        : { notifyOnAssignment: changes.notifyOnAssignment }),
      ...(changes.notifyOnSnoozeWake === undefined
        ? {}
        : { notifyOnSnoozeWake: changes.notifyOnSnoozeWake }),
      ...(changes.notifyOnFollowUpDue === undefined
        ? {}
        : { notifyOnFollowUpDue: changes.notifyOnFollowUpDue }),
      ...(changes.dailyDigestEnabled === undefined
        ? {}
        : { dailyDigestEnabled: changes.dailyDigestEnabled }),
      ...(changes.dailyDigestHourUtc === undefined
        ? {}
        : { dailyDigestHourUtc: changes.dailyDigestHourUtc }),
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
