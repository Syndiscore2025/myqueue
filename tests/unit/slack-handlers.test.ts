import type { App } from '@slack/bolt';

jest.mock('../../src/application/queue', () => ({
  queueService: {
    createItem: jest.fn(),
    createOrUpdateSlackAttention: jest.fn(),
    completeSlackAttentionGroup: jest.fn(),
    getActiveQueue: jest.fn(),
    getWorkingQueue: jest.fn(),
    getFollowUpQueue: jest.fn(),
    getWaitingQueue: jest.fn(),
    getSnoozedQueue: jest.fn(),
    getArchive: jest.fn(),
    changeStatus: jest.fn(),
    updatePriority: jest.fn(),
    moveToWaiting: jest.fn(),
    moveToFollowUp: jest.fn(),
    snooze: jest.fn(),
    complete: jest.fn(),
    archive: jest.fn(),
  },
}));

jest.mock('../../src/application/slack', () => ({
  slackIdentityService: { resolveContext: jest.fn() },
  slackIdempotencyService: { claim: jest.fn().mockResolvedValue(true) },
}));

import { queueService } from '../../src/application/queue';
import { slackIdempotencyService, slackIdentityService } from '../../src/application/slack';
import { QueuePriority, QueueStatus } from '../../src/domain/queue';
import { QueueView, SLACK_ACTION_IDS } from '../../src/interfaces/slack';
import { registerAppHome } from '../../src/interfaces/slack/handlers/app-home';
import { parseCommandView, registerCommands } from '../../src/interfaces/slack/handlers/commands';
import {
  buildMessagePermalink,
  buildMessageTitle,
  registerShortcuts,
} from '../../src/interfaces/slack/handlers/shortcuts';
import {
  classifyAttentionPriority,
  mentionedUserIds,
  registerMessageEvents,
} from '../../src/interfaces/slack/handlers/message-events';
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
    expect(ACTION_ID_TO_ITEM_ACTION[SLACK_ACTION_IDS.itemResolved]).toBe('complete');
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

  it('routes priority actions through queueService.updatePriority', async () => {
    mock(queueService.updatePriority).mockResolvedValue({ status: QueueStatus.New });

    await applyItemAction(ctx, 'priority_red', 'MQ-1');
    await applyItemAction(ctx, 'priority_yellow', 'MQ-2');
    await applyItemAction(ctx, 'priority_green', 'MQ-3');

    expect(queueService.updatePriority).toHaveBeenCalledWith(ctx, 'MQ-1', QueuePriority.Red);
    expect(queueService.updatePriority).toHaveBeenCalledWith(ctx, 'MQ-2', QueuePriority.Yellow);
    expect(queueService.updatePriority).toHaveBeenCalledWith(ctx, 'MQ-3', QueuePriority.Green);
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

  it('reports tokens are disabled when no AUTH_TOKEN_SECRET is configured', async () => {
    const ack = jest.fn();
    const respond = jest.fn();
    await capture()({ command: { text: 'token', user_id: 'U1' }, ack, respond, context: {} });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(slackIdentityService.resolveContext).not.toHaveBeenCalled();
    const reply = respond.mock.calls[0][0] as { text: string };
    expect(reply.text).toContain('not enabled');
  });
});

describe('buildMessageTitle', () => {
  it('uses the channel name without copying any message text', () => {
    expect(buildMessageTitle('deploys')).toBe('Slack message in #deploys');
  });

  it('falls back to a generic label when the channel name is unavailable', () => {
    expect(buildMessageTitle(undefined)).toBe('Slack message');
    expect(buildMessageTitle('')).toBe('Slack message');
  });
});

describe('buildMessagePermalink', () => {
  it('builds an archives permalink from metadata alone', () => {
    expect(buildMessagePermalink('acme', 'C1', '1700000000.000100')).toBe(
      'https://acme.slack.com/archives/C1/p1700000000000100',
    );
  });

  it('returns null when the team domain is missing', () => {
    expect(buildMessagePermalink(undefined, 'C1', '1700000000.000100')).toBeNull();
    expect(buildMessagePermalink('', 'C1', '1700000000.000100')).toBeNull();
  });
});

describe('mentionedUserIds', () => {
  it('extracts unique Slack user mentions from mrkdwn', () => {
    expect(mentionedUserIds('hi <@U1> and <@U2|Sarah> and <@U1>')).toEqual(['U1', 'U2']);
  });
});

describe('classifyAttentionPriority', () => {
  it('does not use punctuation to escalate a direct message', () => {
    expect(classifyAttentionPriority({ type: 'message', channel_type: 'im', text: 'routine update!!!' })).toBe(
      QueuePriority.Green,
    );
  });

  it('classifies blocked direct-message content as Red', () => {
    expect(
      classifyAttentionPriority({
        type: 'message',
        channel_type: 'im',
        text: "Bitty is asking for proof of ownership or they can't proceed!",
      }),
    ).toBe(QueuePriority.Red);
  });

  it('keeps channel mentions at least Yellow from mention context', () => {
    expect(classifyAttentionPriority({ type: 'message', channel_type: 'channel', text: 'hello <@U1>' })).toBe(
      QueuePriority.Yellow,
    );
  });
});

describe('registerMessageEvents', () => {
  type Handler = (args: unknown) => Promise<void>;
  function capture(): Handler {
    let handler: Handler | undefined;
    const app = {
      event: (_name: string, h: Handler) => {
        handler = h;
      },
    } as unknown as App;
    registerMessageEvents(app);
    return handler!;
  }

  it('auto-creates a name-only attention pointer for mentioned users', async () => {
    mock(slackIdentityService.resolveContext)
      .mockResolvedValueOnce({ workspaceId: 'w1', workspaceUserId: 'sender' })
      .mockResolvedValueOnce({ workspaceId: 'w1', workspaceUserId: 'owner' });
    mock(queueService.createOrUpdateSlackAttention).mockResolvedValue(item());
    const getPermalink = jest.fn().mockResolvedValue({
      permalink: 'https://acme.slack.com/archives/C1/p1700000000000100',
    });
    await capture()({
      event: {
        type: 'message',
        user: 'U_SENDER',
        channel: 'C1',
        ts: '1700000000.000100',
        text: 'please review this <@UOWNER>',
      },
      body: { event_id: 'Ev1' },
      context: { teamId: 'T1' },
      client: { chat: { getPermalink } },
    });
    expect(queueService.createOrUpdateSlackAttention).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'sender' },
      expect.objectContaining({
        title: 'Slack attention',
        ownerWorkspaceUserId: 'owner',
        priority: QueuePriority.Yellow,
        sourceType: 'SLACK_MESSAGE',
        sourceSlackChannelId: 'C1',
        sourceSlackUserId: 'U_SENDER',
        sourceSlackMessageTs: '1700000000.000100',
        sourceSlackPermalink: 'https://acme.slack.com/archives/C1/p1700000000000100',
      }),
      300000,
    );
  });

  it('auto-creates a name-only attention pointer for direct messages without mentions', async () => {
    mock(slackIdentityService.resolveContext)
      .mockResolvedValueOnce({ workspaceId: 'w1', workspaceUserId: 'sender' })
      .mockResolvedValueOnce({ workspaceId: 'w1', workspaceUserId: 'owner' });
    mock(queueService.createOrUpdateSlackAttention).mockResolvedValue(item());
    const members = jest.fn().mockResolvedValue({ members: ['U_SENDER', 'UOWNER'] });
    const getPermalink = jest.fn().mockResolvedValue({
      permalink: 'https://acme.slack.com/archives/D1/p1700000000000200',
    });
    await capture()({
      event: {
        type: 'message',
        channel_type: 'im',
        user: 'U_SENDER',
        channel: 'D1',
        ts: '1700000000.000200',
            text: 'are you there?',
      },
      body: { event_id: 'EvDM1' },
      context: { teamId: 'T1', userId: 'UOWNER', userToken: 'xoxp-test' },
      client: { conversations: { members }, chat: { getPermalink } },
    });
    expect(members).toHaveBeenCalledWith({ channel: 'D1', token: 'xoxp-test' });
    expect(queueService.createOrUpdateSlackAttention).toHaveBeenCalledWith(
      { workspaceId: 'w1', workspaceUserId: 'sender' },
      expect.objectContaining({
        ownerWorkspaceUserId: 'owner',
          priority: QueuePriority.Green,
        sourceSlackChannelId: 'D1',
        sourceSlackUserId: 'U_SENDER',
        sourceSlackMessageTs: '1700000000.000200',
        sourceSlackPermalink: 'https://acme.slack.com/archives/D1/p1700000000000200',
      }),
      300000,
    );
  });

  it('does not create a direct-message pointer for someone other than the authorized user', async () => {
    const members = jest.fn().mockResolvedValue({ members: ['U_SENDER', 'U_OTHER'] });
    await capture()({
      event: {
        type: 'message',
        channel_type: 'im',
        user: 'U_SENDER',
        channel: 'D1',
        ts: '1700000000.000300',
        text: 'outbound message',
      },
      body: { event_id: 'EvDM2' },
      context: { teamId: 'T1', userId: 'U_AUTHORIZED', userToken: 'xoxp-test' },
      client: { conversations: { members }, chat: { getPermalink: jest.fn() } },
    });
    expect(queueService.createOrUpdateSlackAttention).not.toHaveBeenCalled();
  });

  it('ignores non-mentioned channel messages because routing rules are not known yet', async () => {
    await capture()({
      event: { type: 'message', user: 'U1', channel: 'C1', ts: '1.0', text: 'hello team' },
      body: { event_id: 'Ev2' },
      context: { teamId: 'T1' },
      client: { chat: { getPermalink: jest.fn() } },
    });
    expect(queueService.createItem).not.toHaveBeenCalled();
    expect(queueService.createOrUpdateSlackAttention).not.toHaveBeenCalled();
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
    message_ts: '1700000000.000100',
    user: { id: 'U1' },
    channel: { id: 'C1', name: 'general' },
    team: { id: 'T1', domain: 'acme' },
    message: { ts: '1700000000.000100', user: 'U2', text: 'Ship the release' },
    ...over,
  });

  it('creates a SLACK_MESSAGE reference item without storing message text', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.createItem).mockResolvedValue(item());
    const ack = jest.fn();
    const open = jest.fn();
    await capture()({
      shortcut: messageShortcut(),
      ack,
      client: { views: { open } },
      context: { teamId: 'T1' },
    });
    expect(ack).toHaveBeenCalledTimes(1);
    const created = mock(queueService.createItem).mock.calls[0][1] as {
      sourceType: string;
      summary?: unknown;
      title: string;
      sourceSlackChannelId: string;
      sourceSlackUserId: string | null;
      sourceSlackMessageTs: string;
      sourceSlackThreadTs: string | null;
      sourceSlackPermalink: string;
    };
    expect(created.sourceType).toBe('SLACK_MESSAGE');
    // Privacy: the message body must never be persisted.
    expect(created.summary).toBeUndefined();
    expect(created.title).toBe('Slack message in #general');
    expect(created.sourceSlackChannelId).toBe('C1');
    expect(created.sourceSlackUserId).toBe('U2');
    expect(created.sourceSlackMessageTs).toBe('1700000000.000100');
    expect(created.sourceSlackThreadTs).toBeNull();
    expect(created.sourceSlackPermalink).toBe(
      'https://acme.slack.com/archives/C1/p1700000000000100',
    );
    const opened = open.mock.calls[0][0] as { view: { title: { text: string } } };
    expect(opened.view.title.text).toBe('Added to MyQueue');
  });

  it('captures the thread timestamp when the message is in a thread', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.createItem).mockResolvedValue(item());
    const ack = jest.fn();
    const open = jest.fn();
    await capture()({
      shortcut: messageShortcut({
        message: { ts: '1700000000.000100', thread_ts: '1699999999.000001' },
      }),
      ack,
      client: { views: { open } },
      context: { teamId: 'T1' },
    });
    const created = mock(queueService.createItem).mock.calls[0][1] as {
      sourceSlackThreadTs: string | null;
    };
    expect(created.sourceSlackThreadTs).toBe('1699999999.000001');
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

  it('skips creation on a duplicate retry delivery', async () => {
    mock(slackIdempotencyService.claim).mockResolvedValueOnce(false);
    const ack = jest.fn();
    const open = jest.fn();
    await capture()({
      shortcut: messageShortcut(),
      ack,
      client: { views: { open } },
      context: { teamId: 'T1' },
    });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(slackIdentityService.resolveContext).not.toHaveBeenCalled();
    expect(queueService.createItem).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
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
    expect(parseOverflowValue('priority_red:MQ-3')).toEqual({
      action: 'priority_red',
      permanentQueueId: 'MQ-3',
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

  it('clears the Slack attention group when Open chat is clicked', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.completeSlackAttentionGroup).mockResolvedValue(2);
    mock(queueService.getActiveQueue).mockResolvedValue([]);
    const ack = jest.fn();
    const publish = jest.fn();
    await capture().get(SLACK_ACTION_IDS.itemOpenChat)!({
      ack,
      body: homeBody,
      action: { value: 'MQ-1' },
      client: { views: { publish } },
      context: { teamId: 'T1' },
      respond: jest.fn(),
    });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(queueService.completeSlackAttentionGroup).toHaveBeenCalledWith(ctx, 'MQ-1');
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

  it('applies a priority overflow action then re-publishes the source view', async () => {
    mock(slackIdentityService.resolveContext).mockResolvedValue(ctx);
    mock(queueService.updatePriority).mockResolvedValue({ status: QueueStatus.New });
    mock(queueService.getActiveQueue).mockResolvedValue([]);
    const publish = jest.fn();
    await capture().get(SLACK_ACTION_IDS.itemOverflow)!({
      ack: jest.fn(),
      body: homeBody,
      action: { selected_option: { value: 'priority_red:MQ-1' } },
      client: { views: { publish } },
      context: { teamId: 'T1' },
      respond: jest.fn(),
    });
    expect(queueService.updatePriority).toHaveBeenCalledWith(ctx, 'MQ-1', QueuePriority.Red);
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
