import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('redis');

/**
 * Create a new ioredis connection from the validated `REDIS_URL`.
 *
 * @param overrides Connection options merged over the defaults. BullMQ requires
 *                  `maxRetriesPerRequest: null`, so dedicated connections are
 *                  created via {@link createBullConnection} rather than reusing
 *                  the shared application client.
 */
export function createRedisConnection(overrides: RedisOptions = {}): Redis {
  const connection = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    ...overrides,
  });

  connection.on('error', (error: Error) => {
    log.error({ err: error }, 'redis connection error');
  });

  return connection;
}

/** Connection options BullMQ requires for queues and workers. */
export function createBullConnection(): Redis {
  return createRedisConnection({ maxRetriesPerRequest: null });
}

let client: Redis | undefined;

/** Shared application Redis client (cache, locks, etc.). */
export function getRedis(): Redis {
  if (client === undefined) {
    client = createRedisConnection();
  }
  return client;
}

/** Establish the shared Redis connection. Safe to call multiple times. */
export async function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (redis.status === 'ready' || redis.status === 'connecting') {
    return;
  }
  await redis.connect();
  log.info('redis connection established');
}

/** Gracefully close the shared Redis connection and dispose the singleton. */
export async function disconnectRedis(): Promise<void> {
  if (client !== undefined) {
    try {
      await client.quit();
    } catch (error) {
      log.warn({ err: error }, 'error during redis quit; forcing disconnect');
      client.disconnect();
    }
    client = undefined;
    log.info('redis connection closed');
  }
}

/** Liveness probe. Returns true when Redis answers PING. Never throws. */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const redis = getRedis();
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    log.error({ err: error }, 'redis health check failed');
    return false;
  }
}
