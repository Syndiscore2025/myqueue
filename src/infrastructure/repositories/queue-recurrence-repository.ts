import { Prisma, type PrismaClient, type QueueRecurrenceRule } from '@prisma/client';
import { getPrisma } from '../database/prisma';
import type { QueuePriority } from '../../domain/queue/enums';

export interface CreateRecurrenceRuleInput {
  workspaceId: string;
  createdByWorkspaceUserId?: string | null;
  ownerWorkspaceUserId?: string | null;
  name: string;
  cronExpression: string;
  timezone?: string;
  maxRuns?: number | null;
  payloadTemplate?: Record<string, unknown> | null;
  priority?: QueuePriority;
  partitionKey?: string | null;
  rateLimitKey?: string | null;
}

export interface UpdateRecurrenceRuleInput {
  name?: string;
  cronExpression?: string;
  timezone?: string;
  maxRuns?: number | null;
  /** Use Prisma.JsonNull to explicitly null a JSON column (exactOptionalPropertyTypes). */
  payloadTemplate?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue;
  priority?: QueuePriority;
  isEnabled?: boolean;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  runCount?: number;
}

/** A due rule returned by claimDueRules (full columns required to spawn items). */
export interface DueRecurrenceRule {
  id: string;
  workspaceId: string;
  createdByWorkspaceUserId: string | null;
  ownerWorkspaceUserId: string | null;
  name: string;
  cronExpression: string;
  timezone: string;
  maxRuns: number | null;
  runCount: number;
  priority: string;
  partitionKey: string | null;
  rateLimitKey: string | null;
  payloadTemplate: unknown;
}

export class QueueRecurrenceRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async create(input: CreateRecurrenceRuleInput): Promise<QueueRecurrenceRule> {
    return this.prisma.queueRecurrenceRule.create({
      data: {
        workspaceId: input.workspaceId,
        createdByWorkspaceUserId: input.createdByWorkspaceUserId ?? null,
        ownerWorkspaceUserId: input.ownerWorkspaceUserId ?? input.createdByWorkspaceUserId ?? null,
        name: input.name,
        cronExpression: input.cronExpression,
        timezone: input.timezone ?? 'UTC',
        maxRuns: input.maxRuns ?? null,
        payloadTemplate:
          input.payloadTemplate === null || input.payloadTemplate === undefined
            ? Prisma.JsonNull
            : (input.payloadTemplate as Prisma.InputJsonValue),
        priority: (input.priority ?? 'Green') as never,
        partitionKey: input.partitionKey ?? null,
        rateLimitKey: input.rateLimitKey ?? null,
      },
    });
  }

  async findById(id: string, workspaceId: string): Promise<QueueRecurrenceRule | null> {
    return this.prisma.queueRecurrenceRule.findFirst({ where: { id, workspaceId } });
  }

  async list(workspaceId: string): Promise<QueueRecurrenceRule[]> {
    return this.prisma.queueRecurrenceRule.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    _workspaceId: string,
    data: UpdateRecurrenceRuleInput,
  ): Promise<QueueRecurrenceRule> {
    return this.prisma.queueRecurrenceRule.update({ where: { id }, data: data as never });
  }

  /**
   * Atomically claim due, enabled rules — advances nextRunAt to far future to
   * prevent double-processing. Caller must set real nextRunAt via advanceRule.
   */
  async claimDueRules(batchSize: number, now: Date): Promise<DueRecurrenceRule[]> {
    const farFuture = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.$queryRaw<DueRecurrenceRule[]>`
      UPDATE queue_recurrence_rules
      SET next_run_at  = ${farFuture},
          updated_at   = ${now}
      WHERE id IN (
        SELECT id FROM queue_recurrence_rules
        WHERE workspace_id IS NOT NULL
          AND is_enabled = true
          AND next_run_at IS NOT NULL
          AND next_run_at <= ${now}
        ORDER BY next_run_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id,
        workspace_id       AS "workspaceId",
        created_by_workspace_user_id  AS "createdByWorkspaceUserId",
        owner_workspace_user_id       AS "ownerWorkspaceUserId",
        name,
        cron_expression    AS "cronExpression",
        timezone,
        max_runs           AS "maxRuns",
        run_count          AS "runCount",
        priority,
        partition_key      AS "partitionKey",
        rate_limit_key     AS "rateLimitKey",
        payload_template   AS "payloadTemplate"
    `;
    return result;
  }

  async advanceRule(
    id: string,
    data: { nextRunAt: Date | null; lastRunAt: Date; runCount: number; isEnabled: boolean },
  ): Promise<QueueRecurrenceRule> {
    return this.prisma.queueRecurrenceRule.update({ where: { id }, data });
  }
}

export const queueRecurrenceRepository = new QueueRecurrenceRepository();
