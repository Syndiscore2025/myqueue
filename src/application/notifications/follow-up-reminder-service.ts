import { env } from '../../config';
import type { QueueItemRepository } from '../../infrastructure/repositories';
import { queueItemRepository } from '../../infrastructure/repositories';
import { slackIdempotencyService } from '../slack/slack-idempotency-service';
import { createLogger } from '../../utils/logger';
import { notificationService } from './notification-service';

/**
 * How long a follow-up reminder dedupe key is retained. The key is scoped to a
 * specific (item, dueAt) pair, so a long TTL ensures each due time fires exactly
 * one reminder even though the item keeps matching the sweep until the owner
 * acts on it. Seven days comfortably outlives any realistic follow-up window.
 */
export const FOLLOW_UP_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The notification capability this sweep needs; narrowed for easy faking. */
export interface FollowUpNotifier {
  notifyFollowUpDue(workspaceId: string, queueItemId: string): Promise<boolean>;
}

/** The one-time guard this sweep needs; narrowed for easy faking. */
export interface ReminderDedupe {
  claim(key: string, ttlSeconds?: number): Promise<boolean>;
}

/** Collaborators the service orchestrates; injectable for testing. */
export interface FollowUpReminderServiceDeps {
  items?: QueueItemRepository;
  notifier?: FollowUpNotifier;
  dedupe?: ReminderDedupe;
}

/**
 * Background sweep that DMs the owner of each `FollowUp` item whose reminder has
 * come due. Mirrors the activation/recovery loops: bounded batches, an
 * overlap-guarded tick, and idempotent start/stop. Each item is deduped via a
 * stable (workspace, item, dueAt) key before notifying, so a still-due item is
 * reminded once per due time rather than every tick.
 */
export class FollowUpReminderService {
  private readonly items: QueueItemRepository;
  private readonly notifier: FollowUpNotifier;
  private readonly dedupe: ReminderDedupe;
  private readonly log = createLogger('follow-up-reminder');
  private timer: NodeJS.Timeout | null = null;
  private sweepRunning = false;

  constructor(deps: FollowUpReminderServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.notifier = deps.notifier ?? notificationService;
    this.dedupe = deps.dedupe ?? slackIdempotencyService;
  }

  /**
   * Run one reminder sweep: load due follow-ups (up to
   * {@link Env.QUEUE_FOLLOW_UP_BATCH_SIZE}), claim each item's dedupe key, and DM
   * the owner on first claim. Returns the number of reminders delivered.
   */
  async remindBatch(now: Date = new Date()): Promise<number> {
    const due = await this.items.listDueFollowUps({
      batchSize: env.QUEUE_FOLLOW_UP_BATCH_SIZE,
      now,
    });
    let sent = 0;
    for (const item of due) {
      const key = `myqueue:followup:${item.workspaceId}:${item.id}:${item.followUpDueAt.getTime()}`;
      const first = await this.dedupe.claim(key, FOLLOW_UP_DEDUPE_TTL_SECONDS);
      if (!first) continue;
      const delivered = await this.notifier.notifyFollowUpDue(item.workspaceId, item.id);
      if (delivered) sent += 1;
    }
    if (due.length > 0) {
      this.log.info({ due: due.length, sent }, 'processed due follow-up reminders');
    }
    return sent;
  }

  /**
   * Start the background reminder loop, running a sweep every
   * {@link Env.QUEUE_FOLLOW_UP_INTERVAL_SECONDS} seconds. Idempotent: calling
   * start while already running has no effect. The timer is unref'd so it does
   * not prevent the process from exiting if shutdown completes first.
   */
  start(): void {
    if (this.timer !== null) return;
    const intervalMs = env.QUEUE_FOLLOW_UP_INTERVAL_SECONDS * 1_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.log.info(
      {
        intervalSeconds: env.QUEUE_FOLLOW_UP_INTERVAL_SECONDS,
        batchSize: env.QUEUE_FOLLOW_UP_BATCH_SIZE,
      },
      'follow-up reminder loop started',
    );
  }

  /** Stop the background reminder loop. Idempotent. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log.info('follow-up reminder loop stopped');
  }

  /** Single-invocation reminder tick, guarded against overlapping runs. */
  private async tick(): Promise<void> {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      await this.remindBatch();
    } catch (err) {
      this.log.error({ err }, 'follow-up reminder sweep failed');
    } finally {
      this.sweepRunning = false;
    }
  }
}

/** Process-wide follow-up reminder service bound to the shared collaborators. */
export const followUpReminderService = new FollowUpReminderService();
