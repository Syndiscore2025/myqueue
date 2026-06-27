import type { Redis } from 'ioredis';
import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';
import { getRedis } from '../redis/redis';

/**
 * Atomically increment a sliding-window counter. On the first hit the key's
 * expiry is set to the window length so the bucket self-resets. Returns the
 * current hit count and the remaining TTL (ms) so callers can derive a reset
 * time without a second round-trip.
 */
const INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

export interface RedisRateLimitStoreOptions {
  /** Injectable client (defaults to the shared application Redis client). */
  client?: Redis;
  /** Key prefix isolating rate-limit keys from other Redis data. */
  prefix?: string;
  /** Window length in ms; overridden by {@link Store.init} when registered. */
  windowMs?: number;
}

/**
 * An `express-rate-limit` {@link Store} backed by Redis so limits are shared
 * across every API instance and survive restarts. Operations may throw on a
 * Redis outage; the middleware is configured with `passOnStoreError` so the
 * request fails open rather than taking the API down.
 */
export class RedisRateLimitStore implements Store {
  /** Keys live in shared Redis, so they are never instance-local. */
  readonly localKeys = false;
  readonly prefix: string;

  private readonly injectedClient: Redis | undefined;
  private windowMs: number;

  constructor(options: RedisRateLimitStoreOptions = {}) {
    this.injectedClient = options.client;
    this.prefix = options.prefix ?? 'rl:';
    this.windowMs = options.windowMs ?? 60_000;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const client = this.client();
    const fullKey = this.key(key);
    const result = (await client.eval(INCREMENT_SCRIPT, 1, fullKey, this.windowMs)) as [
      number,
      number,
    ];

    const totalHits = result[0];
    let ttlMs = result[1];
    // A key without an expiry (ttl < 0) should not linger forever; re-arm it.
    if (ttlMs < 0) {
      await client.pexpire(fullKey, this.windowMs);
      ttlMs = this.windowMs;
    }

    return { totalHits, resetTime: new Date(Date.now() + ttlMs) };
  }

  async decrement(key: string): Promise<void> {
    const client = this.client();
    const fullKey = this.key(key);
    const current = await client.get(fullKey);
    if (current !== null && Number(current) > 0) {
      await client.decr(fullKey);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.client().del(this.key(key));
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const client = this.client();
    const fullKey = this.key(key);
    const current = await client.get(fullKey);
    if (current === null) {
      return undefined;
    }
    const ttlMs = await client.pttl(fullKey);
    return {
      totalHits: Number(current),
      resetTime: ttlMs >= 0 ? new Date(Date.now() + ttlMs) : undefined,
    };
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  private client(): Redis {
    return this.injectedClient ?? getRedis();
  }
}
