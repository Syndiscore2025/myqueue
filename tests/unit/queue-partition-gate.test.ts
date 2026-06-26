/**
 * Slice 9 — Partition key claim isolation.
 *
 * Partition semantics: if a QueueItem has a partition_key, only one item
 * with that key can be in Processing state at a time. claimNext returns null
 * when the partition slot is occupied.
 *
 * The gate lives entirely in the claimNext SQL (NOT EXISTS subquery) added in
 * Slice 7/8/9. These tests verify that QueueClaimService.claim() returns null
 * and records no events when the repository signals "no claimable item"
 * (i.e. the partition gate is active), and that it succeeds when the slot is free.
 */
import { QueueClaimService, type QueueClaimServiceDeps } from '../../src/application/queue';
import { QueueRankingMode, QueueStatus } from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';

const ctx = { workspaceId: 'w1', workerId: 'wk-1' };

function makeItem(partitionKey: string | null = null): Record<string, unknown> {
  return {
    id: 'item-1',
    permanentQueueId: 'MQ-000001',
    workspaceId: 'w1',
    status: QueueStatus.Processing,
    partitionKey,
    ownerWorkspaceUserId: 'u1',
    title: 'test item',
    priority: 'Green',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Mocks {
  items: { claimNext: jest.Mock; updateScoped: jest.Mock };
  events: { record: jest.Mock };
  settings: { ensure: jest.Mock };
  dependencies: { findResolvableDependents: jest.Mock };
}

function build(): { svc: QueueClaimService; m: Mocks } {
  const m: Mocks = {
    items: { claimNext: jest.fn(), updateScoped: jest.fn() },
    events: { record: jest.fn() },
    settings: { ensure: jest.fn() },
    dependencies: {
      findResolvableDependents: jest.fn().mockResolvedValue({ toUnblock: [], toDeadLetter: [] }),
    },
  };
  m.settings.ensure.mockResolvedValue({
    rankingMode: QueueRankingMode.FIFO,
    includeWorkingInActive: false,
    includeWaitingInActive: false,
  });
  const deps: QueueClaimServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
    settings: m.settings as never,
    publisher: { publish: jest.fn() },
    registry: { register: jest.fn() } as never,
    dependencies: m.dependencies as never,
  };
  return { svc: new QueueClaimService(deps), m };
}

describe('Partition gate — QueueClaimService.claim', () => {
  it('returns null and records no events when partition slot is occupied (no candidate)', async () => {
    const { svc, m } = build();
    // Simulate partition gate: claimNext returns null because another item
    // with the same partitionKey is already Processing
    m.items.claimNext.mockResolvedValue(null);

    const result = await svc.claim(ctx);

    expect(result).toBeNull();
    expect(m.events.record).not.toHaveBeenCalled();
  });

  it('returns and records the claimed item when partition slot is free', async () => {
    const { svc, m } = build();
    const item = makeItem('partition-A');
    m.items.claimNext.mockResolvedValue(item);

    const result = await svc.claim(ctx);

    expect(result).toMatchObject({ permanentQueueId: 'MQ-000001' });
    expect(m.events.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CLAIMED' }));
  });

  it('items with no partitionKey are always claimable regardless of other partition activity', async () => {
    const { svc, m } = build();
    const item = makeItem(null);
    m.items.claimNext.mockResolvedValue(item);

    const result = await svc.claim(ctx);

    expect(result).not.toBeNull();
  });
});
