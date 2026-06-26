import type { App, RespondFn, SlackCommandMiddlewareArgs } from '@slack/bolt';
import { createLogger } from '../../../utils/logger';
import { QueueView, SLACK_COMMANDS } from '../constants';
import { buildQueueBlocks, section } from '../views';
import { resolveContext } from './identity';
import { loadQueueView } from './queue-data';

const log = createLogger('slack-commands');

/**
 * Text aliases the `/myqueue` command accepts, mapped to the {@link QueueView}
 * they open. An empty argument (bare `/myqueue`) opens the full active queue.
 * Anything not listed here falls through to the help response.
 */
const VIEW_ALIASES: Readonly<Record<string, QueueView>> = {
  '': QueueView.All,
  all: QueueView.All,
  home: QueueView.All,
  list: QueueView.All,
  red: QueueView.Red,
  yellow: QueueView.Yellow,
  green: QueueView.Green,
  working: QueueView.Working,
  followup: QueueView.FollowUp,
  'follow-up': QueueView.FollowUp,
  'follow up': QueueView.FollowUp,
  waiting: QueueView.Waiting,
  snooze: QueueView.Snooze,
  snoozed: QueueView.Snooze,
  archive: QueueView.Archive,
  archived: QueueView.Archive,
};

/**
 * Resolve the raw slash-command argument to a {@link QueueView}, or `null` when
 * it is unrecognised (including the explicit `help`) so the caller can render the
 * usage hint. Whitespace is collapsed and matching is case-insensitive.
 */
export function parseCommandView(text: string): QueueView | null {
  const normalised = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return VIEW_ALIASES[normalised] ?? null;
}

/** Block Kit usage hint listing the views `/myqueue` can open. */
export function helpBlocks(): ReturnType<typeof section>[] {
  return [
    section(
      [
        '*MyQueue commands*',
        '`/myqueue` — your active queue',
        '`/myqueue red|yellow|green` — by priority',
        '`/myqueue working|follow-up|waiting|snoozed|archive` — by status',
      ].join('\n'),
    ),
  ];
}

/**
 * Handle one `/myqueue` invocation: ack immediately (Slack's 3s budget), then
 * reply ephemerally with the requested view's Block Kit, or the help hint when
 * the argument is unrecognised. Errors are logged and reported ephemerally so a
 * failure never leaves the user without feedback.
 */
async function handleCommand(
  args: SlackCommandMiddlewareArgs['command'],
  respond: RespondFn,
  context: Parameters<typeof resolveContext>[0],
): Promise<void> {
  const view = parseCommandView(args.text);
  if (view === null) {
    await respond({ response_type: 'ephemeral', text: 'MyQueue help', blocks: helpBlocks() });
    return;
  }
  try {
    const ctx = await resolveContext(context, args.user_id);
    const items = await loadQueueView(ctx, view);
    await respond({
      response_type: 'ephemeral',
      text: `MyQueue · ${view}`,
      blocks: buildQueueBlocks(view, items),
    });
  } catch (error) {
    log.error({ err: error, user: args.user_id, view }, 'failed to handle /myqueue');
    await respond({
      response_type: 'ephemeral',
      text: 'Could not load your queue. Make sure MyQueue is installed for this workspace.',
    });
  }
}

/** Register the `/myqueue` slash command listener. */
export function registerCommands(app: App): void {
  app.command(SLACK_COMMANDS.myqueue, async ({ command, ack, respond, context }) => {
    await ack();
    await handleCommand(command, respond, context);
  });
}
