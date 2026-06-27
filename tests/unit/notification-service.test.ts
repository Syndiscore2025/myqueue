import { NotificationService, type Notifier } from '../../src/application/notifications';
import { QueueEventType } from '../../src/domain/queue';
import type {
  QueueEventRepository,
  QueueItemRepository,
  WorkspaceQueueSettingsRepository,
  WorkspaceRepository,
} from '../../src/infrastructure/repositories';

const ITEM = {
  id: 'item-1',
  ownerWorkspaceUserId: 'owner-1',
  permanentQueueId: 'MQ-000001',
  title: 'Ship it',
  summary: null,
  priority: 'Green',
  followUpDueAt: null,
};

const ALL_ON = {
  notifyOnAssignment: true,
  notifyOnSnoozeWake: true,
  notifyOnFollowUpDue: true,
};

function build(): {
  svc: NotificationService;
  notifier: { dmUser: jest.Mock };
  items: { findById: jest.Mock };
  events: { record: jest.Mock };
  workspaces: { findUserById: jest.Mock };
  settings: { find: jest.Mock };
} {
  const notifier = { dmUser: jest.fn().mockResolvedValue(true) };
  const items = { findById: jest.fn().mockResolvedValue(ITEM) };
  const events = { record: jest.fn().mockResolvedValue({}) };
  const workspaces = { findUserById: jest.fn().mockResolvedValue({ slackUserId: 'U1' }) };
  const settings = { find: jest.fn().mockResolvedValue({ ...ALL_ON }) };
  const svc = new NotificationService({
    notifier: notifier as unknown as Notifier,
    items: items as unknown as QueueItemRepository,
    events: events as unknown as QueueEventRepository,
    workspaces: workspaces as unknown as WorkspaceRepository,
    settings: settings as unknown as WorkspaceQueueSettingsRepository,
  });
  return { svc, notifier, items, events, workspaces, settings };
}

describe('NotificationService', () => {
  it('delivers an assignment DM to the owner and records a NOTIFIED event', async () => {
    const { svc, notifier, events, items, workspaces } = build();

    await expect(svc.notifyAssignment('w1', 'item-1')).resolves.toBe(true);

    expect(items.findById).toHaveBeenCalledWith('w1', 'item-1');
    expect(workspaces.findUserById).toHaveBeenCalledWith('w1', 'owner-1');
    expect(notifier.dmUser).toHaveBeenCalledWith(
      'w1',
      'U1',
      expect.objectContaining({ text: expect.stringContaining('MQ-000001') }),
    );
    expect(events.record).toHaveBeenCalledWith({
      workspaceId: 'w1',
      eventType: QueueEventType.NOTIFIED,
      queueItemId: 'item-1',
      actorWorkspaceUserId: 'owner-1',
      metadata: { kind: 'assignment' },
    });
  });

  it('respects the per-workspace preference and skips a disabled kind', async () => {
    const { svc, notifier, events, settings } = build();
    settings.find.mockResolvedValue({ ...ALL_ON, notifyOnAssignment: false });

    await expect(svc.notifyAssignment('w1', 'item-1')).resolves.toBe(false);
    expect(notifier.dmUser).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('defaults to enabled when the workspace has no settings row yet', async () => {
    const { svc, notifier, settings } = build();
    settings.find.mockResolvedValue(null);

    await expect(svc.notifyAssignment('w1', 'item-1')).resolves.toBe(true);
    expect(notifier.dmUser).toHaveBeenCalled();
  });

  it('skips and never DMs when the item cannot be found', async () => {
    const { svc, notifier, items } = build();
    items.findById.mockResolvedValue(null);

    await expect(svc.notifyAssignment('w1', 'missing')).resolves.toBe(false);
    expect(notifier.dmUser).not.toHaveBeenCalled();
  });

  it('skips when the owner cannot be resolved to a Slack user', async () => {
    const { svc, notifier, workspaces } = build();
    workspaces.findUserById.mockResolvedValue(null);

    await expect(svc.notifyAssignment('w1', 'item-1')).resolves.toBe(false);
    expect(notifier.dmUser).not.toHaveBeenCalled();
  });

  it('does not record an event when delivery fails', async () => {
    const { svc, notifier, events } = build();
    notifier.dmUser.mockResolvedValue(false);

    await expect(svc.notifyAssignment('w1', 'item-1')).resolves.toBe(false);
    expect(events.record).not.toHaveBeenCalled();
  });

  it('gates snooze-wake on notifyOnSnoozeWake and tags the event kind', async () => {
    const { svc, events, settings, notifier } = build();
    settings.find.mockResolvedValue({ ...ALL_ON, notifyOnSnoozeWake: false });
    await expect(svc.notifySnoozeWake('w1', 'item-1')).resolves.toBe(false);
    expect(notifier.dmUser).not.toHaveBeenCalled();

    settings.find.mockResolvedValue({ ...ALL_ON });
    await expect(svc.notifySnoozeWake('w1', 'item-1')).resolves.toBe(true);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { kind: 'snooze-wake' } }),
    );
  });

  it('gates follow-up-due on notifyOnFollowUpDue', async () => {
    const { svc, notifier, settings } = build();
    settings.find.mockResolvedValue({ ...ALL_ON, notifyOnFollowUpDue: false });

    await expect(svc.notifyFollowUpDue('w1', 'item-1')).resolves.toBe(false);
    expect(notifier.dmUser).not.toHaveBeenCalled();
  });
});
