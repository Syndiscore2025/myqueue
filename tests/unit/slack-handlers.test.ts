import type { App } from '@slack/bolt';

jest.mock('../../src/application/queue', () => ({
  queueService: {
    createItem: jest.fn(),
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
import { parseCommandView, registerCommands } from '../../src/interfaces/slack/handlers/commands';
import { deriveTitle, registerShortcuts } from '../../src/interfaces/slack/handlers/shortcuts';
import {
  parseOverflowValue,
  registerActions,
  sourceView,
} from '../../src/interfaces/slack/handlers/actions';
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

describe('parseCommandView', () => {
  it.each([
    ['', QueueView.All],
    ['  ', QueueView.All],
    ['ALL', QueueView.All],
    ['red', QueueView.Red],
    ['working', QueueView.Working],
    ['follow up', QueueView.FollowUp],
    ['follow-up', QueueView.FollowUp],
    ['snoozed', QueueView.Snooze],
    ['archived', QueueView.Archive],
  ])('maps %p to the %s view', (text, view) => {
    expect(parseCommandView(text)).toBe(view);
  });

  it('returns null for unknown arguments and help', () => {
    expect(parseCommandView('help')).toBeNull();
    expect(parseCommandView('nonsense')).toBeNull();
  });
});

describe('registerCommands', () => {
  type Handler = (args: unknown) => Promise<void>;
  function capture(): Handler {
    let handler: Handler | undefined;
    const app = {
      command: (_name: string, h: Handler) => {
        handler = h;
      },
    } as unknown as App;
    registerCommands(app);
    return handler!;
  }

  it('acks then replies ephemerally with the requested view', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.getWorkingQueue).mockResolvedValue([item()]);
    const ack = jest.fn();
    const respond = jest.fn();
    await capture()({
      command: { text: 'working', user_id: 'U1' },
      ack,
      respond,
      context: { teamId: 'T1' },
    });
    expect(ack).toHaveBeenCalledTimes(1);
    const reply = respond.mock.calls[0][0] as { response_type: string; blocks: unknown[] };
    expect(reply.response_type).toBe('ephemeral');
    expect(reply.blocks.length).toBeGreaterThan(0);
    expect(queueService.getWorkingQueue).toHaveBeenCalledWith(ctx);
  });

  it('replies with the help hint for an unknown argument', async () => {
    const ack = jest.fn();
    const respond = jest.fn();
    await capture()({ command: { text: 'help', user_id: 'U1' }, ack, respond, context: {} });
    expect(slackIdentityService.resolveContext).not.toHaveBeenCalled();
    const reply = respond.mock.calls[0][0] as { text: string };
    expect(reply.text).toBe('MyQueue help');
  });

  it('reports an ephemeral error when the workspace is not installed', async () => {
    mock(slackIdentityService.resolveContext).mockRejectedValue(new Error('not installed'));
    const ack = jest.fn();
    const respond = jest.fn();
    await capture()({ command: { text: 'all', user_id: 'U1' }, ack, respond, context: {} });
    expect(ack).toHaveBeenCalledTimes(1);
    const reply = respond.mock.calls[0][0] as { text: string };
    expect(reply.text).toContain('Could not load your queue');
  });
});

describe('deriveTitle', () => {
  it('uses the first non-empty line', () => {
    expect(deriveTitle('  \n\nReview the deploy\nmore text')).toBe('Review the deploy');
  });

  it('falls back when the message has no text', () => {
    expect(deriveTitle('   \n  ')).toBe('Slack message');
  });

  it('truncates very long titles with an ellipsis', () => {
    const title = deriveTitle('x'.repeat(500));
    expect(title.length).toBe(200);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('registerShortcuts', () => {
  type Handler = (args: unknown) => Promise<void>;
  function capture(): Handler {
    let handler: Handler | undefined;
    const app = {
      shortcut: (_id: string, h: Handler) => {
        handler = h;
      },
    } as unknown as App;
    registerShortcuts(app);
    return handler!;
  }

  const messageShortcut = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'message_action',
    trigger_id: 'TRIG',
    user: { id: 'U1' },
    message: { text: 'Ship the release' },
    ...over,
  });

  it('creates a SLACK_MESSAGE item and opens the confirmation modal', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.createItem).mockResolvedValue(item({ title: 'Ship the release' }));
    const ack = jest.fn();
    const open = jest.fn();
    await capture()({
      shortcut: messageShortcut(),
      ack,
      client: { views: { open } },
      context: { teamId: 'T1' },
    });
    expect(ack).toHaveBeenCalledTimes(1);
    const created = mock(queueService.createItem).mock.calls[0][1] as { sourceType: string };
    expect(created.sourceType).toBe('SLACK_MESSAGE');
    const opened = open.mock.calls[0][0] as { view: { title: { text: string } } };
    expect(opened.view.title.text).toBe('Added to MyQueue');
  });

  it('opens a notice modal when creation fails', async () => {
    mock(slackIdentityService.resolveContext).mockRejectedValue(new Error('not installed'));
    const ack = jest.fn();
    const open = jest.fn();
    await capture()({
      shortcut: messageShortcut(),
      ack,
      client: { views: { open } },
      context: {},
    });
    const opened = open.mock.calls[0][0] as { view: { title: { text: string } } };
    expect(opened.view.title.text).toBe('MyQueue');
    expect(queueService.createItem).not.toHaveBeenCalled();
  });
});

describe('parseOverflowValue', () => {
  it('decodes a complete/archive option value', () => {
    expect(parseOverflowValue('complete:MQ-1')).toEqual({
      action: 'complete',
      permanentQueueId: 'MQ-1',
    });
    expect(parseOverflowValue('archive:MQ-2')).toEqual({
      action: 'archive',
      permanentQueueId: 'MQ-2',
    });
  });

  it('rejects malformed or unknown values', () => {
    expect(parseOverflowValue('MQ-1')).toBeNull();
    expect(parseOverflowValue('complete:')).toBeNull();
    expect(parseOverflowValue('snooze:MQ-1')).toBeNull();
  });
});

describe('sourceView', () => {
  it('reads the current view from the home private_metadata', () => {
    expect(sourceView({ user: { id: 'U1' }, view: { private_metadata: QueueView.Working } })).toBe(
      QueueView.Working,
    );
  });

  it('defaults to the active queue when metadata is absent or invalid', () => {
    expect(sourceView({ user: { id: 'U1' } })).toBe(QueueView.All);
    expect(sourceView({ user: { id: 'U1' }, view: { private_metadata: 'bogus' } })).toBe(
      QueueView.All,
    );
  });
});

describe('registerActions', () => {
  type Handler = (args: unknown) => Promise<void>;
  function capture(): Map<string, Handler> {
    const handlers = new Map<string, Handler>();
    const app = {
      action: (id: string, h: Handler) => {
        handlers.set(id, h);
      },
    } as unknown as App;
    registerActions(app);
    return handlers;
  }

  const homeBody = { user: { id: 'U1' }, view: { type: 'home', private_metadata: QueueView.All } };

  it('navigates the App Home to the selected view', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.getWorkingQueue).mockResolvedValue([item()]);
    const publish = jest.fn();
    const ack = jest.fn();
    await capture().get(SLACK_ACTION_IDS.selectView)!({
      ack,
      body: homeBody,
      action: { value: QueueView.Working },
      client: { views: { publish } },
      context: { teamId: 'T1' },
      respond: jest.fn(),
    });
    expect(ack).toHaveBeenCalledTimes(1);
    const arg = publish.mock.calls[0][0] as { view: { private_metadata: string } };
    expect(arg.view.private_metadata).toBe(QueueView.Working);
  });

  it('applies a primary item action then re-publishes the source view', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.changeStatus).mockResolvedValue({ status: QueueStatus.Working });
    mock(queueService.getActiveQueue).mockResolvedValue([]);
    const publish = jest.fn();
    await capture().get(SLACK_ACTION_IDS.itemWorking)!({
      ack: jest.fn(),
      body: homeBody,
      action: { value: 'MQ-1' },
      client: { views: { publish } },
      context: { teamId: 'T1' },
      respond: jest.fn(),
    });
    expect(queueService.changeStatus).toHaveBeenCalledWith(ctx, 'MQ-1', QueueStatus.Working);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('applies an overflow action from its encoded value', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.complete).mockResolvedValue({ status: QueueStatus.Done });
    mock(queueService.getActiveQueue).mockResolvedValue([]);
    const publish = jest.fn();
    await capture().get(SLACK_ACTION_IDS.itemOverflow)!({
      ack: jest.fn(),
      body: homeBody,
      action: { selected_option: { value: 'complete:MQ-1' } },
      client: { views: { publish } },
      context: { teamId: 'T1' },
      respond: jest.fn(),
    });
    expect(queueService.complete).toHaveBeenCalledWith(ctx, 'MQ-1');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('replaces the ephemeral reply when the action is off the home tab', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.getActiveQueue).mockResolvedValue([]);
    const respond = jest.fn();
    await capture().get(SLACK_ACTION_IDS.refresh)!({
      ack: jest.fn(),
      body: { user: { id: 'U1' } },
      action: { value: QueueView.All },
      client: { views: { publish: jest.fn() } },
      context: { teamId: 'T1' },
      respond,
    });
    const reply = respond.mock.calls[0][0] as { replace_original: boolean; blocks: unknown[] };
    expect(reply.replace_original).toBe(true);
    expect(reply.blocks.length).toBeGreaterThan(0);
  });
});
