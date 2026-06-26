import type { App, Context } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { createLogger } from '../../../utils/logger';
import { QueueView } from '../constants';
import { buildAppHomeView } from '../views';
import { resolveContext } from './identity';
import { loadQueueView } from './queue-data';

const log = createLogger('slack-app-home');

/**
 * Publish a user's App Home (home tab) for the given view. Shared by the
 * `app_home_opened` event and the interactive navigation/action handlers so the
 * dashboard is rendered identically wherever it is refreshed.
 */
export async function publishHome(
  client: WebClient,
  context: Context,
  slackUserId: string,
  view: QueueView,
): Promise<void> {
  const ctx = await resolveContext(context, slackUserId);
  const items = await loadQueueView(ctx, view);
  await client.views.publish({ user_id: slackUserId, view: buildAppHomeView(view, items) });
}

/**
 * Register the `app_home_opened` listener. Only the home tab is rendered (Slack
 * also fires this for the messages tab). Errors are logged and swallowed so an
 * uninstalled or transiently failing tenant never surfaces a Bolt error.
 */
export function registerAppHome(app: App): void {
  app.event('app_home_opened', async ({ event, context, client }) => {
    if (event.tab !== 'home') {
      return;
    }
    try {
      await publishHome(client, context, event.user, QueueView.All);
    } catch (error) {
      log.error({ err: error, user: event.user }, 'failed to publish App Home');
    }
  });
}
