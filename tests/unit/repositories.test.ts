import type { PrismaClient } from '@prisma/client';
import { TokenService } from '../../src/infrastructure/crypto/token-service';
import { WorkspaceRepository } from '../../src/infrastructure/repositories/workspace-repository';
import { SlackInstallationRepository } from '../../src/infrastructure/repositories/slack-installation-repository';
import { OAuthStateRepository } from '../../src/infrastructure/repositories/oauth-state-repository';
import { WorkspaceAuditLogRepository } from '../../src/infrastructure/repositories/workspace-audit-log-repository';
import {
  QueueItemRepository,
  formatPermanentQueueId,
} from '../../src/infrastructure/repositories/queue-item-repository';
import { WorkspaceQueueSettingsRepository } from '../../src/infrastructure/repositories/workspace-queue-settings-repository';
import { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';
import { QueueHistoryRepository } from '../../src/infrastructure/repositories/queue-history-repository';
import { QueueEventType, QueuePriority, QueueStatus } from '../../src/domain/queue';

const KEY = 'a'.repeat(64);

type Fn = jest.Mock;

interface PrismaMock {
  workspace: { upsert: Fn; findUnique: Fn; update: Fn };
  workspaceSettings: { upsert: Fn };
  workspaceUser: { upsert: Fn };
  slackInstallation: { upsert: Fn; findUnique: Fn; updateMany: Fn };
  oAuthState: { create: Fn; updateMany: Fn; findUnique: Fn; deleteMany: Fn };
  workspaceAuditLog: { create: Fn; findMany: Fn };
  workspaceQueueSettings: { upsert: Fn; findUnique: Fn };
  queueItem: { create: Fn; findFirst: Fn; findUnique: Fn; findMany: Fn; updateMany: Fn };
  queueEvent: { create: Fn; findMany: Fn };
  queueStatusHistory: { create: Fn; findMany: Fn };
  queuePriorityHistory: { create: Fn; findMany: Fn };
  queueAssignment: { create: Fn; findMany: Fn };
  $transaction: Fn;
}

/** Build a Prisma mock whose model delegates are jest mock functions. */
function mockPrisma(): PrismaMock {
  const mock: PrismaMock = {
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
    workspaceQueueSettings: { upsert: jest.fn(), findUnique: jest.fn() },
    queueItem: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    queueEvent: { create: jest.fn(), findMany: jest.fn() },
    queueStatusHistory: { create: jest.fn(), findMany: jest.fn() },
    queuePriorityHistory: { create: jest.fn(), findMany: jest.fn() },
    queueAssignment: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  // By default run a transaction callback against the mock itself (tx === prisma).
  mock.$transaction.mockImplementation((cb: (tx: PrismaMock) => unknown) => cb(mock));
  return mock;
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

describe('formatPermanentQueueId', () => {
  it('zero-pads the sequence to six digits with an MQ- prefix', () => {
    expect(formatPermanentQueueId(1)).toBe('MQ-000001');
    expect(formatPermanentQueueId(842)).toBe('MQ-000842');
  });

  it('does not truncate sequences beyond six digits', () => {
    expect(formatPermanentQueueId(1234567)).toBe('MQ-1234567');
  });
});

describe('QueueItemRepository', () => {
  it('mints a permanent id atomically by incrementing the workspace counter', async () => {
    const prisma = mockPrisma();
    prisma.workspaceQueueSettings.upsert.mockResolvedValue({ lastQueueSeq: 7 });
    prisma.queueItem.create.mockResolvedValue({ id: 'q1', permanentQueueId: 'MQ-000007' });
    const repo = new QueueItemRepository(prisma as unknown as PrismaClient);

    await repo.create({ workspaceId: 'w1', ownerWorkspaceUserId: 'u1', title: 'Fix bug' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const upsertArgs = prisma.workspaceQueueSettings.upsert.mock.calls[0]![0];
    expect(upsertArgs.where).toEqual({ workspaceId: 'w1' });
    expect(upsertArgs.update).toEqual({ lastQueueSeq: { increment: 1 } });
    const data = prisma.queueItem.create.mock.calls[0]![0].data;
    expect(data.permanentQueueId).toBe('MQ-000007');
    expect(data.workspaceId).toBe('w1');
    expect(data.status).toBe(QueueStatus.New);
    expect(data.priority).toBe(QueuePriority.Green);
  });

  it('scopes findById by workspace to enforce tenant isolation', async () => {
    const prisma = mockPrisma();
    prisma.queueItem.findFirst.mockResolvedValue({ id: 'q1' });
    const repo = new QueueItemRepository(prisma as unknown as PrismaClient);
    await repo.findById('w1', 'q1');
    expect(prisma.queueItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'q1', workspaceId: 'w1' },
    });
  });

  it('resolves an item by permanent id using the composite unique key', async () => {
    const prisma = mockPrisma();
    prisma.queueItem.findUnique.mockResolvedValue({ id: 'q1' });
    const repo = new QueueItemRepository(prisma as unknown as PrismaClient);
    await repo.findByPermanentId('w1', 'MQ-000007');
    expect(prisma.queueItem.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_permanentQueueId: { workspaceId: 'w1', permanentQueueId: 'MQ-000007' } },
    });
  });

  it('filters listByOwner by status when statuses are provided', async () => {
    const prisma = mockPrisma();
    prisma.queueItem.findMany.mockResolvedValue([]);
    const repo = new QueueItemRepository(prisma as unknown as PrismaClient);
    await repo.listByOwner('w1', 'u1', { statuses: [QueueStatus.New, QueueStatus.Working] });
    const args = prisma.queueItem.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({
      workspaceId: 'w1',
      ownerWorkspaceUserId: 'u1',
      status: { in: [QueueStatus.New, QueueStatus.Working] },
    });
  });

  it('returns null from updateScoped when no item matches the workspace', async () => {
    const prisma = mockPrisma();
    prisma.queueItem.updateMany.mockResolvedValue({ count: 0 });
    const repo = new QueueItemRepository(prisma as unknown as PrismaClient);
    await expect(repo.updateScoped('w1', 'missing', { title: 'x' })).resolves.toBeNull();
    expect(prisma.queueItem.findFirst).not.toHaveBeenCalled();
  });
});

describe('WorkspaceQueueSettingsRepository', () => {
  it('only writes fields that were explicitly provided', async () => {
    const prisma = mockPrisma();
    prisma.workspaceQueueSettings.upsert.mockResolvedValue({ id: 's1' });
    const repo = new WorkspaceQueueSettingsRepository(prisma as unknown as PrismaClient);
    await repo.update('w1', { includeWaitingInActive: true });
    const args = prisma.workspaceQueueSettings.upsert.mock.calls[0]![0];
    expect(args.where).toEqual({ workspaceId: 'w1' });
    expect(args.update).toEqual({ includeWaitingInActive: true });
    expect(args.update).not.toHaveProperty('rankingMode');
  });
});

describe('QueueEventRepository', () => {
  it('records a queue-wide event with null item and defaults', async () => {
    const prisma = mockPrisma();
    prisma.queueEvent.create.mockResolvedValue({ id: 'e1' });
    const repo = new QueueEventRepository(prisma as unknown as PrismaClient);
    await repo.record({ workspaceId: 'w1', eventType: QueueEventType.RECALCULATED });
    const data = prisma.queueEvent.create.mock.calls[0]![0].data;
    expect(data.workspaceId).toBe('w1');
    expect(data.queueItemId).toBeNull();
    expect(data.actorWorkspaceUserId).toBeNull();
    expect(data).not.toHaveProperty('metadata');
  });

  it('scopes listForItem by workspace and item', async () => {
    const prisma = mockPrisma();
    prisma.queueEvent.findMany.mockResolvedValue([]);
    const repo = new QueueEventRepository(prisma as unknown as PrismaClient);
    await repo.listForItem('w1', 'q1');
    expect(prisma.queueEvent.findMany.mock.calls[0]![0].where).toEqual({
      workspaceId: 'w1',
      queueItemId: 'q1',
    });
  });
});

describe('QueueHistoryRepository', () => {
  it('records a status change with a null from-status on creation', async () => {
    const prisma = mockPrisma();
    prisma.queueStatusHistory.create.mockResolvedValue({ id: 'h1' });
    const repo = new QueueHistoryRepository(prisma as unknown as PrismaClient);
    await repo.recordStatusChange({
      workspaceId: 'w1',
      queueItemId: 'q1',
      toStatus: QueueStatus.New,
    });
    const data = prisma.queueStatusHistory.create.mock.calls[0]![0].data;
    expect(data.fromStatus).toBeNull();
    expect(data.toStatus).toBe(QueueStatus.New);
    expect(data.workspaceId).toBe('w1');
  });

  it('defaults a priority change to non-automatic', async () => {
    const prisma = mockPrisma();
    prisma.queuePriorityHistory.create.mockResolvedValue({ id: 'h2' });
    const repo = new QueueHistoryRepository(prisma as unknown as PrismaClient);
    await repo.recordPriorityChange({
      workspaceId: 'w1',
      queueItemId: 'q1',
      toPriority: QueuePriority.Red,
      source: 'manual',
    });
    const data = prisma.queuePriorityHistory.create.mock.calls[0]![0].data;
    expect(data.automatic).toBe(false);
    expect(data.toPriority).toBe(QueuePriority.Red);
  });

  it('records an assignment scoped to the workspace', async () => {
    const prisma = mockPrisma();
    prisma.queueAssignment.create.mockResolvedValue({ id: 'h3' });
    const repo = new QueueHistoryRepository(prisma as unknown as PrismaClient);
    await repo.recordAssignment({
      workspaceId: 'w1',
      queueItemId: 'q1',
      ownerWorkspaceUserId: 'u2',
    });
    const data = prisma.queueAssignment.create.mock.calls[0]![0].data;
    expect(data.workspaceId).toBe('w1');
    expect(data.ownerWorkspaceUserId).toBe('u2');
    expect(data.previousOwnerWorkspaceUserId).toBeNull();
  });
});
