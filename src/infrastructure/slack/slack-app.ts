import { App, ExpressReceiver, LogLevel, type InstallationQuery } from '@slack/bolt';
import { env } from '../../config';
import { createLogger } from '../../utils/logger';
import { SlackLoggerAdapter } from './logger-adapter';
import { prismaInstallationStore } from './installation-store';
import { prismaStateStore } from './state-store';

const log = createLogger('slack-app');

/** Canonical Slack surface endpoints, shared by the wiring, docs, and tests. */
export const SLACK_ENDPOINTS = {
  events: '/slack/events',
  install: '/slack/install',
  oauthRedirect: '/slack/oauth_redirect',
} as const;

/** A constructed Bolt application together with its Express receiver. */
export interface SlackApp {
  app: App;
  receiver: ExpressReceiver;
}

/** Translate our Pino log level into the Slack SDK's coarser scale. */
function toSlackLogLevel(level: string): LogLevel {
  switch (level) {
    case 'trace':
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    default:
      return LogLevel.ERROR;
  }
}

/**
 * Register the platform-level Slack listeners. Phase 2 deliberately ships no
 * business or message-processing logic — only the lifecycle handling required
 * to keep installations consistent (revoking a tenant when the app is removed)
 * and a global error sink routed through our structured logger.
 */
function registerListeners(app: App): void {
  app.event('app_uninstalled', async ({ context }) => {
    const query = {
      teamId: context.teamId,
      enterpriseId: context.enterpriseId,
      isEnterpriseInstall: context.isEnterpriseInstall ?? false,
    } as InstallationQuery<boolean>;
    await prismaInstallationStore.deleteInstallation(query);
    log.info(
      { teamId: context.teamId, enterpriseId: context.enterpriseId },
      'app_uninstalled: revoked tenant installation',
    );
  });

  app.error((error) => {
    log.error({ err: error }, 'unhandled Slack app error');
    return Promise.resolve();
  });
}

/**
 * Build the Bolt {@link App} and its {@link ExpressReceiver}. The receiver
 * exposes a router (events, install, oauth_redirect) that the HTTP layer mounts
 * ahead of the JSON body parser so Slack request signatures can be verified
 * against the raw body. OAuth installation/state persistence is delegated to the
 * Prisma-backed stores; tokens are encrypted at rest by the repository layer.
 */
export function createSlackApp(): SlackApp {
  const logLevel = toSlackLogLevel(env.LOG_LEVEL);

  const receiver = new ExpressReceiver({
    signingSecret: env.SLACK_SIGNING_SECRET,
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    stateSecret: env.SLACK_STATE_SECRET,
    scopes: env.SLACK_BOT_SCOPES,
    installationStore: prismaInstallationStore,
    redirectUri: `${env.APP_BASE_URL}${SLACK_ENDPOINTS.oauthRedirect}`,
    logger: new SlackLoggerAdapter(createLogger('slack-receiver')),
    logLevel,
    endpoints: { events: SLACK_ENDPOINTS.events },
    installerOptions: {
      stateStore: prismaStateStore,
      installPath: SLACK_ENDPOINTS.install,
      redirectUriPath: SLACK_ENDPOINTS.oauthRedirect,
      directInstall: true,
      ...(env.SLACK_USER_SCOPES.length > 0 ? { userScopes: env.SLACK_USER_SCOPES } : {}),
    },
  });

  const app = new App({
    receiver,
    logger: new SlackLoggerAdapter(createLogger('slack-bolt')),
    logLevel,
  });

  registerListeners(app);
  return { app, receiver };
}

let cached: SlackApp | null = null;

/**
 * Lazily construct and cache the process-wide Slack application. Callers must
 * ensure Slack is configured (see {@link slackConfigured}) before invoking; the
 * underlying SDK throws if credentials are absent.
 */
export function getSlackApp(): SlackApp {
  if (cached === null) {
    cached = createSlackApp();
  }
  return cached;
}
