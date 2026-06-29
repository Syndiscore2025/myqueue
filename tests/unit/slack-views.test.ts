import { QueuePriority, QueueStatus } from '../../src/domain/queue';
import {
  QueueView,
  SLACK_ACTION_IDS,
  SLACK_OVERFLOW_ACTIONS,
  isQueueView,
} from '../../src/interfaces/slack';
import {
  buildAppHomeView,
  buildQueueBlocks,
  escapeMrkdwn,
  itemActions,
  itemBlocks,
  type QueueItemView,
} from '../../src/interfaces/slack/views';

/** A QueueItemView fixture with sensible defaults, overridable per test. */
function makeItem(over: Partial<QueueItemView> = {}): QueueItemView {
  return {
    permanentQueueId: 'MQ-000001',
    title: 'Title',
    summary: null,
    priority: QueuePriority.Green,
    status: QueueStatus.New,
    ...over,
  };
}

describe('escapeMrkdwn', () => {
  it('escapes the three mrkdwn-special characters', () => {
    expect(escapeMrkdwn('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeMrkdwn('Ship the release')).toBe('Ship the release');
  });
});

describe('isQueueView', () => {
  it('accepts known views and rejects unknown strings', () => {
    expect(isQueueView('red')).toBe(true);
    expect(isQueueView(QueueView.Archive)).toBe(true);
    expect(isQueueView('nonsense')).toBe(false);
  });
});

describe('itemActions', () => {
  it('renders all primary actions plus an overflow for a New item', () => {
    const block = itemActions(makeItem({ status: QueueStatus.New }));
    expect(block).not.toBeNull();
    const ids = block!.elements.map((e) => e.type);
    expect(ids).toEqual(['button', 'button', 'button', 'button', 'button', 'overflow']);
    expect(block!.block_id).toBe('mq_item:MQ-000001');
  });

  it('gates primary buttons by the lifecycle state machine', () => {
    const block = itemActions(makeItem({ status: QueueStatus.Done }));
    expect(block).not.toBeNull();
    const buttons = block!.elements.filter((e) => e.type === 'button');
    expect(buttons.map((b) => (b as { action_id: string }).action_id)).toEqual([
      SLACK_ACTION_IDS.itemWorking,
    ]);
  });

  it('encodes the permanent id in button values and overflow option values', () => {
    const block = itemActions(makeItem({ status: QueueStatus.New, permanentQueueId: 'MQ-42' }));
    const first = block!.elements[0] as { value: string };
    expect(first.value).toBe('MQ-42');
    const overflow = block!.elements.find((e) => e.type === 'overflow') as {
      options: Array<{ value: string }>;
    };
    expect(overflow.options.map((o) => o.value)).toEqual([
      `${SLACK_OVERFLOW_ACTIONS.complete}:MQ-42`,
      `${SLACK_OVERFLOW_ACTIONS.archive}:MQ-42`,
    ]);
  });

  it('returns null for a terminal (Archived) item', () => {
    expect(itemActions(makeItem({ status: QueueStatus.Archived }))).toBeNull();
  });
});

describe('itemBlocks', () => {
  it('renders section + context without actions by default', () => {
    const blocks = itemBlocks(makeItem());
    expect(blocks.map((b) => b.type)).toEqual(['section', 'context']);
  });

  it('appends an actions block when withActions is set and a transition exists', () => {
    const blocks = itemBlocks(makeItem({ status: QueueStatus.New }), { withActions: true });
    expect(blocks.map((b) => b.type)).toEqual(['section', 'context', 'actions']);
  });

  it('omits the actions block for a terminal item even when requested', () => {
    const blocks = itemBlocks(makeItem({ status: QueueStatus.Archived }), { withActions: true });
    expect(blocks.map((b) => b.type)).toEqual(['section', 'context']);
  });

  it('escapes the title so injected mrkdwn is inert', () => {
    const [sectionBlock] = itemBlocks(makeItem({ title: '<b>x</b>' }));
    expect(JSON.stringify(sectionBlock)).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('links Slack-sourced items back to the original chat/message', () => {
    const blocks = itemBlocks(
      makeItem({
        sourceSlackChannelId: 'C123ABC',
        sourceSlackUserId: 'U123ABC',
        sourceSlackPermalink: 'https://acme.slack.com/archives/C123ABC/p1700000000000100',
      }),
    );
    expect(JSON.stringify(blocks[0])).toContain('<@U123ABC>');
    expect(JSON.stringify(blocks[1])).toContain('<#C123ABC>');
    expect(JSON.stringify(blocks[1])).toContain('<@U123ABC>');
    expect(blocks.map((b) => b.type)).toEqual(['section', 'context', 'actions']);
  });

  it('shows a burst message count without showing message text', () => {
    const blocks = itemBlocks(makeItem({ sourceSlackMessageCount: 3 }));
    expect(JSON.stringify(blocks[1])).toContain('3 messages');
  });

  it('does not render arbitrary external URLs as Open chat buttons', () => {
    const blocks = itemBlocks(makeItem({ sourceSlackPermalink: 'https://example.com/phish' }));
    expect(blocks.map((b) => b.type)).toEqual(['section', 'context']);
  });
});

describe('buildQueueBlocks', () => {
  it('renders header, two nav rows, divider, and an empty state when there are no items', () => {
    const blocks = buildQueueBlocks(QueueView.All, []);
    expect(blocks.map((b) => b.type)).toEqual([
      'header',
      'actions',
      'actions',
      'divider',
      'section',
    ]);
  });

  it('marks the active view nav button with primary styling', () => {
    const blocks = buildQueueBlocks(QueueView.Red, []) as Array<{
      elements?: Array<{ value: string; style?: string }>;
    }>;
    const priorityRow = blocks[1];
    const active = priorityRow?.elements?.find((e) => e.value === QueueView.Red);
    expect(active?.style).toBe('primary');
  });

  it('lists items separated by dividers with per-item actions', () => {
    const blocks = buildQueueBlocks(QueueView.All, [
      makeItem({ permanentQueueId: 'MQ-1' }),
      makeItem({ permanentQueueId: 'MQ-2' }),
    ]);
    const types = blocks.map((b) => b.type);
    expect(types).toContain('actions');
    expect(types.filter((t) => t === 'divider').length).toBe(2);
  });

  it('renders the Archive view read-only (no per-item actions)', () => {
    const blocks = buildQueueBlocks(QueueView.Archive, [
      makeItem({ status: QueueStatus.Archived }),
    ]);
    const itemActionBlocks = blocks.filter(
      (b) => b.type === 'actions' && (b as { block_id?: string }).block_id?.startsWith('mq_item:'),
    );
    expect(itemActionBlocks).toHaveLength(0);
  });
});

describe('buildAppHomeView', () => {
  it('wraps the queue blocks in a home view payload', () => {
    const view = buildAppHomeView(QueueView.All, []);
    expect(view.type).toBe('home');
    expect(view.blocks.length).toBeGreaterThan(0);
  });
});
