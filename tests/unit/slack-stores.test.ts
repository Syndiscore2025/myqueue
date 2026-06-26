import type { Installation } from '@slack/bolt';
import { TokenService } from '../../src/infrastructure/crypto/token-service';
import { PrismaInstallationStore } from '../../src/infrastructure/slack/installation-store';
import { PrismaStateStore } from '../../src/infrastructure/slack/state-store';
import type { SlackInstallationRepository } from '../../src/infrastructure/repositories/slack-installation-repository';
import type { WorkspaceRepository } from '../../src/infrastructure/repositories/workspace-repository';
import type { WorkspaceAuditLogRepository } from '../../src/infrastructure/repositories/workspace-audit-log-repository';
import type { OAuthStateRepository } from '../../src/infrastructure/repositories/oauth-state-repository';

const KEY = 'a'.repeat(64);

function buildStore(existing: unknown = null): {
  store: PrismaInstallationStore;
  workspaces: {
    upsert: jest.Mock;
    findByTenant: jest.Mock;
    ensureSettings: jest.Mock;
    upsertUser: jest.Mock;
    markUninstalled: jest.Mock;
  };
  installations: { findByWorkspace: jest.Mock; upsert: jest.Mock; revoke: jest.Mock };
  audit: { record: jest.Mock };
  tokens: TokenService;
} {
  const tokens = new TokenService(KEY);
  const workspaces = {
    upsert: jest.fn().mockResolvedValue({ id: 'w1', isEnterpriseInstall: false }),
    findByTenant: jest.fn(),
    ensureSettings: jest.fn().mockResolvedValue({}),
    upsertUser: jest.fn().mockResolvedValue({}),
    markUninstalled: jest.fn().mockResolvedValue({}),
  };
  const installations = {
    findByWorkspace: jest.fn().mockResolvedValue(existing),
    upsert: jest.fn().mockResolvedValue({}),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const store = new PrismaInstallationStore(
    workspaces as unknown as WorkspaceRepository,
    installations as unknown as SlackInstallationRepository,
    audit as unknown as WorkspaceAuditLogRepository,
    tokens,
  );
  return { store, workspaces, installations, audit, tokens };
}

const installation = {
  team: { id: 'T1', name: 'Team' },
  enterprise: undefined,
  user: { id: 'U1', token: 'xoxp-user', scopes: ['identify'] },
  bot: { id: 'B1', userId: 'UB1', token: 'xoxb-bot', scopes: ['chat:write'], expiresAt: 1000 },
  appId: 'A1',
  tokenType: 'bot',
  isEnterpriseInstall: false,
  authVersion: 'v2',
} as Installation;

describe('PrismaInstallationStore', () => {
  it('persists workspace, installation, settings, user, and an install audit entry', async () => {
    const { store, workspaces, installations, audit } = buildStore(null);
    await store.storeInstallation(installation);

    expect(workspaces.upsert.mock.calls[0]![0].slackTeamId).toBe('T1');
    const data = installations.upsert.mock.calls[0]![0];
    expect(data.botToken).toBe('xoxb-bot');
    expect(data.userToken).toBe('xoxp-user');
    expect(data.botTokenExpiresAt).toEqual(new Date(1000));
    expect(workspaces.ensureSettings).toHaveBeenCalledWith('w1');
    expect(workspaces.upsertUser).toHaveBeenCalledWith('w1', {
      slackUserId: 'U1',
      isInstaller: true,
    });
    expect(audit.record.mock.calls[0]![0].action).toBe('APP_INSTALLED');
  });

  it('records a reinstall when an installation already exists', async () => {
    const { store, audit } = buildStore({ id: 'i1' });
    await store.storeInstallation(installation);
    expect(audit.record.mock.calls[0]![0].action).toBe('APP_REINSTALLED');
  });

  it('reconstructs an installation and decrypts tokens', async () => {
    const { store, workspaces, installations, tokens } = buildStore();
    workspaces.findByTenant.mockResolvedValue({
      id: 'w1',
      isEnterpriseInstall: false,
      slackTeamId: 'T1',
      slackTeamName: 'Team',
      slackEnterpriseId: null,
      slackEnterpriseName: null,
    });
    installations.findByWorkspace.mockResolvedValue({
      installerUserId: 'U1',
      userTokenCiphertext: tokens.encrypt('xoxp-user'),
      userRefreshTokenCiphertext: null,
      userTokenExpiresAt: null,
      userScopes: ['identify'],
      appId: 'A1',
      tokenType: 'bot',
      authVersion: 'v2',
      enterpriseUrl: null,
      botId: 'B1',
      botUserId: 'UB1',
      botTokenCiphertext: tokens.encrypt('xoxb-bot'),
      botRefreshTokenCiphertext: null,
      botTokenExpiresAt: new Date(2000),
      botScopes: ['chat:write'],
      revokedAt: null,
    });

    const result = await store.fetchInstallation({
      teamId: 'T1',
      isEnterpriseInstall: false,
    } as never);
    expect(result.bot?.token).toBe('xoxb-bot');
    expect(result.user.token).toBe('xoxp-user');
    expect(result.bot?.expiresAt).toBe(2000);
    expect(result.team?.id).toBe('T1');
  });

  it('throws when the installation is missing or revoked', async () => {
    const { store, workspaces, installations } = buildStore();
    workspaces.findByTenant.mockResolvedValue({ id: 'w1', isEnterpriseInstall: false });
    installations.findByWorkspace.mockResolvedValue({ revokedAt: new Date() });
    await expect(store.fetchInstallation({ teamId: 'T1' } as never)).rejects.toThrow(/revoked/);
  });

  it('revokes and marks the workspace uninstalled on delete', async () => {
    const { store, workspaces, installations, audit } = buildStore();
    workspaces.findByTenant.mockResolvedValue({ id: 'w1' });
    await store.deleteInstallation({ teamId: 'T1' } as never);
    expect(installations.revoke).toHaveBeenCalledWith('w1');
    expect(workspaces.markUninstalled).toHaveBeenCalledWith('w1');
    expect(audit.record.mock.calls[0]![0].action).toBe('APP_UNINSTALLED');
  });
});

describe('PrismaStateStore', () => {
  it('issues a random state and persists the install options with an expiry', async () => {
    const states = { create: jest.fn().mockResolvedValue({}), consume: jest.fn() };
    const store = new PrismaStateStore(states as unknown as OAuthStateRepository, 600);
    const now = new Date('2026-01-01T00:00:00Z');
    const state = await store.generateStateParam({ scopes: ['chat:write'] }, now);

    expect(state).toMatch(/^[0-9a-f]{64}$/);
    const args = states.create.mock.calls[0]!;
    expect(args[0]).toBe(state);
    expect((args[2] as Date).getTime()).toBe(now.getTime() + 600_000);
  });

  it('returns stored options when the state is valid, otherwise throws', async () => {
    const states = {
      create: jest.fn(),
      consume: jest
        .fn()
        .mockResolvedValueOnce({ payload: { scopes: ['chat:write'] } })
        .mockResolvedValueOnce(null),
    };
    const store = new PrismaStateStore(states as unknown as OAuthStateRepository);
    await expect(store.verifyStateParam(new Date(), 's1')).resolves.toEqual({
      scopes: ['chat:write'],
    });
    await expect(store.verifyStateParam(new Date(), 's2')).rejects.toThrow(/Invalid/);
  });
});
