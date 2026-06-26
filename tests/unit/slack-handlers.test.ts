import type { App } from '@slack/bolt';

jest.mock('../../src/application/queue', () => ({
  queueService: {
    getActiveQueue: jest.fn(),
    getWorkingQueue: jest.fn(),
    getFollowUpQueue: jest.fn(),
    getWaitingQueue: jest.fn(),
    getSnoozedQueue: jest.fn(),
    getArchive: jest.fn(),
    changeStatus: jest.fn(),
    moveToWaiting: jest.fn(),
    moveToFollowUp: jest.fn(),
    snooze: jest.fn(),
    complete: jest.fn(),
    archive: jest.fn(),
  },
}));

jest.mock('../../src/application/slack', () => ({
  slackIdentityService: { resolveContext: jest.fn() },
}));

import { queueService } from '../../src/application/queue';
import { slackIdentityService } from '../../src/application/slack';
import { QueuePriority, QueueStatus } from '../../src/domain/queue';
import { QueueView, SLACK_ACTION_IDS } from '../../src/interfaces/slack';
import { registerAppHome } from '../../src/interfaces/slack/handlers/app-home';
import {
  ACTION_ID_TO_ITEM_ACTION,
  applyItemAction,
  loadQueueView,
} from '../../src/interfaces/slack/handlers/queue-data';

const ctx = { workspaceId: 'w1', workspaceUserId: 'u1' };
const mock = (fn: unknown): jest.Mock => fn as jest.Mock;
const item = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  permanentQueueId: 'MQ-1',
  title: 'T',
  summary: null,
  priority: QueuePriority.Green,
  status: QueueStatus.New,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('loadQueueView', () => {
  it('maps the All view to the ranked active queue', async () => {
    mock(queueService.getActiveQueue).mockResolvedValue([{ item: item() }, { item: item() }]);
    const items = await loadQueueView(ctx, QueueView.All);
    expect(items).toHaveLength(2);
    expect(queueService.getActiveQueue).toHaveBeenCalledWith(ctx);
  });

  it('filters the active queue by colour for a priority view', async () => {
    mock(queueService.getActiveQueue).mockResolvedValue([
      { item: item({ priority: QueuePriority.Red, permanentQueueId: 'MQ-R' }) },
      { item: item({ priority: QueuePriority.Green }) },
    ]);
    const items = await loadQueueView(ctx, QueueView.Red);
    expect(items.map((i) => i.permanentQueueId)).toEqual(['MQ-R']);
  });

  it.each([
    [QueueView.Working, 'getWorkingQueue'],
    [QueueView.FollowUp, 'getFollowUpQueue'],
    [QueueView.Waiting, 'getWaitingQueue'],
    [QueueView.Snooze, 'getSnoozedQueue'],
    [QueueView.Archive, 'getArchive'],
  ] as const)('delegates the %s view to queueService.%s', async (view, method) => {
    mock(queueService[method]).mockResolvedValue([item()]);
    await loadQueueView(ctx, view);
    expect(queueService[method]).toHaveBeenCalledWith(ctx);
  });
});

describe('applyItemAction', () => {
  it('maps primary action ids to item actions', () => {
    expect(ACTION_ID_TO_ITEM_ACTION[SLACK_ACTION_IDS.itemWorking]).toBe('working');
    expect(ACTION_ID_TO_ITEM_ACTION[SLACK_ACTION_IDS.itemSnooze]).toBe('snooze');
  });

  it('routes each action through the matching service method', async () => {
    mock(queueService.changeStatus).mockResolvedValue({ status: QueueStatus.Working });
    mock(queueService.complete).mockResolvedValue({ status: QueueStatus.Done });
    mock(queueService.archive).mockResolvedValue({ status: QueueStatus.Archived });

    expect(await applyItemAction(ctx, 'working', 'MQ-1')).toBe(QueueStatus.Working);
    expect(queueService.changeStatus).toHaveBeenCalledWith(ctx, 'MQ-1', QueueStatus.Working);
    expect(await applyItemAction(ctx, 'complete', 'MQ-1')).toBe(QueueStatus.Done);
    expect(await applyItemAction(ctx, 'archive', 'MQ-1')).toBe(QueueStatus.Archived);
  });

  it('snoozes with a future default duration', async () => {
    mock(queueService.snooze).mockResolvedValue({ status: QueueStatus.Snoozed });
    await applyItemAction(ctx, 'snooze', 'MQ-1');
    const until = mock(queueService.snooze).mock.calls[0][2] as Date;
    expect(until.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('registerAppHome', () => {
  type Handler = (args: unknown) => Promise<void>;
  function capture(): Handler {
    let handler: Handler | undefined;
    const app = {
      event: (_name: string, h: Handler) => {
        handler = h;
      },
    } as unknown as App;
    registerAppHome(app);
    return handler!;
  }

  it('publishes the home view for the home tab', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.getActiveQueue).mockResolvedValue([]);
    const publish = jest.fn();
    await capture()({
      event: { tab: 'home', user: 'U1' },
      context: { teamId: 'T1' },
      client: { views: { publish } },
    });
    expect(publish).toHaveBeenCalledTimes(1);
    const arg = publish.mock.calls[0][0] as { user_id: string; view: { private_metadata: string } };
    expect(arg.user_id).toBe('U1');
    expect(arg.view.private_metadata).toBe(QueueView.All);
  });

  it('ignores the messages tab', async () => {
    const publish = jest.fn();
    await capture()({
      event: { tab: 'messages', user: 'U1' },
      context: {},
      client: { views: { publish } },
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('swallows errors so Bolt never sees a rejection', async () => {
    mock(slackIdentityService.resolveContext).mockRejectedValue(new Error('not installed'));
    const publish = jest.fn();
    await expect(
      capture()({
        event: { tab: 'home', user: 'U1' },
        context: {},
        client: { views: { publish } },
      }),
    ).resolves.toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });
});
