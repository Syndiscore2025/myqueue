import type { Installation, InstallationQuery, InstallationStore } from '@slack/bolt';
import { tokenService, type TokenService } from '../crypto';
import {
  slackInstallationRepository,
  workspaceAuditLogRepository,
  workspaceRepository,
  type SlackInstallationRepository,
  type WorkspaceAuditLogRepository,
  type WorkspaceRepository,
} from '../repositories';

/** Convert a millisecond epoch (Slack token expiry) to a Date, or null. */
function toDate(ms: number | undefined): Date | null {
  return ms === undefined ? null : new Date(ms);
}

/**
 * Bolt-compatible {@link InstallationStore} backed by the multi-tenant Prisma
 * schema. Every installation is persisted as a Workspace plus an encrypted
 * SlackInstallation; tokens are encrypted by the repository layer and never
 * touch the database in plaintext. All reads/writes are scoped to a workspace.
 */
export class PrismaInstallationStore implements InstallationStore {
  constructor(
    private readonly workspaces: WorkspaceRepository = workspaceRepository,
    private readonly installations: SlackInstallationRepository = slackInstallationRepository,
    private readonly audit: WorkspaceAuditLogRepository = workspaceAuditLogRepository,
    private readonly tokens: TokenService = tokenService,
  ) {}

  async storeInstallation<AuthVersion extends 'v1' | 'v2'>(
    installation: Installation<AuthVersion, boolean>,
  ): Promise<void> {
    const { team, enterprise, bot, user } = installation;
    const isEnterpriseInstall = installation.isEnterpriseInstall ?? false;

    const workspace = await this.workspaces.upsert({
      slackTeamId: team?.id ?? null,
      slackTeamName: team?.name ?? null,
      slackEnterpriseId: enterprise?.id ?? null,
      slackEnterpriseName: enterprise?.name ?? null,
      isEnterpriseInstall,
    });

    const existing = await this.installations.findByWorkspace(workspace.id);

    await this.installations.upsert({
      workspaceId: workspace.id,
      appId: installation.appId ?? null,
      authVersion: installation.authVersion ?? 'v2',
      tokenType: installation.tokenType ?? null,
      isEnterpriseInstall,
      enterpriseUrl: installation.enterpriseUrl ?? null,
      botId: bot?.id ?? null,
      botUserId: bot?.userId ?? null,
      botScopes: bot?.scopes ?? [],
      botToken: bot?.token ?? null,
      botRefreshToken: bot?.refreshToken ?? null,
      botTokenExpiresAt: toDate(bot?.expiresAt),
      installerUserId: user.id,
      userScopes: user.scopes ?? [],
      userToken: user.token ?? null,
      userRefreshToken: user.refreshToken ?? null,
      userTokenExpiresAt: toDate(user.expiresAt),
    });

    await this.workspaces.ensureSettings(workspace.id);
    await this.workspaces.upsertUser(workspace.id, { slackUserId: user.id, isInstaller: true });
    await this.audit.record({
      workspaceId: workspace.id,
      action: existing === null ? 'APP_INSTALLED' : 'APP_REINSTALLED',
      actorSlackUserId: user.id,
    });
  }

  async fetchInstallation(
    query: InstallationQuery<boolean>,
  ): Promise<Installation<'v1' | 'v2', boolean>> {
    const workspace = await this.workspaces.findByTenant({
      teamId: query.teamId ?? null,
      enterpriseId: query.enterpriseId ?? null,
      isEnterpriseInstall: query.isEnterpriseInstall,
    });
    if (workspace === null) {
      throw new Error('No Slack installation found for the requested tenant');
    }

    const row = await this.installations.findByWorkspace(workspace.id);
    if (row === null || row.revokedAt !== null) {
      throw new Error('Slack installation has been revoked or does not exist');
    }

    const userRefresh = this.tokens.decryptOptional(row.userRefreshTokenCiphertext);
    const installation: Installation<'v1' | 'v2', boolean> = {
      team: workspace.isEnterpriseInstall
        ? undefined
        : {
            id: workspace.slackTeamId ?? '',
            ...(workspace.slackTeamName !== null ? { name: workspace.slackTeamName } : {}),
          },
      enterprise:
        workspace.slackEnterpriseId === null
          ? undefined
          : {
              id: workspace.slackEnterpriseId,
              ...(workspace.slackEnterpriseName !== null
                ? { name: workspace.slackEnterpriseName }
                : {}),
            },
      user: {
        id: row.installerUserId ?? '',
        token: this.tokens.decryptOptional(row.userTokenCiphertext) ?? undefined,
        scopes: row.userScopes,
        ...(userRefresh !== null ? { refreshToken: userRefresh } : {}),
        ...(row.userTokenExpiresAt !== null ? { expiresAt: row.userTokenExpiresAt.getTime() } : {}),
      },
      isEnterpriseInstall: workspace.isEnterpriseInstall,
      authVersion: row.authVersion === 'v1' ? 'v1' : 'v2',
    };

    if (row.appId !== null) {
      installation.appId = row.appId;
    }
    if (row.enterpriseUrl !== null) {
      installation.enterpriseUrl = row.enterpriseUrl;
    }
    if (row.tokenType === 'bot') {
      installation.tokenType = 'bot';
    }

    const botToken = this.tokens.decryptOptional(row.botTokenCiphertext);
    const botRefresh = this.tokens.decryptOptional(row.botRefreshTokenCiphertext);
    if (row.botId !== null && botToken !== null) {
      installation.bot = {
        id: row.botId,
        userId: row.botUserId ?? '',
        token: botToken,
        scopes: row.botScopes,
        ...(botRefresh !== null ? { refreshToken: botRefresh } : {}),
        ...(row.botTokenExpiresAt !== null ? { expiresAt: row.botTokenExpiresAt.getTime() } : {}),
      };
    }

    return installation;
  }

  async deleteInstallation(query: InstallationQuery<boolean>): Promise<void> {
    const workspace = await this.workspaces.findByTenant({
      teamId: query.teamId ?? null,
      enterpriseId: query.enterpriseId ?? null,
      isEnterpriseInstall: query.isEnterpriseInstall,
    });
    if (workspace === null) {
      return;
    }
    await this.installations.revoke(workspace.id);
    await this.workspaces.markUninstalled(workspace.id);
    await this.audit.record({ workspaceId: workspace.id, action: 'APP_UNINSTALLED' });
  }
}

/** Process-wide installation store bound to the shared repositories. */
export const prismaInstallationStore = new PrismaInstallationStore();
