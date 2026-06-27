import {
  DIGEST_DEDUPE_TTL_SECONDS,
  DigestService,
  type DigestServiceDeps,
} from '../../src/application/notifications';
import { QueuePriority, QueueRankingMode, QueueStatus } from '../../src/domain/queue';
import type { QueueItem } from '../../src/domain/queue';
import type {
  QueueItemRepository,
  WorkspaceQueueSettingsRepository,
} from '../../src/infrastructure/repositories';

const now = new Date('2026-06-01T13:00:00Z');
const dateKey = '2026-06-01';

interface Mocks {
  items: { listByWorkspace: jest.Mock };
  settings: { listDigestEnabledForHour: jest.Mock };
  notifier: { notifyDigest: jest.Mock };
  dedupe: { claim: jest.Mock };
}

function build(): { svc: DigestService; m: Mocks } {
  const m: Mocks = {
    items: { listByWorkspace: jest.fn().mockResolvedValue([]) },
    settings: { listDigestEnabledForHour: jest.fn().mockResolvedValue([]) },
    notifier: { notifyDigest: jest.fn().mockResolvedValue(true) },
    dedupe: { claim: jest.fn().mockResolvedValue(true) },
  };
  const deps: DigestServiceDeps = {
    items: m.items as unknown as QueueItemRepository,
    settings: m.settings as unknown as WorkspaceQueueSettingsRepository,
    notifier: m.notifier,
    dedupe: m.dedupe,
  };
  return { svc: new DigestService(deps), m };
}

function settingsRow(over: Record<string, unknown> = {}): unknown {
  return {
    workspaceId: 'w1',
    rankingMode: QueueRankingMode.FIFO,
    includeWorkingInActive: true,
    includeWaitingInActive: false,
    ...over,
  };
}

let seq = 0;
function item(owner: string, over: Partial<QueueItem> = {}): QueueItem {
  seq += 1;
  return {
    id: `id-${seq}`,
    permanentQueueId: `MQ-00000${seq}`,
    ownerWorkspaceUserId: owner,
    title: `Task ${seq}`,
    summary: null,
    status: QueueStatus.New,
    priority: QueuePriority.Green,
    rankingTimestamp: new Date(`2026-05-0${seq}T00:00:00Z`),
    availableAt: null,
    ...over,
  } as unknown as QueueItem;
}

describe('DigestService.digestBatch', () => {
  it('returns 0 and notifies nothing when no workspace is due this hour', async () => {
    const { svc, m } = build();

    const sent = await svc.digestBatch(now);

    expect(sent).toBe(0);
    expect(m.settings.listDigestEnabledForHour).toHaveBeenCalledWith(13);
    expect(m.items.listByWorkspace).not.toHaveBeenCalled();
    expect(m.notifier.notifyDigest).not.toHaveBeenCalled();
  });

  it('DMs each owner with active items, deduped per owner+day', async () => {
    const { svc, m } = build();
    m.settings.listDigestEnabledForHour.mockResolvedValue([settingsRow()]);
    m.items.listByWorkspace.mockResolvedValue([item('o1'), item('o1'), item('o2')]);

    const sent = await svc.digestBatch(now);

    expect(sent).toBe(2);
    expect(m.dedupe.claim).toHaveBeenCalledWith(
      `myqueue:digest:w1:o1:${dateKey}`,
      DIGEST_DEDUPE_TTL_SECONDS,
    );
    expect(m.dedupe.claim).toHaveBeenCalledWith(
      `myqueue:digest:w1:o2:${dateKey}`,
      DIGEST_DEDUPE_TTL_SECONDS,
    );
    expect(m.notifier.notifyDigest).toHaveBeenCalledTimes(2);
    const firstCall = m.notifier.notifyDigest.mock.calls[0] as [string, string, QueueItem[]];
    expect(firstCall[0]).toBe('w1');
    expect(firstCall[1]).toBe('o1');
    expect(firstCall[2]).toHaveLength(2);
  });

  it('skips owners whose only items are not in the active queue', async () => {
    const { svc, m } = build();
    m.settings.listDigestEnabledForHour.mockResolvedValue([settingsRow()]);
    // Waiting is excluded by includeWaitingInActive=false, so this owner is empty.
    m.items.listByWorkspace.mockResolvedValue([item('o1', { status: QueueStatus.Waiting })]);

    const sent = await svc.digestBatch(now);

    expect(sent).toBe(0);
    expect(m.dedupe.claim).not.toHaveBeenCalled();
    expect(m.notifier.notifyDigest).not.toHaveBeenCalled();
  });

  it('skips the DM when the dedupe key was already claimed', async () => {
    const { svc, m } = build();
    m.settings.listDigestEnabledForHour.mockResolvedValue([settingsRow()]);
    m.items.listByWorkspace.mockResolvedValue([item('o1')]);
    m.dedupe.claim.mockResolvedValue(false);

    const sent = await svc.digestBatch(now);

    expect(sent).toBe(0);
    expect(m.notifier.notifyDigest).not.toHaveBeenCalled();
  });

  it('ranks items by priority before sending when the workspace is PRIORITY mode', async () => {
    const { svc, m } = build();
    m.settings.listDigestEnabledForHour.mockResolvedValue([
      settingsRow({ rankingMode: QueueRankingMode.PRIORITY }),
    ]);
    const green = item('o1', { priority: QueuePriority.Green, permanentQueueId: 'MQ-GREEN' });
    const red = item('o1', { priority: QueuePriority.Red, permanentQueueId: 'MQ-RED' });
    m.items.listByWorkspace.mockResolvedValue([green, red]);

    await svc.digestBatch(now);

    const items = (m.notifier.notifyDigest.mock.calls[0] as [string, string, QueueItem[]])[2];
    expect(items.map((i) => i.permanentQueueId)).toEqual(['MQ-RED', 'MQ-GREEN']);
  });
});

describe('DigestService.start / stop', () => {
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
