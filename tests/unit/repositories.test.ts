import type { PrismaClient } from '@prisma/client';
import { TokenService } from '../../src/infrastructure/crypto/token-service';
import { WorkspaceRepository } from '../../src/infrastructure/repositories/workspace-repository';
import { SlackInstallationRepository } from '../../src/infrastructure/repositories/slack-installation-repository';
import { OAuthStateRepository } from '../../src/infrastructure/repositories/oauth-state-repository';
import { WorkspaceAuditLogRepository } from '../../src/infrastructure/repositories/workspace-audit-log-repository';

const KEY = 'a'.repeat(64);

type Fn = jest.Mock;

interface PrismaMock {
  workspace: { upsert: Fn; findUnique: Fn; update: Fn };
  workspaceSettings: { upsert: Fn };
  workspaceUser: { upsert: Fn };
  slackInstallation: { upsert: Fn; findUnique: Fn; updateMany: Fn };
  oAuthState: { create: Fn; updateMany: Fn; findUnique: Fn; deleteMany: Fn };
  workspaceAuditLog: { create: Fn; findMany: Fn };
}

/** Build a Prisma mock whose model delegates are jest mock functions. */
function mockPrisma(): PrismaMock {
  return {
    workspace: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    workspaceSettings: { upsert: jest.fn() },
    workspaceUser: { upsert: jest.fn() },
    slackInstallation: { upsert: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    oAuthState: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    workspaceAuditLog: { create: jest.fn(), findMany: jest.fn() },
  };
}

describe('WorkspaceRepository', () => {
  it('upserts an enterprise install by enterprise id and reactivates it', async () => {
    const prisma = mockPrisma();
    prisma.workspace.upsert.mockResolvedValue({ id: 'w1' });
    const repo = new WorkspaceRepository(prisma as unknown as PrismaClient);

    await repo.upsert({
      slackTeamId: null,
      slackTeamName: null,
      slackEnterpriseId: 'E1',
      slackEnterpriseName: 'Acme',
      isEnterpriseInstall: true,
    });

    const args = prisma.workspace.upsert.mock.calls[0]![0];
    expect(args.where).toEqual({ slackEnterpriseId: 'E1' });
    expect(args.update.status).toBe('ACTIVE');
    expect(args.update.uninstalledAt).toBeNull();
  });

  it('upserts a team install by team id', async () => {
    const prisma = mockPrisma();
    prisma.workspace.upsert.mockResolvedValue({ id: 'w1' });
    const repo = new WorkspaceRepository(prisma as unknown as PrismaClient);

    await repo.upsert({
      slackTeamId: 'T1',
      slackTeamName: 'Team',
      slackEnterpriseId: null,
      slackEnterpriseName: null,
      isEnterpriseInstall: false,
    });

    expect(prisma.workspace.upsert.mock.calls[0]![0].where).toEqual({ slackTeamId: 'T1' });
  });

  it('throws when neither team nor enterprise id is present', async () => {
    const prisma = mockPrisma();
    const repo = new WorkspaceRepository(prisma as unknown as PrismaClient);
    await expect(
      repo.upsert({
        slackTeamId: null,
        slackTeamName: null,
        slackEnterpriseId: null,
        slackEnterpriseName: null,
        isEnterpriseInstall: false,
      }),
    ).rejects.toThrow(/team or enterprise id/);
  });

  it('resolves a tenant by team id', async () => {
    const prisma = mockPrisma();
    prisma.workspace.findUnique.mockResolvedValue({ id: 'w1' });
    const repo = new WorkspaceRepository(prisma as unknown as PrismaClient);
    await repo.findByTenant({ teamId: 'T1' });
    expect(prisma.workspace.findUnique).toHaveBeenCalledWith({ where: { slackTeamId: 'T1' } });
  });
});

describe('SlackInstallationRepository', () => {
  it('encrypts tokens before persisting and never stores plaintext', async () => {
    const prisma = mockPrisma();
    prisma.slackInstallation.upsert.mockResolvedValue({ id: 'i1' });
    const tokens = new TokenService(KEY);
    const repo = new SlackInstallationRepository(prisma as unknown as PrismaClient, tokens);

    await repo.upsert({ workspaceId: 'w1', botToken: 'xoxb-secret', botScopes: ['chat:write'] });

    const data = prisma.slackInstallation.upsert.mock.calls[0]![0].create;
    expect(data.botTokenCiphertext).not.toContain('xoxb-secret');
    expect(tokens.decrypt(data.botTokenCiphertext)).toBe('xoxb-secret');
    expect(data.revokedAt).toBeNull();
  });

  it('decrypts the stored bot token', async () => {
    const prisma = mockPrisma();
    const tokens = new TokenService(KEY);
    prisma.slackInstallation.findUnique.mockResolvedValue({
      botTokenCiphertext: tokens.encrypt('xoxb-secret'),
    });
    const repo = new SlackInstallationRepository(prisma as unknown as PrismaClient, tokens);
    await expect(repo.getBotToken('w1')).resolves.toBe('xoxb-secret');
  });

  it('wipes token ciphertext on revoke', async () => {
    const prisma = mockPrisma();
    prisma.slackInstallation.updateMany.mockResolvedValue({ count: 1 });
    const repo = new SlackInstallationRepository(
      prisma as unknown as PrismaClient,
      new TokenService(KEY),
    );
    await repo.revoke('w1');
    const data = prisma.slackInstallation.updateMany.mock.calls[0]![0].data;
    expect(data.botTokenCiphertext).toBeNull();
    expect(data.userTokenCiphertext).toBeNull();
    expect(data.revokedAt).toBeInstanceOf(Date);
  });
});

describe('OAuthStateRepository', () => {
  it('returns null when the state cannot be claimed', async () => {
    const prisma = mockPrisma();
    prisma.oAuthState.updateMany.mockResolvedValue({ count: 0 });
    const repo = new OAuthStateRepository(prisma as unknown as PrismaClient);
    await expect(repo.consume('s1')).resolves.toBeNull();
    expect(prisma.oAuthState.findUnique).not.toHaveBeenCalled();
  });

  it('returns the payload when the state is claimed', async () => {
    const prisma = mockPrisma();
    prisma.oAuthState.updateMany.mockResolvedValue({ count: 1 });
    prisma.oAuthState.findUnique.mockResolvedValue({ payload: { foo: 'bar' } });
    const repo = new OAuthStateRepository(prisma as unknown as PrismaClient);
    await expect(repo.consume('s1')).resolves.toEqual({ payload: { foo: 'bar' } });
  });
});

describe('WorkspaceAuditLogRepository', () => {
  it('omits metadata when none is provided', async () => {
    const prisma = mockPrisma();
    prisma.workspaceAuditLog.create.mockResolvedValue({ id: 'a1' });
    const repo = new WorkspaceAuditLogRepository(prisma as unknown as PrismaClient);
    await repo.record({ workspaceId: 'w1', action: 'APP_INSTALLED' });
    const data = prisma.workspaceAuditLog.create.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty('metadata');
    expect(data.actorSlackUserId).toBeNull();
  });
});
