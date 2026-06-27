import {
  buildAssignmentMessage,
  buildDigestMessage,
  buildFollowUpDueMessage,
  buildSnoozeWakeMessage,
  type NotifiableItem,
} from '../../src/application/notifications';
import { QueuePriority } from '../../src/domain/queue';

function makeItem(over: Partial<NotifiableItem> = {}): NotifiableItem {
  return {
    permanentQueueId: 'MQ-000042',
    title: 'Review PR',
    summary: null,
    priority: QueuePriority.Red,
    followUpDueAt: null,
    ...over,
  };
}

/** Concatenate every mrkdwn string in a message's blocks for assertions. */
function blockText(blocks: unknown[] | undefined): string {
  return JSON.stringify(blocks ?? []);
}

describe('notification message builders', () => {
  it('builds an assignment message with a fallback text and item blocks', () => {
    const msg = buildAssignmentMessage(makeItem());

    expect(msg.text).toContain('MQ-000042');
    expect(msg.text).toContain('Review PR');
    const text = blockText(msg.blocks);
    expect(text).toContain('new item is on your queue');
    expect(text).toContain('🔴');
    expect(text).toContain('MQ-000042');
  });

  it('builds a snooze-wake message', () => {
    const msg = buildSnoozeWakeMessage(makeItem({ priority: QueuePriority.Yellow }));
    expect(msg.text).toContain('Snoozed item is back');
    expect(blockText(msg.blocks)).toContain('🟡');
  });

  it('includes the due time when a follow-up date is present', () => {
    const due = new Date('2026-07-01T15:00:00Z');
    const msg = buildFollowUpDueMessage(makeItem({ followUpDueAt: due }));

    const text = blockText(msg.blocks);
    expect(text).toContain('follow-up is due');
    expect(text).toContain(`<!date^${Math.floor(due.getTime() / 1000)}^`);
  });

  it('falls back to a plain label when no follow-up date is present', () => {
    const msg = buildFollowUpDueMessage(makeItem({ followUpDueAt: null }));
    const text = blockText(msg.blocks);
    expect(text).toContain('Follow Up');
    expect(text).not.toContain('<!date^');
  });

  it('escapes mrkdwn special characters in titles and summaries', () => {
    const msg = buildAssignmentMessage(makeItem({ title: 'A & B <c>', summary: '1 < 2' }));
    const text = blockText(msg.blocks);
    expect(text).toContain('A &amp; B &lt;c&gt;');
    expect(text).toContain('1 &lt; 2');
  });

  it('renders an empty-queue digest', () => {
    const msg = buildDigestMessage([]);
    expect(msg.text).toContain('your queue is clear');
    expect(blockText(msg.blocks)).toContain('clear');
  });

  it('lists items in the digest and notes the remainder beyond ten', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      makeItem({ permanentQueueId: `MQ-${i}`, title: `Item ${i}` }),
    );
    const msg = buildDigestMessage(items);

    expect(msg.text).toContain('12 items');
    const text = blockText(msg.blocks);
    expect(text).toContain('Item 0');
    expect(text).toContain('Item 9');
    expect(text).not.toContain('Item 10');
    expect(text).toContain('and 2 more');
  });
});
