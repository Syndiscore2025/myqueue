import type { QueueRecurrenceRule } from '@prisma/client';
import { CronExpressionParser } from 'cron-parser';
import { env } from '../../config';
import { QueueEventType, QueuePriority, QueueSourceType } from '../../domain/queue/enums';
import type { QueueEventRepository, QueueItemRepository } from '../../infrastructure/repositories';
import { queueEventRepository, queueItemRepository } from '../../infrastructure/repositories';
import type {
  CreateRecurrenceRuleInput,
  QueueRecurrenceRepository,
} from '../../infrastructure/repositories/queue-recurrence-repository';
import { queueRecurrenceRepository } from '../../infrastructure/repositories/queue-recurrence-repository';
import { createLogger } from '../../utils/logger';

export interface QueueRecurrenceServiceDeps {
  items?: QueueItemRepository;
  events?: QueueEventRepository;
  recurrence?: QueueRecurrenceRepository;
}

/**
 * Computes the next run time for a cron expression from a given reference date.
 * Returns null if the expression is exhausted or invalid.
 */
export function nextRunAfter(cronExpression: string, timezone: string, after: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      tz: timezone,
      currentDate: after,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

/**
 * Application service managing recurring cron rules and the background sweep
 * that spawns queue items from due rules.
 *
 * Each sweep uses `FOR UPDATE SKIP LOCKED` (via `claimDueRules`) so concurrent
 * workers never double-process the same rule.
 */
export class QueueRecurrenceService {
  private readonly items: QueueItemRepository;
  private readonly events: QueueEventRepository;
  private readonly recurrence: QueueRecurrenceRepository;
  private readonly log = createLogger('queue-recurrence');
  private timer: NodeJS.Timeout | null = null;
  private sweepRunning = false;

  constructor(deps: QueueRecurrenceServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.events = deps.events ?? queueEventRepository;
    this.recurrence = deps.recurrence ?? queueRecurrenceRepository;
  }

  /** Create a rule and set its initial nextRunAt. */
  async createRule(input: CreateRecurrenceRuleInput): Promise<QueueRecurrenceRule> {
    const rule = await this.recurrence.create(input);
    const firstRun = nextRunAfter(rule.cronExpression, rule.timezone, new Date());
    const updated = await this.recurrence.update(rule.id, rule.workspaceId, {
      nextRunAt: firstRun,
    });
    return updated;
  }

  async getRule(id: string, workspaceId: string): Promise<QueueRecurrenceRule | null> {
    return this.recurrence.findById(id, workspaceId);
  }

  async listRules(workspaceId: string): Promise<QueueRecurrenceRule[]> {
    return this.recurrence.list(workspaceId);
  }

  async pauseRule(id: string, workspaceId: string): Promise<QueueRecurrenceRule> {
    return this.recurrence.update(id, workspaceId, { isEnabled: false });
  }

  async resumeRule(id: string, workspaceId: string): Promise<QueueRecurrenceRule> {
    return this.recurrence.update(id, workspaceId, { isEnabled: true });
  }

  /**
   * Process one batch of due rules: spawn a QueueItem per rule, advance the
   * rule's nextRunAt (or disable it when maxRuns is reached). Returns spawned count.
   */
  async processDueRules(now: Date = new Date()): Promise<number> {
    const batch = env.QUEUE_ACTIVATION_BATCH_SIZE;
    const dueRules = await this.recurrence.claimDueRules(batch, now);
    let spawned = 0;

    for (const rule of dueRules) {
      try {
        const owner = rule.ownerWorkspaceUserId ?? rule.createdByWorkspaceUserId;
        if (!owner) {
          this.log.warn({ ruleId: rule.id }, 'recurrence rule has no owner — skipping');
          continue;
        }

        const newRunCount = rule.runCount + 1;
        const hitMax = rule.maxRuns !== null && newRunCount >= rule.maxRuns;

        const item = await this.items.create({
          workspaceId: rule.workspaceId,
          ownerWorkspaceUserId: owner,
          title: rule.name,
          priority: (rule.priority as QueuePriority) ?? QueuePriority.Green,
          sourceType: QueueSourceType.API,
          recurrenceRuleId: rule.id,
        });

        await this.events.record({
          workspaceId: rule.workspaceId,
          queueItemId: item.id,
          eventType: QueueEventType.RECURRING_ITEM_CREATED,
          newValue: item.permanentQueueId,
          metadata: { ruleId: rule.id, runCount: newRunCount },
        });

        const nextRunAt = hitMax ? null : nextRunAfter(rule.cronExpression, rule.timezone, now);

        await this.recurrence.advanceRule(rule.id, {
          lastRunAt: now,
          nextRunAt,
          runCount: newRunCount,
          isEnabled: !hitMax,
        });

        spawned++;
      } catch (err) {
        this.log.error({ err, ruleId: rule.id }, 'failed to process recurrence rule');
      }
    }

    if (spawned > 0) {
      this.log.info({ spawned }, 'spawned recurring queue items');
    }
    return spawned;
  }

  /** Start the background recurrence sweep loop. Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    const intervalMs = env.QUEUE_SCHEDULER_INTERVAL_SECONDS * 1_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.log.info(
      { intervalSeconds: env.QUEUE_SCHEDULER_INTERVAL_SECONDS },
      'queue recurrence loop started',
    );
  }

  /** Stop the background recurrence sweep loop. Idempotent. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log.info('queue recurrence loop stopped');
  }

  private async tick(): Promise<void> {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      await this.processDueRules();
    } catch (err) {
      this.log.error({ err }, 'queue recurrence sweep failed');
    } finally {
      this.sweepRunning = false;
    }
  }
}

export const queueRecurrenceService = new QueueRecurrenceService();
