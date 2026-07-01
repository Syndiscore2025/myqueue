import type { QueueItem } from '@prisma/client';
import { QueueService, type QueueServiceDeps } from '../../src/application/queue';
import { NotFoundError } from '../../src/domain/errors';
import type { PriorityClassificationService } from '../../src/domain/queue';
import {
  InvalidQueueStatusTransitionError,
  QueueEventType,
  QueuePriority,
  QueueSourceType,
  QueueStatus,
} from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';
import type { QueueHistoryRepository } from '../../src/infrastructure/repositories/queue-history-repository';
import type { WorkspaceQueueSettingsRepository } from '../../src/infrastructure/repositories/workspace-queue-settings-repository';

const ctx = { workspaceId: 'w1', workspaceUserId: 'u1' };

interface Mocks {
  items: {
    create: jest.Mock;
    findByPermanentId: jest.Mock;
    listByOwner: jest.Mock;
    listScheduled: jest.Mock;
    updateScoped: jest.Mock;
  };
  events: { record: jest.Mock };
  history: {
    recordStatusChange: jest.Mock;
    recordPriorityChange: jest.Mock;
    recordAssignment: jest.Mock;
  };
  settings: { ensure: jest.Mock; update: jest.Mock };
  classifier: { classify: jest.Mock };
}

/** Fresh mock collaborators plus a QueueService wired to them. */
function build(over: { notifier?: { notifyAssignment: jest.Mock } } = {}): {
  svc: QueueService;
  m: Mocks;
} {
  const m: Mocks = {
    items: {
      create: jest.fn(),
      findByPermanentId: jest.fn(),
      listByOwner: jest.fn(),
      listScheduled: jest.fn(),
      updateScoped: jest.fn(),
    },
    events: { record: jest.fn() },
    history: {
      recordStatusChange: jest.fn(),
      recordPriorityChange: jest.fn(),
      recordAssignment: jest.fn(),
    },
    settings: { ensure: jest.fn(), update: jest.fn() },
    classifier: { classify: jest.fn() },
  };
  m.classifier.classify.mockReturnValue({
    priority: QueuePriority.Yellow,
    reason: 'Attention signals detected: please',
    matchedSignals: ['please'],
    automatic: true,
  });
  m.settings.ensure.mockResolvedValue({
    rankingMode: 'FIFO',
    includeWorkingInActive: true,
    includeWaitingInActive: false,
  });
  const deps: QueueServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
    history: m.history as unknown as QueueHistoryRepository,
    settings: m.settings as unknown as WorkspaceQueueSettingsRepository,
    classifier: m.classifier as unknown as PriorityClassificationService,
    ...(over.notifier === undefined ? {} : { notifier: over.notifier }),
  };
  return { svc: new QueueService(deps), m };
}

/** A QueueItem fixture with sensible defaults, overridable per test. */
function makeItem(over: Partial<QueueItem> = {}): QueueItem {
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
    status: QueueStatus.New,
    priority: QueuePriority.Green,
    rankingTimestamp: new Date('2026-01-01T00:00:00Z'),
    snoozedUntil: null,
    followUpDueAt: null,
    assignedAt: null,
    completedAt: null,
    archivedAt: null,
    claimedByWorkerId: null,
    claimedAt: null,
    heartbeatAt: null,
    lockExpiresAt: null,
    attemptCount: 0,
    processingStartedAt: null,
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('QueueService.createItem', () => {
  it('auto-classifies priority and records create + status + automatic priority history', async () => {
    const { svc, m } = build();
    m.items.create.mockResolvedValue(makeItem({ priority: QueuePriority.Yellow }));

    await svc.createItem(ctx, { title: 'please review' });

    expect(m.classifier.classify).toHaveBeenCalledTimes(1);
    const createArg = m.items.create.mock.calls[0]![0];
    expect(createArg.workspaceId).toBe('w1');
    expect(createArg.ownerWorkspaceUserId).toBe('u1');
    expect(createArg.creatorWorkspaceUserId).toBe('u1');
    expect(createArg.priority).toBe(QueuePriority.Yellow);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.CREATED, workspaceId: 'w1' }),
    );
    expect(m.history.recordStatusChange).toHaveBeenCalledTimes(1);
    expect(m.history.recordPriorityChange).toHaveBeenCalledWith(
      expect.objectContaining({ automatic: true, source: 'auto-classification' }),
    );
  });

  it('uses an explicit priority and skips classification + automatic priority history', async () => {
    const { svc, m } = build();
    m.items.create.mockResolvedValue(makeItem({ priority: QueuePriority.Red }));

    await svc.createItem(ctx, { title: 'x', priority: QueuePriority.Red });

    expect(m.classifier.classify).not.toHaveBeenCalled();
    expect(m.history.recordPriorityChange).not.toHaveBeenCalled();
    expect(m.items.create.mock.calls[0]![0].priority).toBe(QueuePriority.Red);
  });

  it('defaults the owner to the acting user but honors an explicit owner', async () => {
    const { svc, m } = build();
    m.items.create.mockResolvedValue(makeItem());

    await svc.createItem(ctx, {
      title: 'x',
      ownerWorkspaceUserId: 'u2',
      priority: QueuePriority.Green,
    });

    expect(m.items.create.mock.calls[0]![0].ownerWorkspaceUserId).toBe('u2');
    expect(m.items.create.mock.calls[0]![0].creatorWorkspaceUserId).toBe('u1');
  });
});

describe('QueueService.createOrUpdateSlackAttention', () => {
  const input = {
    title: 'Slack attention',
    ownerWorkspaceUserId: 'owner',
    priority: QueuePriority.Yellow,
    sourceType: QueueSourceType.SLACK_MESSAGE,
    sourceSlackChannelId: 'C1',
    sourceSlackUserId: 'U1',
    sourceSlackMessageTs: '1700000000.000100',
    sourceSlackThreadTs: '1700000000.000000',
    sourceSlackPermalink: 'https://acme.slack.com/archives/C1/p1700000000000100',
  };

  it('increments an existing pointer inside the burst window instead of creating another', async () => {
    const { svc, m } = build();
    const existing = makeItem({
      id: 'existing',
      ownerWorkspaceUserId: 'owner',
      sourceType: QueueSourceType.SLACK_MESSAGE,
      sourceSlackChannelId: 'C1',
      sourceSlackUserId: 'U1',
      sourceSlackThreadTs: '1700000000.000000',
      sourceSlackMessageCount: 2,
      updatedAt: new Date('2026-01-01T00:04:00Z'),
    });
    const updated = makeItem({ ...existing, sourceSlackMessageCount: 3 });
    m.items.listByOwner.mockResolvedValue([existing]);
    m.items.updateScoped.mockResolvedValue(updated);

    await svc.createOrUpdateSlackAttention(
      ctx,
      input,
      5 * 60_000,
      new Date('2026-01-01T00:05:00Z'),
    );

    expect(m.items.create).not.toHaveBeenCalled();
    expect(m.items.updateScoped).toHaveBeenCalledWith(
      'w1',
      'existing',
      expect.objectContaining({ sourceSlackMessageCount: 3 }),
    );
  });

  it('creates a new pointer after the burst window expires', async () => {
    const { svc, m } = build();
    const stale = makeItem({
      ownerWorkspaceUserId: 'owner',
      sourceType: QueueSourceType.SLACK_MESSAGE,
      sourceSlackChannelId: 'C1',
      sourceSlackUserId: 'U1',
      sourceSlackThreadTs: '1700000000.000000',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    m.items.listByOwner.mockResolvedValue([stale]);
    m.items.create.mockResolvedValue(makeItem());

    await svc.createOrUpdateSlackAttention(
      ctx,
      input,
      5 * 60_000,
      new Date('2026-01-01T00:06:00Z'),
    );

    expect(m.items.create).toHaveBeenCalledTimes(1);
  });
});

describe('QueueService.getItem', () => {
  it('returns the scoped item', async () => {
    const { svc, m } = build();
    const item = makeItem();
    m.items.findByPermanentId.mockResolvedValue(item);

    await expect(svc.getItem(ctx, 'MQ-000001')).resolves.toBe(item);
    expect(m.items.findByPermanentId).toHaveBeenCalledWith('w1', 'MQ-000001');
  });

  it('throws NotFoundError when the item is absent in the workspace', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(null);

    await expect(svc.getItem(ctx, 'MQ-404')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('QueueService active-queue ranking', () => {
  it('ranks only active items with gap-free 1-based positions (FIFO)', async () => {
    const { svc, m } = build();
    const a = makeItem({
      id: 'a',
      permanentQueueId: 'MQ-000001',
      status: QueueStatus.New,
      rankingTimestamp: new Date('2026-01-01T00:00:00Z'),
    });
    const b = makeItem({
      id: 'b',
      permanentQueueId: 'MQ-000002',
      status: QueueStatus.Working,
      rankingTimestamp: new Date('2026-01-02T00:00:00Z'),
    });
    const done = makeItem({ id: 'c', permanentQueueId: 'MQ-000003', status: QueueStatus.Done });
    m.items.listByOwner.mockResolvedValue([b, done, a]);

    const ranked = await svc.getActiveQueue(ctx);

    expect(ranked.map((r) => [r.item.id, r.position])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(m.items.listByOwner).toHaveBeenCalledWith('w1', 'u1');
  });

  it('calculatePositions is an alias for getActiveQueue', async () => {
    const { svc, m } = build();
    const a = makeItem({ id: 'a', status: QueueStatus.New });
    m.items.listByOwner.mockResolvedValue([a]);

    const ranked = await svc.calculatePositions(ctx, 'u3');

    expect(ranked).toEqual([{ item: a, position: 1 }]);
    expect(m.items.listByOwner).toHaveBeenCalledWith('w1', 'u3');
  });

  it('resolves an item together with its active-queue position', async () => {
    const { svc, m } = build();
    const target = makeItem({
      id: 'b',
      permanentQueueId: 'MQ-000002',
      status: QueueStatus.New,
      rankingTimestamp: new Date('2026-01-02T00:00:00Z'),
    });
    const earlier = makeItem({
      id: 'a',
      permanentQueueId: 'MQ-000001',
      status: QueueStatus.New,
      rankingTimestamp: new Date('2026-01-01T00:00:00Z'),
    });
    m.items.findByPermanentId.mockResolvedValue(target);
    m.items.listByOwner.mockResolvedValue([earlier, target]);

    const result = await svc.getItemWithPosition(ctx, 'MQ-000002');

    expect(result.item).toBe(target);
    expect(result.position).toBe(2);
  });

  it('records a RECALCULATED event scoped to the workspace', async () => {
    const { svc, m } = build();
    m.items.listByOwner.mockResolvedValue([
      makeItem({ id: 'a', status: QueueStatus.New }),
      makeItem({ id: 'b', permanentQueueId: 'MQ-000002', status: QueueStatus.Working }),
    ]);

    await svc.recalculateForOwner(ctx, 'u1');

    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        eventType: QueueEventType.RECALCULATED,
        newValue: '2',
      }),
    );
  });
});

describe('QueueService status lifecycle', () => {
  it('completes an item, sets completedAt, and records COMPLETED', async () => {
    const { svc, m } = build();
    const item = makeItem({ status: QueueStatus.New });
    m.items.findByPermanentId.mockResolvedValue(item);
    m.items.updateScoped.mockResolvedValue(makeItem({ status: QueueStatus.Done }));

    await svc.complete(ctx, 'MQ-000001');

    const changes = m.items.updateScoped.mock.calls[0]![2];
    expect(changes.status).toBe(QueueStatus.Done);
    expect(changes.completedAt).toBeInstanceOf(Date);
    expect(m.history.recordStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: QueueStatus.New, toStatus: QueueStatus.Done }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.COMPLETED }),
    );
  });

  it('snoozes an item with the requested wake time and sets availableAt to the same time', async () => {
    const { svc, m } = build();
    const until = new Date('2026-06-01T00:00:00Z');
    m.items.findByPermanentId.mockResolvedValue(makeItem({ status: QueueStatus.New }));
    m.items.updateScoped.mockResolvedValue(makeItem({ status: QueueStatus.Snoozed }));

    await svc.snooze(ctx, 'MQ-000001', until);

    const changes = m.items.updateScoped.mock.calls[0]![2];
    expect(changes.status).toBe(QueueStatus.Snoozed);
    expect(changes.snoozedUntil).toBe(until);
    // Phase 3C: claim gate must equal the snooze wake time.
    expect(changes.availableAt).toBe(until);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.SNOOZED }),
    );
  });

  it('unsnoozes back to New, clearing snoozedUntil and availableAt with an UNSNOOZED event', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ status: QueueStatus.Snoozed }));
    m.items.updateScoped.mockResolvedValue(makeItem({ status: QueueStatus.New }));

    await svc.unsnooze(ctx, 'MQ-000001');

    const changes = m.items.updateScoped.mock.calls[0]![2];
    expect(changes.status).toBe(QueueStatus.New);
    expect(changes.snoozedUntil).toBeNull();
    // Phase 3C: claim gate must be cleared so the item re-enters the active queue.
    expect(changes.availableAt).toBeNull();
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.UNSNOOZED }),
    );
  });

  it('rejects an illegal transition without writing any update', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ status: QueueStatus.Archived }));

    await expect(svc.changeStatus(ctx, 'MQ-000001', QueueStatus.Working)).rejects.toBeInstanceOf(
      InvalidQueueStatusTransitionError,
    );
    expect(m.items.updateScoped).not.toHaveBeenCalled();
    expect(m.events.record).not.toHaveBeenCalled();
  });
});

describe('QueueService priority and assignment', () => {
  it('updates priority manually and records a non-automatic priority change', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ priority: QueuePriority.Green }));
    m.items.updateScoped.mockResolvedValue(makeItem({ priority: QueuePriority.Red }));

    await svc.updatePriority(ctx, 'MQ-000001', QueuePriority.Red, { reason: 'urgent' });

    expect(m.history.recordPriorityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPriority: QueuePriority.Green,
        toPriority: QueuePriority.Red,
        source: 'manual',
        automatic: false,
        reason: 'urgent',
      }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.PRIORITY_CHANGED }),
    );
  });

  it('reassigns to a new owner and records a REASSIGNED event', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u1' }));
    m.items.updateScoped.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u2' }));

    await svc.assign(ctx, 'MQ-000001', 'u2');

    expect(m.items.updateScoped.mock.calls[0]![2].ownerWorkspaceUserId).toBe('u2');
    expect(m.history.recordAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        previousOwnerWorkspaceUserId: 'u1',
        ownerWorkspaceUserId: 'u2',
        assignedByWorkspaceUserId: 'u1',
      }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.REASSIGNED }),
    );
  });

  it('fires an assignment notification for the new owner (fire-and-forget)', async () => {
    const notifier = { notifyAssignment: jest.fn().mockResolvedValue(true) };
    const { svc, m } = build({ notifier });
    m.items.findByPermanentId.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u1' }));
    m.items.updateScoped.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u2' }));

    await svc.assign(ctx, 'MQ-000001', 'u2');

    expect(notifier.notifyAssignment).toHaveBeenCalledWith('w1', 'i1');
  });

  it('skips the notification when a user assigns an item to themselves', async () => {
    const notifier = { notifyAssignment: jest.fn().mockResolvedValue(true) };
    const { svc, m } = build({ notifier });
    m.items.findByPermanentId.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u2' }));
    m.items.updateScoped.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u1' }));

    await svc.assign(ctx, 'MQ-000001', 'u1');

    expect(notifier.notifyAssignment).not.toHaveBeenCalled();
  });

  it('still completes the assignment when notification delivery rejects', async () => {
    const notifier = { notifyAssignment: jest.fn().mockRejectedValue(new Error('boom')) };
    const { svc, m } = build({ notifier });
    m.items.findByPermanentId.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u1' }));
    m.items.updateScoped.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u2' }));

    await expect(svc.assign(ctx, 'MQ-000001', 'u2')).resolves.toBeDefined();
    expect(notifier.notifyAssignment).toHaveBeenCalledWith('w1', 'i1');
  });

  it('never attempts a notification when no notifier is wired', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u1' }));
    m.items.updateScoped.mockResolvedValue(makeItem({ ownerWorkspaceUserId: 'u2' }));

    await expect(svc.assign(ctx, 'MQ-000001', 'u2')).resolves.toBeDefined();
  });
});

describe('QueueService.schedule', () => {
  const futureDate = new Date(Date.now() + 3_600_000);

  it('sets scheduledFor and availableAt on a New item and records SCHEDULED event', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ status: QueueStatus.New }));
    m.items.updateScoped.mockResolvedValue(
      makeItem({ scheduledFor: futureDate, availableAt: futureDate }),
    );

    await svc.schedule(ctx, 'MQ-000001', futureDate);

    expect(m.items.updateScoped).toHaveBeenCalledWith(
      'w1',
      'i1',
      expect.objectContaining({ scheduledFor: futureDate, availableAt: futureDate }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.SCHEDULED }),
    );
  });

  it('throws ConflictError when the item is not New', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(makeItem({ status: QueueStatus.Done }));

    await expect(svc.schedule(ctx, 'MQ-000001', futureDate)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(m.items.updateScoped).not.toHaveBeenCalled();
    expect(m.events.record).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the item does not exist', async () => {
    const { svc, m } = build();
    m.items.findByPermanentId.mockResolvedValue(null);

    await expect(svc.schedule(ctx, 'MQ-000001', futureDate)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('QueueService.getCompletedToday', () => {
  it('returns only items completed since the start of the current day', async () => {
    const { svc, m } = build();
    const today = makeItem({ id: 'today', status: QueueStatus.Done, completedAt: new Date() });
    const yesterday = makeItem({
      id: 'yesterday',
      status: QueueStatus.Done,
      completedAt: new Date(Date.now() - 36 * 60 * 60 * 1000),
    });
    m.items.listByOwner.mockResolvedValue([today, yesterday]);

    const result = await svc.getCompletedToday(ctx);

    expect(result.map((i) => i.id)).toEqual(['today']);
    expect(m.items.listByOwner).toHaveBeenCalledWith('w1', 'u1', {
      statuses: [QueueStatus.Done],
    });
  });
});
