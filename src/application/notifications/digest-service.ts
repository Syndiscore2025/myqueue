import type { WorkspaceQueueSettings } from '@prisma/client';
import { env } from '../../config';
import { QueueStatus, rankActiveQueue } from '../../domain/queue';
import type { QueueItem, RankingOptions } from '../../domain/queue';
import type {
  QueueItemRepository,
  WorkspaceQueueSettingsRepository,
} from '../../infrastructure/repositories';
import {
  queueItemRepository,
  workspaceQueueSettingsRepository,
} from '../../infrastructure/repositories';
import { slackIdempotencyService } from '../slack/slack-idempotency-service';
import { createLogger } from '../../utils/logger';
import type { NotifiableItem } from './messages';
import { notificationService } from './notification-service';

/**
 * How long a digest dedupe key is retained. The key is scoped to a
 * (workspace, owner, UTC date) triple, so a TTL just over a day guarantees one
 * digest per owner per day while letting the same hour fire again tomorrow.
 */
export const DIGEST_DEDUPE_TTL_SECONDS = 25 * 60 * 60;

/** The maximal active-queue candidate set; the ranking engine narrows per settings. */
const ACTIVE_CANDIDATE_STATUSES = [
  QueueStatus.New,
  QueueStatus.Working,
  QueueStatus.Waiting,
] as const;

/** The digest delivery capability this sweep needs; narrowed for easy faking. */
export interface DigestNotifier {
  notifyDigest(
    workspaceId: string,
    ownerWorkspaceUserId: string,
    items: NotifiableItem[],
  ): Promise<boolean>;
}

/** The one-time guard this sweep needs; narrowed for easy faking. */
export interface DigestDedupe {
  claim(key: string, ttlSeconds?: number): Promise<boolean>;
}

/** Collaborators the service orchestrates; injectable for testing. */
export interface DigestServiceDeps {
  items?: QueueItemRepository;
  settings?: WorkspaceQueueSettingsRepository;
  notifier?: DigestNotifier;
  dedupe?: DigestDedupe;
}

/** Group a workspace's items by their owner, preserving query order. */
function groupByOwner(items: QueueItem[]): Map<string, QueueItem[]> {
  const byOwner = new Map<string, QueueItem[]>();
  for (const item of items) {
    const existing = byOwner.get(item.ownerWorkspaceUserId);
    if (existing === undefined) byOwner.set(item.ownerWorkspaceUserId, [item]);
    else existing.push(item);
  }
  return byOwner;
}

/** YYYY-MM-DD in UTC, the per-day component of the dedupe key. */
function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Background sweep that DMs each owner a summary of their active queue once a
 * day, at the UTC hour configured per workspace. Mirrors the activation/recovery
 * loops: an overlap-guarded tick and idempotent start/stop. Owners with no active
 * items are skipped, and each (workspace, owner, day) is deduped so re-running the
 * sweep within the digest hour never sends a second DM.
 */
export class DigestService {
  private readonly items: QueueItemRepository;
  private readonly settings: WorkspaceQueueSettingsRepository;
  private readonly notifier: DigestNotifier;
  private readonly dedupe: DigestDedupe;
  private readonly log = createLogger('digest');
  private timer: NodeJS.Timeout | null = null;
  private sweepRunning = false;

  constructor(deps: DigestServiceDeps = {}) {
    this.items = deps.items ?? queueItemRepository;
    this.settings = deps.settings ?? workspaceQueueSettingsRepository;
    this.notifier = deps.notifier ?? notificationService;
    this.dedupe = deps.dedupe ?? slackIdempotencyService;
  }

  /**
   * Run one digest sweep for the current UTC hour: load every digest-enabled
   * workspace scheduled for this hour and DM each owner their ranked active
   * queue. Returns the number of digests delivered.
   */
  async digestBatch(now: Date = new Date()): Promise<number> {
    const hourUtc = now.getUTCHours();
    const workspaces = await this.settings.listDigestEnabledForHour(hourUtc);
    let sent = 0;
    for (const settings of workspaces) {
      sent += await this.digestWorkspace(settings, now);
    }
    if (workspaces.length > 0) {
      this.log.info({ hourUtc, workspaces: workspaces.length, sent }, 'processed daily digests');
    }
    return sent;
  }

  /** Rank one workspace's items per owner and DM each owner with active work. */
  private async digestWorkspace(settings: WorkspaceQueueSettings, now: Date): Promise<number> {
    const options: RankingOptions = {
      mode: settings.rankingMode,
      includeWorkingInActive: settings.includeWorkingInActive,
      includeWaitingInActive: settings.includeWaitingInActive,
    };
    const items = await this.items.listByWorkspace(settings.workspaceId, {
      statuses: ACTIVE_CANDIDATE_STATUSES,
    });
    const dateKey = utcDateKey(now);
    let sent = 0;
    for (const [ownerWorkspaceUserId, ownerItems] of groupByOwner(items)) {
      const ranked = rankActiveQueue(ownerItems, options, now);
      if (ranked.length === 0) continue;
      const key = `myqueue:digest:${settings.workspaceId}:${ownerWorkspaceUserId}:${dateKey}`;
      const first = await this.dedupe.claim(key, DIGEST_DEDUPE_TTL_SECONDS);
      if (!first) continue;
      const delivered = await this.notifier.notifyDigest(
        settings.workspaceId,
        ownerWorkspaceUserId,
        ranked.map((r) => r.item),
      );
      if (delivered) sent += 1;
    }
    return sent;
  }

  /**
   * Start the background digest loop, running a sweep every
   * {@link Env.QUEUE_DIGEST_INTERVAL_SECONDS} seconds. Idempotent: calling start
   * while already running has no effect. The timer is unref'd so it does not
   * prevent the process from exiting if shutdown completes first.
   */
  start(): void {
    if (this.timer !== null) return;
    const intervalMs = env.QUEUE_DIGEST_INTERVAL_SECONDS * 1_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.log.info(
      { intervalSeconds: env.QUEUE_DIGEST_INTERVAL_SECONDS },
      'daily digest loop started',
    );
  }

  /** Stop the background digest loop. Idempotent. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.log.info('daily digest loop stopped');
  }

  /** Single-invocation digest tick, guarded against overlapping runs. */
  private async tick(): Promise<void> {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      await this.digestBatch();
    } catch (err) {
      this.log.error({ err }, 'daily digest sweep failed');
    } finally {
      this.sweepRunning = false;
    }
  }
}

/** Process-wide digest service bound to the shared collaborators. */
export const digestService = new DigestService();
