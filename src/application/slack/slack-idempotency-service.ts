import type { Redis } from 'ioredis';
import { getRedis } from '../../infrastructure/redis/redis';
import { createLogger } from '../../utils/logger';

const log = createLogger('slack-idempotency');

/**
 * How long a claimed key is retained. Slack retries Events API deliveries a few
 * times over roughly a minute (signalled by `x-slack-retry-num`); ten minutes
 * comfortably covers that window without retaining keys indefinitely.
 */
export const SLACK_IDEMPOTENCY_TTL_SECONDS = 600;

/** The single Redis operation the guard needs; narrowed so tests can fake it. */
export type IdempotencyStore = Pick<Redis, 'set'>;

/** Collaborators the service uses; injectable for testing. */
export interface SlackIdempotencyServiceDeps {
  redis?: IdempotencyStore;
}

/**
 * A Redis-backed one-time guard that keeps Slack retries (and accidental
 * re-deliveries) from running a side-effecting handler more than once. Callers
 * key each unit of work by a stable id from the Slack payload — an Events API
 * `event_id`, or an interaction `trigger_id` — and only perform the side effect
 * when the key is claimed for the first time.
 *
 * The guard holds no business logic; it simply gates the interface adapters.
 */
export class SlackIdempotencyService {
  private readonly redis: IdempotencyStore | undefined;

  constructor(deps: SlackIdempotencyServiceDeps = {}) {
    this.redis = deps.redis;
  }

  /**
   * Resolve the Redis client, falling back to the shared application client.
   * Deferred until first use so constructing the process-wide singleton never
   * opens a connection at import time (which would also break module mocks).
   */
  private store(): IdempotencyStore {
    return this.redis ?? getRedis();
  }

  /**
   * Atomically claim a one-time `key`. Returns `true` when the caller is the
   * first to claim it (proceed with the side effect) and `false` when it was
   * already claimed within the TTL (a retry — skip the side effect). Uses
   * `SET key 1 EX ttl NX` so the check-and-set is a single atomic operation.
   *
   * Fails open: if Redis is unavailable the work is allowed to proceed, so a
   * transient cache outage degrades to "may run twice" rather than "never runs".
   */
  async claim(key: string, ttlSeconds: number = SLACK_IDEMPOTENCY_TTL_SECONDS): Promise<boolean> {
    try {
      const result = await this.store().set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      log.error({ err: error, key }, 'idempotency check failed; allowing action to proceed');
      return true;
    }
  }
}

/** Process-wide idempotency guard bound to the shared application Redis client. */
export const slackIdempotencyService = new SlackIdempotencyService();
