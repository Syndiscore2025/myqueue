import {
  connectDatabase,
  disconnectDatabase,
  getPrisma,
} from '../../src/infrastructure/database/prisma';
import {
  NotificationService,
  FollowUpReminderService,
  DigestService,
  type Notifier,
  type NotificationMessage,
} from '../../src/application/notifications';
import { formatPermanentQueueId } from '../../src/infrastructure/repositories';
import { QueueEventType, QueuePriority, QueueStatus } from '../../src/domain/queue';

// Real-Postgres notification tests. They drive the Phase 5 DM paths end-to-end
// against a live database (items, settings, events, users) with a fake Notifier
// standing in for Slack, so delivery and audit writes are observable without a
// real workspace. Skipped unless RUN_INTEGRATION=true (CI / local dev datastore).
const describeIntegration = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

const WS = 'ws-notifications-test';
const USER_A = 'wu-notif-a';
const USER_B = 'wu-notif-b';
const prisma = getPrisma();

/** Records every DM the application layer hands the transport; never rejects. */
class RecordingNotifier implements Notifier {
  readonly sent: Array<{ slackUserId: string; message: NotificationMessage }> = [];
  constructor(private readonly deliver = true) {}
  dmUser(_ws: string, slackUserId: string, message: NotificationMessage): Promise<boolean> {
    if (this.deliver) this.sent.push({ slackUserId, message });
    return Promise.resolve(this.deliver);
  }
}

/** In-memory one-time guard mirroring the Redis idempotency contract. */
class MemoryDedupe {
  private readonly seen = new Set<string>();
  claim(key: string): Promise<boolean> {
    if (this.seen.has(key)) return Promise.resolve(false);
    this.seen.add(key);
    return Promise.resolve(true);
  }
}

let seq = 0;

/** Insert a queue item directly so follow-up/status fields can be set precisely. */
async function createItem(opts: {
  owner: string;
  status?: QueueStatus;
  followUpDueAt?: Date | null;
}): Promise<{ id: string; permanentQueueId: string }> {
  seq += 1;
  return prisma.queueItem.create({
    data: {
      workspaceId: WS,
      ownerWorkspaceUserId: opts.owner,
      permanentQueueId: formatPermanentQueueId(seq),
      title: `item-${seq}`,
      status: opts.status ?? QueueStatus.New,
      priority: QueuePriority.Green,
      rankingTimestamp: new Date(Date.now() + seq),
      followUpDueAt: opts.followUpDueAt ?? null,
    },
    select: { id: true, permanentQueueId: true },
  });
}

async function cleanQueue(): Promise<void> {
  await prisma.queueEvent.deleteMany({ where: { workspaceId: WS } });
  await prisma.queueItem.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspaceQueueSettings.deleteMany({ where: { workspaceId: WS } });
}

async function countNotified(): Promise<number> {
  return prisma.queueEvent.count({
    where: { workspaceId: WS, eventType: QueueEventType.NOTIFIED },
  });
}

describeIntegration('notification delivery', () => {
  beforeAll(async () => {
    await connectDatabase();
    await prisma.workspace.upsert({ where: { id: WS }, create: { id: WS }, update: {} });
    const users: ReadonlyArray<{ id: string; slackUserId: string }> = [
      { id: USER_A, slackUserId: 'U-notif-a' },
      { id: USER_B, slackUserId: 'U-notif-b' },
    ];
    for (const u of users) {
      await prisma.workspaceUser.upsert({
        where: { id: u.id },
        create: { id: u.id, workspaceId: WS, slackUserId: u.slackUserId },
        update: {},
      });
    }
  });

  afterAll(async () => {
    await cleanQueue();
    await prisma.workspaceUser.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await disconnectDatabase();
  });

  beforeEach(cleanQueue);

  describe('per-item notifications', () => {
    it('delivers an assignment DM and records a NOTIFIED audit event', async () => {
      const item = await createItem({ owner: USER_A });
      const notifier = new RecordingNotifier();
      const service = new NotificationService({ notifier });

      expect(await service.notifyAssignment(WS, item.id)).toBe(true);
      expect(notifier.sent).toHaveLength(1);
      expect(notifier.sent[0]?.slackUserId).toBe('U-notif-a');
      expect(notifier.sent[0]?.message.text).toContain(item.permanentQueueId);
      expect(await countNotified()).toBe(1);
    });

    it('respects a disabled preference: no DM, no audit event', async () => {
      const item = await createItem({ owner: USER_A });
      await prisma.workspaceQueueSettings.create({
        data: { workspaceId: WS, notifyOnAssignment: false },
      });
      const notifier = new RecordingNotifier();
      const service = new NotificationService({ notifier });

      expect(await service.notifyAssignment(WS, item.id)).toBe(false);
      expect(notifier.sent).toHaveLength(0);
      expect(await countNotified()).toBe(0);
    });

    it('delivers a snooze-wake DM for a reactivated item', async () => {
      const item = await createItem({ owner: USER_A });
      const notifier = new RecordingNotifier();
      const service = new NotificationService({ notifier });

      expect(await service.notifySnoozeWake(WS, item.id)).toBe(true);
      expect(notifier.sent[0]?.message.text).toContain('Snoozed');
      expect(await countNotified()).toBe(1);
    });
  });

  describe('follow-up reminder sweep', () => {
    it('reminds each due follow-up once and dedupes a repeat sweep', async () => {
      const past = new Date(Date.now() - 60_000);
      const item = await createItem({
        owner: USER_A,
        status: QueueStatus.FollowUp,
        followUpDueAt: past,
      });
      const notifier = new RecordingNotifier();
      const sweep = new FollowUpReminderService({
        notifier: new NotificationService({ notifier }),
        dedupe: new MemoryDedupe(),
      });

      // First sweep notifies once and records the NOTIFIED audit event...
      expect(await sweep.remindBatch(new Date())).toBe(1);
      expect(notifier.sent).toHaveLength(1);
      expect(notifier.sent[0]?.message.text).toContain(item.permanentQueueId);
      expect(await countNotified()).toBe(1);

      // ...and a second sweep over the still-due item sends nothing (dedupe).
      expect(await sweep.remindBatch(new Date())).toBe(0);
      expect(notifier.sent).toHaveLength(1);
      expect(await countNotified()).toBe(1);
    });
  });

  describe('daily digest sweep', () => {
    it('DMs each owner one grouped digest and dedupes within the day', async () => {
      // Two items for owner A, one for owner B → two digests, one DM each.
      await createItem({ owner: USER_A });
      await createItem({ owner: USER_A });
      await createItem({ owner: USER_B });
      const now = new Date();
      await prisma.workspaceQueueSettings.create({
        data: { workspaceId: WS, dailyDigestEnabled: true, dailyDigestHourUtc: now.getUTCHours() },
      });
      const notifier = new RecordingNotifier();
      const sweep = new DigestService({
        notifier: new NotificationService({ notifier }),
        dedupe: new MemoryDedupe(),
      });

      expect(await sweep.digestBatch(now)).toBe(2);
      const recipients = notifier.sent.map((s) => s.slackUserId).sort();
      expect(recipients).toEqual(['U-notif-a', 'U-notif-b']);
      expect(await countNotified()).toBe(2);

      // Re-running within the same UTC day is fully deduped: no extra DMs.
      expect(await sweep.digestBatch(now)).toBe(0);
      expect(notifier.sent).toHaveLength(2);
      expect(await countNotified()).toBe(2);
    });
  });
});
