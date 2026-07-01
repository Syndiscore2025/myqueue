import type { QueueItem } from '@prisma/client';
import { env } from '../../src/config';
import { QueueClaimService, type QueueClaimServiceDeps } from '../../src/application/queue';
import { ConflictError, NotFoundError } from '../../src/domain/errors';
import {
  QueueEventType,
  QueuePriority,
  QueueRankingMode,
  QueueStatus,
} from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';
import type { WorkspaceQueueSettingsRepository } from '../../src/infrastructure/repositories/workspace-queue-settings-repository';
import type { WorkerRegistryRepository } from '../../src/infrastructure/repositories/worker-registry-repository';

const ctx = { workspaceId: 'w1', workerId: 'worker-1' };

interface Mocks {
  items: {
    claimNext: jest.Mock;
    extendLease: jest.Mock;
    findByPermanentId: jest.Mock;
    completeProcessing: jest.Mock;
    releaseProcessing: jest.Mock;
    failProcessing: jest.Mock;
    updateScoped: jest.Mock;
  };
  events: { record: jest.Mock };
  settings: { ensure: jest.Mock };
  publisher: { publish: jest.Mock };
  registry: { register: jest.Mock };
  dependencies: { findResolvableDependents: jest.Mock };
}

/** Fresh mock collaborators plus a QueueClaimService wired to them. */
function build(rankingMode: QueueRankingMode = QueueRankingMode.PRIORITY): {
  svc: QueueClaimService;
  m: Mocks;
} {
  const m: Mocks = {
    items: {
      claimNext: jest.fn(),
      extendLease: jest.fn(),
      findByPermanentId: jest.fn(),
      completeProcessing: jest.fn(),
      releaseProcessing: jest.fn(),
      failProcessing: jest.fn(),
      updateScoped: jest.fn().mockResolvedValue({}),
    },
    events: { record: jest.fn() },
    settings: { ensure: jest.fn() },
    publisher: { publish: jest.fn() },
    registry: { register: jest.fn() },
    dependencies: {
      findResolvableDependents: jest.fn().mockResolvedValue({ toUnblock: [], toDeadLetter: [] }),
    },
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
    registry: m.registry as unknown as WorkerRegistryRepository,
    dependencies: m.dependencies as never,
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
    sourceSlackUserId: null,
    sourceSlackMessageTs: null,
    sourceSlackThreadTs: null,
    sourceSlackPermalink: null,
    sourceSlackMessageCount: 1,
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

  it('auto-registers the worker even when the queue is empty', async () => {
    const { svc, m } = build();
    m.items.claimNext.mockResolvedValue(null);

    await svc.claim(ctx);

    expect(m.registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', workerId: 'worker-1' }),
    );
  });
});

describe('QueueClaimService.heartbeat', () => {
  it('extends the lease and emits no audit or processing event', async () => {
    const { svc, m } = build();
    const item = makeItem();
    m.items.extendLease.mockResolvedValue(item);

    const result = await svc.heartbeat(ctx, 'MQ-000001');

    expect(result).toBe(item);
    const args = m.items.extendLease.mock.calls[0]![0];
    expect(args.workspaceId).toBe('w1');
    expect(args.workerId).toBe('worker-1');
    expect(args.permanentQueueId).toBe('MQ-000001');
    expect(args.heartbeatAt).toBeInstanceOf(Date);
    expect(args.lockExpiresAt.getTime() - args.heartbeatAt.getTime()).toBe(
      env.QUEUE_LOCK_MINUTES * 60_000,
    );
    expect(m.events.record).not.toHaveBeenCalled();
    expect(m.publisher.publish).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the item does not exist in the workspace', async () => {
    const { svc, m } = build();
    m.items.extendLease.mockResolvedValue(null);
    m.items.findByPermanentId.mockResolvedValue(null);

    await expect(svc.heartbeat(ctx, 'MQ-000001')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when the item is no longer leased by this worker', async () => {
    const { svc, m } = build();
    m.items.extendLease.mockResolvedValue(null);
    m.items.findByPermanentId.mockResolvedValue(makeItem({ claimedByWorkerId: 'other' }));

    await expect(svc.heartbeat(ctx, 'MQ-000001')).rejects.toBeInstanceOf(ConflictError);
  });

  it('auto-registers (refreshes) the worker on heartbeat', async () => {
    const { svc, m } = build();
    m.items.extendLease.mockResolvedValue(makeItem());

    await svc.heartbeat(ctx, 'MQ-000001');

    expect(m.registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', workerId: 'worker-1' }),
    );
  });
});

describe('QueueClaimService.complete', () => {
  it('completes the item and records a COMPLETED event + publishes QueueItemCompleted', async () => {
    const { svc, m } = build();
    const doneItem = makeItem({ status: QueueStatus.Done });
    m.items.findByPermanentId.mockResolvedValue(makeItem());
    m.items.completeProcessing.mockResolvedValue(doneItem);

    const result = await svc.complete(ctx, 'MQ-000001');

    expect(result.status).toBe(QueueStatus.Done);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.COMPLETED }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QueueItemCompleted', workerId: 'worker-1' }),
    );
  });

  it('throws NotFoundError when the item does not exist', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(null);
    await expect(svc.complete(ctx, 'MQ-000001')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('QueueClaimService.release', () => {
  it('releases the item back to New and records RELEASED event + publishes QueueItemReleased', async () => {
    const { svc, m } = build();
    const releasedItem = makeItem({ status: QueueStatus.New });
    m.items.findByPermanentId.mockResolvedValue(makeItem());
    m.items.releaseProcessing.mockResolvedValue(releasedItem);

    const result = await svc.release(ctx, 'MQ-000001');

    expect(result.status).toBe(QueueStatus.New);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.RELEASED }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QueueItemReleased', workerId: 'worker-1' }),
    );
  });

  it('throws ConflictError when the item is not leased by this worker', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ claimedByWorkerId: 'other' }));
    await expect(svc.release(ctx, 'MQ-000001')).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('QueueClaimService.fail', () => {
  it('requeues on failure when retries remain (records FAILED + RETRY_SCHEDULED)', async () => {
    const { svc, m } = build();
    const requeuedItem = makeItem({ status: QueueStatus.New, attemptCount: 1 });
    m.items.findByPermanentId.mockResolvedValue(makeItem({ attemptCount: 0 }));
    m.items.failProcessing.mockResolvedValue(requeuedItem);

    await svc.fail(ctx, 'MQ-000001', { error: 'timeout' });

    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.FAILED }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.RETRY_SCHEDULED }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QueueItemFailed', attemptCount: 1 }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RetryScheduled', attemptCount: 1 }),
    );
  });

  it('moves to DeadLetter when retry budget is exhausted (records FAILED + DEAD_LETTERED)', async () => {
    const { svc, m } = build();
    const env_ = await import('../../src/config');
    const maxRetries = env_.env.QUEUE_MAX_RETRIES;
    const dlqItem = makeItem({ status: QueueStatus.DeadLetter, attemptCount: maxRetries });
    m.items.findByPermanentId.mockResolvedValue(makeItem({ attemptCount: maxRetries - 1 }));
    m.items.failProcessing.mockResolvedValue(dlqItem);

    await svc.fail(ctx, 'MQ-000001');

    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.DEAD_LETTERED }),
    );
    expect(m.publisher.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RetryScheduled' }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'QueueItemFailed' }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DeadLetterCreated', attemptCount: maxRetries }),
    );
  });

  it('throws NotFoundError when the item does not exist', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(null);
    await expect(svc.fail(ctx, 'MQ-000001')).rejects.toBeInstanceOf(NotFoundError);
  });
});
