import { QueuePriority, QueueRankingMode, QueueStatus } from '../../src/domain/queue/enums';
import type { RankableItem } from '../../src/domain/queue/queue-item';
import {
  filterActive,
  isActiveStatus,
  positionOf,
  rankActiveQueue,
  type RankingOptions,
} from '../../src/domain/queue/ranking-engine';

const FIFO: RankingOptions = {
  mode: QueueRankingMode.FIFO,
  includeWorkingInActive: true,
  includeWaitingInActive: false,
};
const PRIORITY: RankingOptions = { ...FIFO, mode: QueueRankingMode.PRIORITY };

function item(permanentQueueId: string, overrides: Partial<RankableItem> = {}): RankableItem {
  return {
    permanentQueueId,
    status: overrides.status ?? QueueStatus.New,
    priority: overrides.priority ?? QueuePriority.Green,
    rankingTimestamp: overrides.rankingTimestamp ?? new Date('2026-01-01T00:00:00.000Z'),
    availableAt: overrides.availableAt ?? null,
  };
}

const at = (iso: string): Date => new Date(iso);
const ids = (entries: { item: RankableItem }[]): string[] =>
  entries.map((entry) => entry.item.permanentQueueId);

describe('ranking engine — active filter', () => {
  it('treats New as always active and FollowUp/Snoozed/Done/Archived as never active', () => {
    expect(isActiveStatus(QueueStatus.New, FIFO)).toBe(true);
    for (const status of [
      QueueStatus.FollowUp,
      QueueStatus.Snoozed,
      QueueStatus.Done,
      QueueStatus.Archived,
    ]) {
      expect(isActiveStatus(status, FIFO)).toBe(false);
    }
  });

  it('honors the Working and Waiting inclusion flags', () => {
    expect(isActiveStatus(QueueStatus.Working, { ...FIFO, includeWorkingInActive: true })).toBe(
      true,
    );
    expect(isActiveStatus(QueueStatus.Working, { ...FIFO, includeWorkingInActive: false })).toBe(
      false,
    );
    expect(isActiveStatus(QueueStatus.Waiting, { ...FIFO, includeWaitingInActive: true })).toBe(
      true,
    );
    expect(isActiveStatus(QueueStatus.Waiting, { ...FIFO, includeWaitingInActive: false })).toBe(
      false,
    );
  });

  it('filters out inactive items before ranking', () => {
    const items = [
      item('MQ-1', { status: QueueStatus.New }),
      item('MQ-2', { status: QueueStatus.Done }),
      item('MQ-3', { status: QueueStatus.Snoozed }),
    ];
    expect(filterActive(items, FIFO).map((i) => i.permanentQueueId)).toEqual(['MQ-1']);
  });
});

describe('ranking engine — ordering', () => {
  it('FIFO ranks oldest rankingTimestamp first', () => {
    const items = [
      item('MQ-2', { rankingTimestamp: at('2026-01-02T00:00:00Z') }),
      item('MQ-1', { rankingTimestamp: at('2026-01-01T00:00:00Z') }),
      item('MQ-3', { rankingTimestamp: at('2026-01-03T00:00:00Z') }),
    ];
    expect(ids(rankActiveQueue(items, FIFO))).toEqual(['MQ-1', 'MQ-2', 'MQ-3']);
  });

  it('PRIORITY ranks Red > Yellow > Green, then oldest first within a tier', () => {
    const items = [
      item('MQ-G', { priority: QueuePriority.Green, rankingTimestamp: at('2026-01-01T00:00:00Z') }),
      item('MQ-R', { priority: QueuePriority.Red, rankingTimestamp: at('2026-01-04T00:00:00Z') }),
      item('MQ-Y2', {
        priority: QueuePriority.Yellow,
        rankingTimestamp: at('2026-01-03T00:00:00Z'),
      }),
      item('MQ-Y1', {
        priority: QueuePriority.Yellow,
        rankingTimestamp: at('2026-01-02T00:00:00Z'),
      }),
    ];
    expect(ids(rankActiveQueue(items, PRIORITY))).toEqual(['MQ-R', 'MQ-Y1', 'MQ-Y2', 'MQ-G']);
  });

  it('breaks timestamp ties deterministically by permanentQueueId', () => {
    const ts = at('2026-01-01T00:00:00Z');
    const items = [
      item('MQ-3', { rankingTimestamp: ts }),
      item('MQ-1', { rankingTimestamp: ts }),
      item('MQ-2', { rankingTimestamp: ts }),
    ];
    expect(ids(rankActiveQueue(items, FIFO))).toEqual(['MQ-1', 'MQ-2', 'MQ-3']);
  });

  it('assigns gap-free 1-based positions', () => {
    const items = [
      item('MQ-1', { rankingTimestamp: at('2026-01-01T00:00:00Z') }),
      item('MQ-2', { rankingTimestamp: at('2026-01-02T00:00:00Z') }),
      item('MQ-3', { rankingTimestamp: at('2026-01-03T00:00:00Z') }),
    ];
    expect(rankActiveQueue(items, FIFO).map((e) => e.position)).toEqual([1, 2, 3]);
  });
});

describe('ranking engine — out-of-order completion & positionOf', () => {
  const items = [
    item('MQ-1', { rankingTimestamp: at('2026-01-01T00:00:00Z') }),
    item('MQ-2', { rankingTimestamp: at('2026-01-02T00:00:00Z') }),
    item('MQ-3', { rankingTimestamp: at('2026-01-03T00:00:00Z') }),
  ];

  it('recomputes positions after a middle item is completed', () => {
    const remaining = items.map((i) =>
      i.permanentQueueId === 'MQ-2'
        ? item('MQ-2', { status: QueueStatus.Done, rankingTimestamp: i.rankingTimestamp })
        : i,
    );
    const ranked = rankActiveQueue(remaining, FIFO);
    expect(ids(ranked)).toEqual(['MQ-1', 'MQ-3']);
    expect(ranked.map((e) => e.position)).toEqual([1, 2]);
  });

  it('positionOf returns the active position and null for inactive items', () => {
    const same = (a: RankableItem, b: RankableItem): boolean =>
      a.permanentQueueId === b.permanentQueueId;
    expect(positionOf(items[2] as RankableItem, items, FIFO, same)).toBe(3);
    const done = item('MQ-9', { status: QueueStatus.Done });
    expect(positionOf(done, [...items, done], FIFO, same)).toBeNull();
  });
});
