import {
  QueueRecurrenceService,
  nextRunAfter,
  type QueueRecurrenceServiceDeps,
} from '../../src/application/queue';
import { QueueEventType } from '../../src/domain/queue';
import type { QueueItemRepository } from '../../src/infrastructure/repositories/queue-item-repository';
import type { QueueEventRepository } from '../../src/infrastructure/repositories/queue-event-repository';
import type { QueueRecurrenceRepository } from '../../src/infrastructure/repositories/queue-recurrence-repository';

const now = new Date('2026-06-01T12:00:00Z');

interface Mocks {
  items: { create: jest.Mock };
  events: { record: jest.Mock };
  recurrence: {
    create: jest.Mock;
    findById: jest.Mock;
    list: jest.Mock;
    update: jest.Mock;
    claimDueRules: jest.Mock;
    advanceRule: jest.Mock;
  };
}

function build(): { svc: QueueRecurrenceService; m: Mocks } {
  const m: Mocks = {
    items: { create: jest.fn() },
    events: { record: jest.fn() },
    recurrence: {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      claimDueRules: jest.fn(),
      advanceRule: jest.fn(),
    },
  };
  const deps: QueueRecurrenceServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    events: m.events as unknown as QueueEventRepository,
    recurrence: m.recurrence as unknown as QueueRecurrenceRepository,
  };
  return { svc: new QueueRecurrenceService(deps), m };
}

const dueRule = {
  id: 'r1',
  workspaceId: 'w1',
  createdByWorkspaceUserId: 'u1',
  ownerWorkspaceUserId: 'u1',
  name: 'Daily standup',
  cronExpression: '0 9 * * *',
  timezone: 'UTC',
  maxRuns: null as number | null,
  runCount: 0,
  priority: 'Green',
  partitionKey: null,
  rateLimitKey: null,
  payloadTemplate: null,
};

describe('nextRunAfter', () => {
  it('computes the next cron occurrence in the given timezone', () => {
    const next = nextRunAfter('0 9 * * *', 'UTC', new Date('2026-06-01T08:00:00Z'));
    expect(next?.toISOString()).toBe('2026-06-01T09:00:00.000Z');
  });

  it('returns null for an invalid cron expression', () => {
    expect(nextRunAfter('not-a-cron', 'UTC', now)).toBeNull();
  });
});

describe('QueueRecurrenceService.createRule', () => {
  it('creates the rule then sets its initial nextRunAt', async () => {
    const { svc, m } = build();
    m.recurrence.create.mockResolvedValue({ ...dueRule });
    m.recurrence.update.mockResolvedValue({ ...dueRule, nextRunAt: new Date() });

    await svc.createRule({ workspaceId: 'w1', name: 'x', cronExpression: '0 9 * * *' });

    expect(m.recurrence.create).toHaveBeenCalledTimes(1);
    expect(m.recurrence.update).toHaveBeenCalledWith(
      'r1',
      'w1',
      expect.objectContaining({ nextRunAt: expect.any(Date) }),
    );
  });
});

describe('QueueRecurrenceService.pause / resume', () => {
  it('pause sets isEnabled=false', async () => {
    const { svc, m } = build();
    await svc.pauseRule('r1', 'w1');
    expect(m.recurrence.update).toHaveBeenCalledWith('r1', 'w1', { isEnabled: false });
  });

  it('resume sets isEnabled=true', async () => {
    const { svc, m } = build();
    await svc.resumeRule('r1', 'w1');
    expect(m.recurrence.update).toHaveBeenCalledWith('r1', 'w1', { isEnabled: true });
  });
});

describe('QueueRecurrenceService.processDueRules', () => {
  it('returns 0 when no rules are due', async () => {
    const { svc, m } = build();
    m.recurrence.claimDueRules.mockResolvedValue([]);
    expect(await svc.processDueRules(now)).toBe(0);
    expect(m.items.create).not.toHaveBeenCalled();
  });

  it('spawns an item, records RECURRING_ITEM_CREATED, and advances the rule', async () => {
    const { svc, m } = build();
    m.recurrence.claimDueRules.mockResolvedValue([{ ...dueRule }]);
    m.items.create.mockResolvedValue({ id: 'i1', permanentQueueId: 'MQ-000001' });

    const spawned = await svc.processDueRules(now);

    expect(spawned).toBe(1);
    expect(m.items.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        ownerWorkspaceUserId: 'u1',
        recurrenceRuleId: 'r1',
      }),
    );
    expect(m.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: QueueEventType.RECURRING_ITEM_CREATED }),
    );
    expect(m.recurrence.advanceRule).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ runCount: 1, isEnabled: true, nextRunAt: expect.any(Date) }),
    );
  });

  it('disables the rule and nulls nextRunAt when maxRuns is reached', async () => {
    const { svc, m } = build();
    m.recurrence.claimDueRules.mockResolvedValue([{ ...dueRule, maxRuns: 1, runCount: 0 }]);
    m.items.create.mockResolvedValue({ id: 'i1', permanentQueueId: 'MQ-000001' });

    await svc.processDueRules(now);

    expect(m.recurrence.advanceRule).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ runCount: 1, isEnabled: false, nextRunAt: null }),
    );
  });

  it('skips rules with no owner', async () => {
    const { svc, m } = build();
    m.recurrence.claimDueRules.mockResolvedValue([
      { ...dueRule, ownerWorkspaceUserId: null, createdByWorkspaceUserId: null },
    ]);
    expect(await svc.processDueRules(now)).toBe(0);
    expect(m.items.create).not.toHaveBeenCalled();
  });
});

describe('QueueRecurrenceService.start / stop', () => {
  it('start is idempotent', () => {
    jest.useFakeTimers();
    const { svc } = build();
    svc.start();
    svc.start();
    expect(jest.getTimerCount()).toBe(1);
    svc.stop();
    jest.useRealTimers();
  });

  it('stop is idempotent', () => {
    const { svc } = build();
    expect(() => svc.stop()).not.toThrow();
  });
});
