import {
  QueueActivationService,
  type QueueActivationServiceDeps,
} from '../../src/application/queue';
import { QueueEventType, QueueStatus } from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';

const now = new Date('2026-06-01T12:00:00Z');

interface Mocks {
  items: { activateDueSnoozed: jest.Mock };
  events: { record: jest.Mock };
  publisher: { publish: jest.Mock };
}

function build(): { svc: QueueActivationService; m: Mocks } {
  const m: Mocks = {
    items: { activateDueSnoozed: jest.fn() },
    events: { record: jest.fn() },
    publisher: { publish: jest.fn() },
  };
  const deps: QueueActivationServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
    publisher: m.publisher,
  };
  return { svc: new QueueActivationService(deps), m };
}

const activatedItem = { id: 'i1', workspaceId: 'w1', permanentQueueId: 'MQ-000001' };

describe('QueueActivationService.activateBatch', () => {
  it('returns 0 and records nothing when no items are due', async () => {
    const { svc, m } = build();
    m.items.activateDueSnoozed.mockResolvedValue([]);

    const count = await svc.activateBatch(now);

    expect(count).toBe(0);
    expect(m.events.record).not.toHaveBeenCalled();
    expect(m.publisher.publish).not.toHaveBeenCalled();
  });

  it('records an ACTIVATED audit event for each woken item', async () => {
    const { svc, m } = build();
    m.items.activateDueSnoozed.mockResolvedValue([activatedItem]);

    await svc.activateBatch(now);

    expect(m.events.record).toHaveBeenCalledTimes(1);
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        queueItemId: 'i1',
        eventType: QueueEventType.ACTIVATED,
        previousValue: QueueStatus.Snoozed,
        newValue: QueueStatus.New,
        metadata: { activationReason: 'SNOOZED' },
      }),
    );
  });

  it('publishes a QueueItemActivated event for each woken item', async () => {
    const { svc, m } = build();
    m.items.activateDueSnoozed.mockResolvedValue([activatedItem]);

    await svc.activateBatch(now);

    expect(m.publisher.publish).toHaveBeenCalledTimes(1);
    expect(m.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'QueueItemActivated',
        workspaceId: 'w1',
        queueItemId: 'i1',
        permanentQueueId: 'MQ-000001',
        activationReason: 'SNOOZED',
      }),
    );
  });

  it('returns the count of activated items and processes all of them', async () => {
    const { svc, m } = build();
    const second = { ...activatedItem, id: 'i2', permanentQueueId: 'MQ-000002' };
    m.items.activateDueSnoozed.mockResolvedValue([activatedItem, second]);

    const count = await svc.activateBatch(now);

    expect(count).toBe(2);
    expect(m.events.record).toHaveBeenCalledTimes(2);
    expect(m.publisher.publish).toHaveBeenCalledTimes(2);
  });
});

describe('QueueActivationService.start / stop', () => {
  it('start is idempotent — calling twice does not add a second timer', () => {
    jest.useFakeTimers();
    const { svc } = build();
    svc.start();
    svc.start();
    expect(jest.getTimerCount()).toBe(1);
    svc.stop();
    jest.useRealTimers();
  });

  it('stop is idempotent — stopping an already stopped service does not throw', () => {
    const { svc } = build();
    expect(() => svc.stop()).not.toThrow();
  });
});
