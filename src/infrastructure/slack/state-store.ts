import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { InstallURLOptions, StateStore } from '@slack/bolt';
import { oauthStateRepository, type OAuthStateRepository } from '../repositories';

/** Default lifetime of an issued OAuth state value (10 minutes). */
const DEFAULT_EXPIRATION_SECONDS = 600;
const STATE_BYTES = 32;

/**
 * Database-backed {@link StateStore} for the Slack install flow. Each issued
 * state value is cryptographically random, single-use, and short-lived: the
 * signed install options are persisted alongside it and returned exactly once
 * on a successful, unexpired verification. This protects the OAuth callback
 * against CSRF and replay attacks without relying on client-side cookies.
 */
export class PrismaStateStore implements StateStore {
  constructor(
    private readonly states: OAuthStateRepository = oauthStateRepository,
    private readonly expirationSeconds: number = DEFAULT_EXPIRATION_SECONDS,
  ) {}

  async generateStateParam(installOptions: InstallURLOptions, now: Date): Promise<string> {
    const state = randomBytes(STATE_BYTES).toString('hex');
    const expiresAt = new Date(now.getTime() + this.expirationSeconds * 1000);
    await this.states.create(state, installOptions as unknown as Prisma.InputJsonValue, expiresAt);
    return state;
  }

  async verifyStateParam(_now: Date, state: string): Promise<InstallURLOptions> {
    const consumed = await this.states.consume(state);
    if (consumed === null) {
      throw new Error('Invalid, expired, or already-used OAuth state parameter');
    }
    return consumed.payload as unknown as InstallURLOptions;
  }
}

/** Process-wide state store bound to the shared OAuth state repository. */
export const prismaStateStore = new PrismaStateStore();
