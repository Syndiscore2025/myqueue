/**
 * Unit tests for QueueClaimService.resolveDependencies.
 * Verifies that Done/DeadLetter upstream correctly unblocks or cascades.
 */
import { QueueClaimService, type QueueClaimServiceDeps } from '../../src/application/queue';
import { QueueEventType, QueueStatus } from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';

const UPSTREAM_ID = 'item-upstream';
const WORKSPACE = 'w1';

const depUnblock = {
  queueItemId: 'dep-a',
  workspaceId: WORKSPACE,
  permanentQueueId: 'MQ-000002',
  dependencyType: 'COMPLETE_REQUIRED',
};

const depContinue = {
  queueItemId: 'dep-b',
  workspaceId: WORKSPACE,
  permanentQueueId: 'MQ-000003',
  dependencyType: 'CONTINUE_IF_DEPENDENCY_FAILS',
};

const depFail = {
  queueItemId: 'dep-c',
  workspaceId: WORKSPACE,
  permanentQueueId: 'MQ-000004',
  dependencyType: 'FAIL_IF_DEPENDENCY_FAILS',
};

interface Mocks {
  items: { updateScoped: jest.Mock };
  events: { record: jest.Mock };
  dependencies: { findResolvableDependents: jest.Mock };
}

function build(): { svc: QueueClaimService; m: Mocks } {
  const m: Mocks = {
    items: { updateScoped: jest.fn().mockResolvedValue({}) },
    events: { record: jest.fn().mockResolvedValue(undefined) },
    dependencies: { findResolvableDependents: jest.fn() },
  };
  const deps: QueueClaimServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
    dependencies: m.dependencies as never,
    settings: { ensure: jest.fn(), update: jest.fn() } as never,
    publisher: { publish: jest.fn() },
    registry: { register: jest.fn(), markDead: jest.fn(), list: jest.fn() } as never,
  };
  return { svc: new QueueClaimService(deps), m };
}

describe('QueueClaimService.resolveDependencies — Done upstream', () => {
  it('emits DEPENDENCY_UNBLOCKED for each dependent when upstream completes', async () => {
    const { svc, m } = build();
    m.dependencies.findResolvableDependents.mockResolvedValue({
      toUnblock: [depUnblock],
      toDeadLetter: [],
    });

    await svc.resolveDependencies(UPSTREAM_ID, WORKSPACE, 'Done');

    expect(m.events.record).toHaveBeenCalledTimes(1);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        queueItemId: depUnblock.queueItemId,
        eventType: QueueEventType.DEPENDENCY_UNBLOCKED,
      }),
    );
    expect(m.items.updateScoped).not.toHaveBeenCalled();
  });

  it('emits nothing when upstream has no dependents', async () => {
    const { svc, m } = build();
    m.dependencies.findResolvableDependents.mockResolvedValue({ toUnblock: [], toDeadLetter: [] });

    await svc.resolveDependencies(UPSTREAM_ID, WORKSPACE, 'Done');

    expect(m.events.record).not.toHaveBeenCalled();
  });
});

describe('QueueClaimService.resolveDependencies — DeadLetter upstream', () => {
  it('unblocks CONTINUE_IF_DEPENDENCY_FAILS and dead-letters FAIL_IF_DEPENDENCY_FAILS', async () => {
    const { svc, m } = build();
    m.dependencies.findResolvableDependents.mockResolvedValue({
      toUnblock: [depContinue],
      toDeadLetter: [depFail],
    });

    await svc.resolveDependencies(UPSTREAM_ID, WORKSPACE, 'DeadLetter');

    // unblock event for CONTINUE
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        queueItemId: depContinue.queueItemId,
        eventType: QueueEventType.DEPENDENCY_UNBLOCKED,
      }),
    );
    // dead-letter the FAIL dependent
    expect(m.items.updateScoped).toHaveBeenCalledWith(
      WORKSPACE,
      depFail.queueItemId,
      expect.objectContaining({ status: QueueStatus.DeadLetter }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        queueItemId: depFail.queueItemId,
        eventType: QueueEventType.DEAD_LETTERED,
      }),
    );
  });
});
