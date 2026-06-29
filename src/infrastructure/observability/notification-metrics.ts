import type { Redis } from 'ioredis';
import { getRedis } from '../redis/redis';
import { createLogger } from '../../utils/logger';

/**
 * Why a direct-message notification could not be delivered. Recorded so silently
 * dropped notifications surface operationally rather than living only in logs.
 */
export type DmFailureReason = 'no_token' | 'no_channel' | 'send_error';

/** Per-reason DM failure tallies for a workspace, plus their total. */
export interface DmFailureCounts {
  noToken: number;
  noChannel: number;
  sendError: number;
  total: number;
}

/**
 * Records and reports notification (DM) delivery failures. Notifications run in
 * the worker process while the observability endpoint serves from the API
 * process, so the counters must live in shared state — see
 * {@link RedisNotificationMetrics}.
 */
export interface NotificationMetrics {
  recordDmFailure(workspaceId: string, reason: DmFailureReason): Promise<void>;
  getDmFailureCounts(workspaceId: string): Promise<DmFailureCounts>;
}

const KEY_PREFIX = 'metrics:dm-failures';

/** Redis hash field per reason. Kept stable so historical counts are preserved. */
const FIELD: Record<DmFailureReason, string> = {
  no_token: 'no_token',
  no_channel: 'no_channel',
  send_error: 'send_error',
};

function keyFor(workspaceId: string): string {
  return `${KEY_PREFIX}:${workspaceId}`;
}

function toInt(value: string | undefined): number {
  const n = value === undefined ? 0 : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Redis-backed {@link NotificationMetrics}. Failures are tallied in a per-
 * workspace hash via atomic HINCRBY, so counts are shared across every API and
 * worker instance and survive restarts. Every method is fail-safe: a Redis
 * outage degrades observability but never breaks notification delivery.
 */
export class RedisNotificationMetrics implements NotificationMetrics {
  private readonly injectedClient: Redis | undefined;
  private readonly log = createLogger('notification-metrics');

  constructor(client?: Redis) {
    this.injectedClient = client;
  }

  /** Resolve the client lazily so the shared singleton never connects at import. */
  private client(): Redis {
    return this.injectedClient ?? getRedis();
  }

  async recordDmFailure(workspaceId: string, reason: DmFailureReason): Promise<void> {
    try {
      await this.client().hincrby(keyFor(workspaceId), FIELD[reason], 1);
    } catch (error) {
      this.log.warn({ err: error, workspaceId, reason }, 'failed to record DM failure metric');
    }
  }

  async getDmFailureCounts(workspaceId: string): Promise<DmFailureCounts> {
    try {
      const raw = await this.client().hgetall(keyFor(workspaceId));
      const noToken = toInt(raw[FIELD.no_token]);
      const noChannel = toInt(raw[FIELD.no_channel]);
      const sendError = toInt(raw[FIELD.send_error]);
      return { noToken, noChannel, sendError, total: noToken + noChannel + sendError };
    } catch (error) {
      this.log.warn({ err: error, workspaceId }, 'failed to read DM failure metrics');
      return { noToken: 0, noChannel: 0, sendError: 0, total: 0 };
    }
  }
}

/** Process-wide notification metrics bound to the shared Redis client. */
export const notificationMetrics: NotificationMetrics = new RedisNotificationMetrics();
