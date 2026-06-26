import type { OAuthState, Prisma, PrismaClient } from '@prisma/client';
import { getPrisma } from '../database/prisma';

/** Result of attempting to consume a state value during the OAuth callback. */
export interface ConsumedState {
  payload: Prisma.JsonValue;
}

/**
 * Persistence for short-lived, single-use OAuth state values used for CSRF
 * protection during the Slack install flow. A state may be consumed at most
 * once and only before it expires.
 */
export class OAuthStateRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Persist a freshly-issued state value with its signed install payload. */
  async create(
    state: string,
    payload: Prisma.InputJsonValue,
    expiresAt: Date,
  ): Promise<OAuthState> {
    return this.prisma.oAuthState.create({
      data: { state, payload, expiresAt },
    });
  }

  /**
   * Atomically consume a state value. Returns the stored payload when the state
   * exists, is unexpired, and was previously unconsumed; otherwise null. The
   * conditional update guarantees a state can be redeemed exactly once even
   * under concurrent callbacks.
   */
  async consume(state: string): Promise<ConsumedState | null> {
    const now = new Date();
    const claimed = await this.prisma.oAuthState.updateMany({
      where: { state, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count === 0) {
      return null;
    }
    const row = await this.prisma.oAuthState.findUnique({ where: { state } });
    if (row === null) {
      return null;
    }
    return { payload: row.payload };
  }

  /** Delete expired/consumed state rows; returns the number removed. */
  async pruneExpired(now: Date = new Date()): Promise<number> {
    const deleted = await this.prisma.oAuthState.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return deleted.count;
  }
}

/** Process-wide OAuth state repository bound to the shared Prisma client. */
export const oauthStateRepository = new OAuthStateRepository();
