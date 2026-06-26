import type { App, ButtonAction, Context, OverflowAction, RespondFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { createLogger } from '../../../utils/logger';
import {
  QueueView,
  SLACK_ACTION_IDS,
  SLACK_OVERFLOW_ACTIONS,
  isQueueView,
  type SlackOverflowAction,
} from '../constants';
import { buildQueueBlocks } from '../views';
import { publishHome } from './app-home';
import { resolveContext } from './identity';
import {
  ACTION_ID_TO_ITEM_ACTION,
  applyItemAction,
  loadQueueView,
  type ItemAction,
} from './queue-data';

const log = createLogger('slack-actions');

/** The subset of a Bolt block-action body these handlers read. */
export interface ActionBody {
  user: { id: string };
  view?: { type?: string; private_metadata?: string };
}

/**
 * The {@link QueueView} the source surface is currently showing, read from the
 * App Home `private_metadata`. Defaults to the active queue when absent (e.g. an
 * action fired from an ephemeral slash-command reply, which carries no metadata).
 */
export function sourceView(body: ActionBody): QueueView {
  const meta = body.view?.private_metadata;
  return meta !== undefined && isQueueView(meta) ? meta : QueueView.All;
}

/**
 * Decode an overflow option value (`"<action>:<permanentQueueId>"`) into its
 * parts, or `null` when malformed or carrying an unknown action.
 */
export function parseOverflowValue(
  value: string,
): { action: SlackOverflowAction; permanentQueueId: string } | null {
  const sep = value.indexOf(':');
  if (sep === -1) {
    return null;
  }
  const action = value.slice(0, sep);
  const permanentQueueId = value.slice(sep + 1);
  if (permanentQueueId.length === 0) {
    return null;
  }
  if (action === SLACK_OVERFLOW_ACTIONS.complete || action === SLACK_OVERFLOW_ACTIONS.archive) {
    return { action, permanentQueueId };
  }
  return null;
}

/**
 * Re-render a view on whichever surface the action came from: the App Home tab is
 * re-published, while an ephemeral slash-command reply is replaced in place.
 */
async function rerender(
  client: WebClient,
  context: Context,
  body: ActionBody,
  respond: RespondFn,
  view: QueueView,
): Promise<void> {
  if (body.view?.type === 'home') {
    await publishHome(client, context, body.user.id, view);
    return;
  }
  const ctx = await resolveContext(context, body.user.id);
  const items = await loadQueueView(ctx, view);
  await respond({ replace_original: true, blocks: buildQueueBlocks(view, items) });
}

/** Switch to (or refresh) the view named by a navigation button's value. */
export async function handleNavigate(
  client: WebClient,
  context: Context,
  body: ActionBody,
  respond: RespondFn,
  value: string | undefined,
): Promise<void> {
  const view = value !== undefined && isQueueView(value) ? value : QueueView.All;
  try {
    await rerender(client, context, body, respond, view);
  } catch (error) {
    log.error({ err: error, user: body.user.id, view }, 'failed to navigate queue view');
  }
}

/** Apply a single-item lifecycle action, then re-render the source view. */
export async function applyAndRerender(
  client: WebClient,
  context: Context,
  body: ActionBody,
  respond: RespondFn,
  action: ItemAction,
  permanentQueueId: string,
): Promise<void> {
  const view = sourceView(body);
  try {
    const ctx = await resolveContext(context, body.user.id);
    await applyItemAction(ctx, action, permanentQueueId);
    await rerender(client, context, body, respond, view);
  } catch (error) {
    log.error(
      { err: error, user: body.user.id, action, item: permanentQueueId },
      'failed item action',
    );
  }
}

/** Register navigation, primary item-action, and overflow listeners. */
export function registerActions(app: App): void {
  const navigate = async ({
    ack,
    body,
    client,
    context,
    respond,
    action,
  }: ActionArgs): Promise<void> => {
    await ack();
    await handleNavigate(client, context, body, respond, (action as ButtonAction).value);
  };
  app.action(SLACK_ACTION_IDS.selectView, navigate);
  app.action(SLACK_ACTION_IDS.refresh, navigate);

  for (const [actionId, itemAction] of Object.entries(ACTION_ID_TO_ITEM_ACTION)) {
    app.action(actionId, async ({ ack, body, client, context, respond, action }: ActionArgs) => {
      await ack();
      const value = (action as ButtonAction).value;
      if (value !== undefined) {
        await applyAndRerender(client, context, body, respond, itemAction, value);
      }
    });
  }

  app.action(
    SLACK_ACTION_IDS.itemOverflow,
    async ({ ack, body, client, context, respond, action }: ActionArgs) => {
      await ack();
      const parsed = parseOverflowValue((action as OverflowAction).selected_option.value);
      if (parsed !== null) {
        await applyAndRerender(
          client,
          context,
          body,
          respond,
          parsed.action,
          parsed.permanentQueueId,
        );
      }
    },
  );
}

/** The subset of Bolt block-action middleware args these listeners consume. */
interface ActionArgs {
  ack: () => Promise<void>;
  body: ActionBody;
  client: WebClient;
  context: Context;
  respond: RespondFn;
  action: unknown;
}
