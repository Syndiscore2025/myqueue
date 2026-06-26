import { QueueRecoveryService, type QueueRecoveryServiceDeps } from '../../src/application/queue';
import { QueueEventType, QueueStatus } from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';

const now = new Date('2026-01-01T00:05:00Z');

interface Mocks {
  items: { recoverExpired: jest.Mock; findByPermanentId: jest.Mock };
  events: { record: jest.Mock };
  publisher: { publish: jest.Mock };
}

function build(): { svc: QueueRecoveryService; m: Mocks } {
  const m: Mocks = {
    items: { recoverExpired: jest.fn(), findByPermanentId: jest.fn() },
    events: { record: jest.fn() },
    publisher: { publish: jest.fn() },
  };
  const deps: QueueRecoveryServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
    publisher: m.publisher,
  };
  return { svc: new QueueRecoveryService(deps), m };
}

const recoveredItem = {
  id: 'i1',
  workspaceId: 'w1',
  permanentQueueId: 'MQ-000001',
  attemptCount: 1,
  previousWorkerId: 'worker-1',
};

describe('QueueRecoveryService.recoverExpired', () => {
  it('returns 0 and records nothing when no items have expired locks', async () => {
    const { svc, m } = build();
    m.items.recoverExpired.mockResolvedValue([]);

    const count = await svc.recoverExpired(now);

    expect(count).toBe(0);
    expect(m.events.record).not.toHaveBeenCalled();
    expect(m.publisher.publish).not.toHaveBeenCalled();
  });

  it('records a RECOVERED audit event for each recovered item', async () => {
    const { svc, m } = build();
    m.items.recoverExpired.mockResolvedValue([recoveredItem]);

    await svc.recoverExpired(now);

    expect(m.events.record).toHaveBeenCalledTimes(1);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        queueItemId: 'i1',
        eventType: QueueEventType.RECOVERED,
        previousValue: QueueStatus.Processing,
        newValue: QueueStatus.New,
        metadata: { previousWorkerId: 'worker-1', attemptCount: 1 },
      }),
    );
  });

  it('publishes a QueueRecovered event for each recovered item', async () => {
    const { svc, m } = build();
    m.items.recoverExpired.mockResolvedValue([recoveredItem]);

    await svc.recoverExpired(now);

    expect(m.publisher.publish).toHaveBeenCalledTimes(1);
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'QueueRecovered',
        workspaceId: 'w1',
        queueItemId: 'i1',
        permanentQueueId: 'MQ-000001',
        previousWorkerId: 'worker-1',
        attemptCount: 1,
      }),
    );
  });

  it('returns the count of recovered items', async () => {
    const { svc, m } = build();
    const second = { ...recoveredItem, id: 'i2', permanentQueueId: 'MQ-000002' };
    m.items.recoverExpired.mockResolvedValue([recoveredItem, second]);

    const count = await svc.recoverExpired(now);

    expect(count).toBe(2);
    expect(m.events.record).toHaveBeenCalledTimes(2);
    expect(m.publisher.publish).toHaveBeenCalledTimes(2);
  });

  it('handles a null previousWorkerId gracefully (unidentified worker)', async () => {
    const { svc, m } = build();
    m.items.recoverExpired.mockResolvedValue([{ ...recoveredItem, previousWorkerId: null }]);

    await svc.recoverExpired(now);

    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { previousWorkerId: null, attemptCount: 1 } }),
    );
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ previousWorkerId: null }),
    );
  });
});

describe('QueueRecoveryService.start / stop', () => {
  it('start is idempotent — calling twice does not add a second timer', () => {
    jest.useFakeTimers();
    const { svc } = build();
    svc.start();
    svc.start(); // second call should be a no-op
    expect(jest.getTimerCount()).toBe(1);
    svc.stop();
    jest.useRealTimers();
  });

  it('stop is idempotent — stopping an already stopped service does not throw', () => {
    const { svc } = build();
    expect(() => svc.stop()).not.toThrow();
  });
});
