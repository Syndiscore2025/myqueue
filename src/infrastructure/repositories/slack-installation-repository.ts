import { type PrismaClient, type SlackInstallation } from '@prisma/client';
import { getPrisma } from '../database/prisma';
import { tokenService, type TokenService } from '../crypto';

/**
 * Plaintext installation data captured from a completed OAuth exchange. Tokens
 * are provided in the clear here and encrypted by the repository before they
 * ever reach the database — callers must never persist tokens themselves.
 */
export interface SlackInstallationInput {
  workspaceId: string;
  appId?: string | null;
  authVersion?: string;
  tokenType?: string | null;
  isEnterpriseInstall?: boolean;
  enterpriseUrl?: string | null;

  botId?: string | null;
  botUserId?: string | null;
  botScopes?: string[];
  botToken?: string | null;
  botRefreshToken?: string | null;
  botTokenExpiresAt?: Date | null;

  installerUserId?: string | null;
  userScopes?: string[];
  userToken?: string | null;
  userRefreshToken?: string | null;
  userTokenExpiresAt?: Date | null;
}

/**
 * Persistence for encrypted Slack installations. There is exactly one
 * installation per workspace; reinstalling refreshes the existing row and
 * clears any prior revocation.
 */
export class SlackInstallationRepository {
  constructor(
    private readonly prisma: PrismaClient = getPrisma(),
    private readonly tokens: TokenService = tokenService,
  ) {}

  /** Create or refresh the installation for a workspace, encrypting tokens. */
  async upsert(input: SlackInstallationInput): Promise<SlackInstallation> {
    const data = {
      appId: input.appId ?? null,
      authVersion: input.authVersion ?? 'v2',
      tokenType: input.tokenType ?? null,
      isEnterpriseInstall: input.isEnterpriseInstall ?? false,
      enterpriseUrl: input.enterpriseUrl ?? null,

      botId: input.botId ?? null,
      botUserId: input.botUserId ?? null,
      botScopes: input.botScopes ?? [],
      botTokenCiphertext: this.tokens.encryptOptional(input.botToken),
      botRefreshTokenCiphertext: this.tokens.encryptOptional(input.botRefreshToken),
      botTokenExpiresAt: input.botTokenExpiresAt ?? null,

      installerUserId: input.installerUserId ?? null,
      userScopes: input.userScopes ?? [],
      userTokenCiphertext: this.tokens.encryptOptional(input.userToken),
      userRefreshTokenCiphertext: this.tokens.encryptOptional(input.userRefreshToken),
      userTokenExpiresAt: input.userTokenExpiresAt ?? null,

      revokedAt: null,
    };

    return this.prisma.slackInstallation.upsert({
      where: { workspaceId: input.workspaceId },
      create: { workspaceId: input.workspaceId, ...data },
      update: data,
    });
  }

  /** Fetch the raw (still-encrypted) installation row for a workspace. */
  async findByWorkspace(workspaceId: string): Promise<SlackInstallation | null> {
    return this.prisma.slackInstallation.findUnique({ where: { workspaceId } });
  }

  /** Decrypt the bot token for a workspace, or null if none is stored. */
  async getBotToken(workspaceId: string): Promise<string | null> {
    const row = await this.findByWorkspace(workspaceId);
    if (row === null) {
      return null;
    }
    return this.tokens.decryptOptional(row.botTokenCiphertext);
  }

  /** Decrypt the installer user token for a workspace, or null if none. */
  async getUserToken(workspaceId: string): Promise<string | null> {
    const row = await this.findByWorkspace(workspaceId);
    if (row === null) {
      return null;
    }
    return this.tokens.decryptOptional(row.userTokenCiphertext);
  }

  /**
   * Revoke a workspace's installation: stamp the revocation time and wipe all
   * token ciphertext so no usable credentials remain at rest.
   */
  async revoke(workspaceId: string): Promise<void> {
    await this.prisma.slackInstallation.updateMany({
      where: { workspaceId },
      data: {
        revokedAt: new Date(),
        botTokenCiphertext: null,
        botRefreshTokenCiphertext: null,
        userTokenCiphertext: null,
        userRefreshTokenCiphertext: null,
      },
    });
  }
}

/** Process-wide installation repository bound to the shared Prisma client. */
export const slackInstallationRepository = new SlackInstallationRepository();
