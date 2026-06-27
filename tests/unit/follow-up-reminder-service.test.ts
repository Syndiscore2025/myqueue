import {
  FOLLOW_UP_DEDUPE_TTL_SECONDS,
  FollowUpReminderService,
  type FollowUpReminderServiceDeps,
} from '../../src/application/notifications';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';

const now = new Date('2026-06-01T12:00:00Z');
const dueAt = new Date('2026-06-01T11:00:00Z');

interface Mocks {
  items: { listDueFollowUps: jest.Mock };
  notifier: { notifyFollowUpDue: jest.Mock };
  dedupe: { claim: jest.Mock };
}

function build(): { svc: FollowUpReminderService; m: Mocks } {
  const m: Mocks = {
    items: { listDueFollowUps: jest.fn() },
    notifier: { notifyFollowUpDue: jest.fn().mockResolvedValue(true) },
    dedupe: { claim: jest.fn().mockResolvedValue(true) },
  };
  const deps: FollowUpReminderServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    notifier: m.notifier,
    dedupe: m.dedupe,
  };
  return { svc: new FollowUpReminderService(deps), m };
}

const dueItem = {
  id: 'i1',
  workspaceId: 'w1',
  permanentQueueId: 'MQ-000001',
  followUpDueAt: dueAt,
};

describe('FollowUpReminderService.remindBatch', () => {
  it('returns 0 and notifies nothing when no follow-ups are due', async () => {
    const { svc, m } = build();
    m.items.listDueFollowUps.mockResolvedValue([]);

    const sent = await svc.remindBatch(now);

    expect(sent).toBe(0);
    expect(m.dedupe.claim).not.toHaveBeenCalled();
    expect(m.notifier.notifyFollowUpDue).not.toHaveBeenCalled();
  });

  it('claims a per-item+dueAt key with the long TTL then DMs the owner', async () => {
    const { svc, m } = build();
    m.items.listDueFollowUps.mockResolvedValue([dueItem]);

    const sent = await svc.remindBatch(now);

    expect(sent).toBe(1);
    expect(m.dedupe.claim).toHaveBeenCalledWith(
      `myqueue:followup:w1:i1:${dueAt.getTime()}`,
      FOLLOW_UP_DEDUPE_TTL_SECONDS,
    );
    expect(m.notifier.notifyFollowUpDue).toHaveBeenCalledWith('w1', 'i1');
  });

  it('skips the DM when the dedupe key was already claimed', async () => {
    const { svc, m } = build();
    m.items.listDueFollowUps.mockResolvedValue([dueItem]);
    m.dedupe.claim.mockResolvedValue(false);

    const sent = await svc.remindBatch(now);

    expect(sent).toBe(0);
    expect(m.notifier.notifyFollowUpDue).not.toHaveBeenCalled();
  });

  it('counts only delivered reminders when some deliveries fail', async () => {
    const { svc, m } = build();
    const second = { ...dueItem, id: 'i2', permanentQueueId: 'MQ-000002' };
    m.items.listDueFollowUps.mockResolvedValue([dueItem, second]);
    m.notifier.notifyFollowUpDue.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const sent = await svc.remindBatch(now);

    expect(sent).toBe(1);
    expect(m.dedupe.claim).toHaveBeenCalledTimes(2);
    expect(m.notifier.notifyFollowUpDue).toHaveBeenCalledTimes(2);
  });
});

describe('FollowUpReminderService.start / stop', () => {
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
