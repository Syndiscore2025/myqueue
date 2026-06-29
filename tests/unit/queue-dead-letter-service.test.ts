import type { QueueItem } from '@prisma/client';
import { QueueDeadLetterService } from '../../src/application/queue';
import { ConflictError, NotFoundError } from '../../src/domain/errors';
import { QueueEventType, QueuePriority, QueueStatus } from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';

const ctx = { workspaceId: 'w1', workspaceUserId: 'u1' };

interface Mocks {
  items: {
    findByPermanentId: jest.Mock;
    listDeadLetter: jest.Mock;
    requeueFromDeadLetter: jest.Mock;
  };
  events: { record: jest.Mock };
}

function build(): { svc: QueueDeadLetterService; m: Mocks } {
  const m: Mocks = {
    items: {
      findByPermanentId: jest.fn(),
      listDeadLetter: jest.fn(),
      requeueFromDeadLetter: jest.fn(),
    },
    events: { record: jest.fn() },
  };
  const svc = new QueueDeadLetterService({
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
  });
  return { svc, m };
}

/** A QueueItem fixture with sensible defaults, overridable per test. */
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
    sourceSlackUserId: null,
    sourceSlackMessageTs: null,
    sourceSlackThreadTs: null,
    sourceSlackPermalink: null,
    title: 'Title',
    summary: null,
    status: QueueStatus.DeadLetter,
    priority: QueuePriority.Green,
    rankingTimestamp: now,
    snoozedUntil: null,
    followUpDueAt: null,
    assignedAt: null,
    completedAt: null,
    archivedAt: null,
    claimedByWorkerId: null,
    claimedAt: null,
    heartbeatAt: null,
    lockExpiresAt: null,
    attemptCount: 3,
    processingStartedAt: null,
    processingCompletedAt: null,
    lastError: 'boom',
    lastErrorStack: null,
    failedAt: now,
    deadLetteredAt: now,
    // Phase 3C scheduling fields
    availableAt: null,
    scheduledFor: null,
    delayUntil: null,
    blockedUntil: null,
    activationReason: null,
    recurrenceRuleId: null,
    parentRecurringItemId: null,
    rateLimitKey: null,
    partitionKey: null,
    dependencyGroupId: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('QueueDeadLetterService.list', () => {
  it('returns the workspace dead-lettered items', async () => {
    const { svc, m } = build();
    const items = [makeItem()];
    m.items.listDeadLetter.mockResolvedValue(items);

    const result = await svc.list(ctx);

    expect(result).toBe(items);
    expect(m.items.listDeadLetter).toHaveBeenCalledWith('w1');
  });
});

describe('QueueDeadLetterService.requeue', () => {
  it('requeues a dead-lettered item and records a REQUEUED event', async () => {
    const { svc, m } = build();
    const requeued = makeItem({ status: QueueStatus.New, attemptCount: 0 });
    m.items.findByPermanentId.mockResolvedValue(makeItem({ attemptCount: 3 }));
    m.items.requeueFromDeadLetter.mockResolvedValue(requeued);

    const result = await svc.requeue(ctx, 'MQ-000001');

    expect(result.status).toBe(QueueStatus.New);
    expect(m.items.requeueFromDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', permanentQueueId: 'MQ-000001' }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: QueueEventType.REQUEUED,
        actorWorkspaceUserId: 'u1',
        previousValue: QueueStatus.DeadLetter,
        newValue: QueueStatus.New,
      }),
    );
  });

  it('throws NotFoundError when the item does not exist', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(null);
    await expect(svc.requeue(ctx, 'MQ-000001')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when the item is not in the Dead Letter Queue', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ status: QueueStatus.New }));
    await expect(svc.requeue(ctx, 'MQ-000001')).rejects.toBeInstanceOf(ConflictError);
    expect(m.items.requeueFromDeadLetter).not.toHaveBeenCalled();
  });
});
