import type { QueueItem } from '@prisma/client';
import { env } from '../../src/config';
import { QueueClaimService, type QueueClaimServiceDeps } from '../../src/application/queue';
import {
  QueueEventType,
  QueuePriority,
  QueueRankingMode,
  QueueStatus,
} from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';
import type { WorkspaceQueueSettingsRepository } from '../../src/infrastructure/repositories/workspace-queue-settings-repository';

const ctx = { workspaceId: 'w1', workerId: 'worker-1' };

interface Mocks {
  items: { claimNext: jest.Mock };
  events: { record: jest.Mock };
  settings: { ensure: jest.Mock };
  publisher: { publish: jest.Mock };
}

/** Fresh mock collaborators plus a QueueClaimService wired to them. */
function build(rankingMode: QueueRankingMode = QueueRankingMode.PRIORITY): {
  svc: QueueClaimService;
  m: Mocks;
} {
  const m: Mocks = {
    items: { claimNext: jest.fn() },
    events: { record: jest.fn() },
    settings: { ensure: jest.fn() },
    publisher: { publish: jest.fn() },
  };
  m.settings.ensure.mockResolvedValue({
    rankingMode,
    includeWorkingInActive: true,
    includeWaitingInActive: false,
  });
  const deps: QueueClaimServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
    settings: m.settings as unknown as WorkspaceQueueSettingsRepository,
    publisher: m.publisher,
  };
  return { svc: new QueueClaimService(deps), m };
}

/** A claimed QueueItem fixture with sensible defaults, overridable per test. */
function makeItem(over: Partial<QueueItem> = {}): QueueItem {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'i1',
    workspaceId: 'w1',
    permanentQueueId: 'MQ-000001',
    ownerWorkspaceUserId: 'u1',
    creatorWorkspaceUserId: 'u1',
    sourceType: 'MANUAL',
    sourceSlackChannelId: null,
    sourceSlackMessageTs: null,
    sourceSlackThreadTs: null,
    sourceSlackPermalink: null,
    title: 'Title',
    summary: null,
    status: QueueStatus.Processing,
    priority: QueuePriority.Green,
    rankingTimestamp: now,
    snoozedUntil: null,
    followUpDueAt: null,
    assignedAt: null,
    completedAt: null,
    archivedAt: null,
    claimedByWorkerId: 'worker-1',
    claimedAt: now,
    heartbeatAt: now,
    lockExpiresAt: new Date('2026-01-01T00:05:00Z'),
    attemptCount: 0,
    processingStartedAt: now,
    processingCompletedAt: null,
    lastError: null,
    lastErrorStack: null,
    failedAt: null,
    deadLetteredAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('QueueClaimService.claim', () => {
  it('atomically claims the next item and records a CLAIMED event', async () => {
    const { svc, m } = build();
    const item = makeItem();
    m.items.claimNext.mockResolvedValue(item);

    const result = await svc.claim(ctx);

    expect(result).toBe(item);
    const args = m.items.claimNext.mock.calls[0]![0];
    expect(args.workspaceId).toBe('w1');
    expect(args.workerId).toBe('worker-1');
    expect(args.rankingMode).toBe(QueueRankingMode.PRIORITY);
    expect(args.lockExpiresAt).toBeInstanceOf(Date);
    expect(args.lockExpiresAt.getTime() - args.now.getTime()).toBe(env.QUEUE_LOCK_MINUTES * 60_000);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        queueItemId: 'i1',
        eventType: QueueEventType.CLAIMED,
        previousValue: QueueStatus.New,
        newValue: QueueStatus.Processing,
        metadata: { workerId: 'worker-1' },
      }),
    );
  });

  it('publishes a QueueItemClaimed processing event', async () => {
    const { svc, m } = build();
    m.items.claimNext.mockResolvedValue(makeItem());

    await svc.claim(ctx);

    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'QueueItemClaimed',
        workspaceId: 'w1',
        queueItemId: 'i1',
        permanentQueueId: 'MQ-000001',
        workerId: 'worker-1',
      }),
    );
  });

  it('returns null and records nothing when the queue is empty', async () => {
    const { svc, m } = build();
    m.items.claimNext.mockResolvedValue(null);

    const result = await svc.claim(ctx);

    expect(result).toBeNull();
    expect(m.events.record).not.toHaveBeenCalled();
    expect(m.publisher.publish).not.toHaveBeenCalled();
  });

  it('passes the workspace ranking mode through to the repository', async () => {
    const { svc, m } = build(QueueRankingMode.FIFO);
    m.items.claimNext.mockResolvedValue(makeItem());

    await svc.claim(ctx);

    expect(m.items.claimNext.mock.calls[0]![0].rankingMode).toBe(QueueRankingMode.FIFO);
  });
});
