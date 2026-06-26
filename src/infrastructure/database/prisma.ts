import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('prisma');

/**
 * Singleton Prisma client.
 *
 * A single instance is shared across the process to avoid exhausting the
 * database connection pool. The client is created lazily so that importing this
 * module never opens a connection on its own.
 */
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (client === undefined) {
    client = new PrismaClient({
      datasources: { db: { url: env.DATABASE_URL } },
      log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }
  return client;
}

/** Establish the database connection. Safe to call multiple times. */
export async function connectDatabase(): Promise<void> {
  await getPrisma().$connect();
  log.info('database connection established');
}

/** Close the database connection and dispose the singleton. */
export async function disconnectDatabase(): Promise<void> {
  if (client !== undefined) {
    await client.$disconnect();
    client = undefined;
    log.info('database connection closed');
  }
}

/**
 * Lightweight liveness probe. Returns true when the database answers a trivial
 * query, false otherwise. Never throws.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.error({ err: error }, 'database health check failed');
    return false;
  }
}
