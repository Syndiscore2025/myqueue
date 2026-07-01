import type { App } from '@slack/bolt';
import { registerActions } from './handlers/actions';
import { registerAppHome } from './handlers/app-home';
import { registerCommands } from './handlers/commands';
import { registerMessageEvents } from './handlers/message-events';
import { registerShortcuts } from './handlers/shortcuts';

/**
 * Apps that have already had the MyQueue handlers attached. Registration is
 * idempotent so repeated `createApp()` calls (e.g. across tests) never bind the
 * same Bolt listener twice.
 */
const registered = new WeakSet<App>();

/**
 * Attach every MyQueue Slack listener (events, commands, shortcuts, actions) to a
 * Bolt {@link App}. This is the single composition point for the Slack interface
 * layer; the HTTP app assembly calls it after constructing the Bolt app.
 */
export function registerSlackHandlers(app: App): void {
  if (registered.has(app)) {
    return;
  }
  registered.add(app);

  registerAppHome(app);
  registerMessageEvents(app);
  registerCommands(app);
  registerShortcuts(app);
  registerActions(app);
}
