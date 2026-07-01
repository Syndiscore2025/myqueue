import { z } from 'zod';

/**
 * Canonical environment schema for MyQueue.
 *
 * Every process (API, workers, scripts) validates its configuration through
 * this schema at startup. Validation failures are fatal by design: the
 * application must never run with a partially-configured environment.
 */
const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Split a comma-separated string into a trimmed, non-empty list. */
function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  CORS_ORIGINS: z.string().default('*').transform(splitCsv),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  TRUST_PROXY: booleanFromString.default('false'),

  // --- API authentication (Phase 7) ---
  // Shared secret used to sign/verify HS256 bearer tokens for the HTTP API.
  // Tokens are minted from a verified Slack identity (see the `/myqueue token`
  // command). Defaults empty so the app boots without it in development, where
  // the guards fall back to explicit headers; it is mandatory in production.
  AUTH_TOKEN_SECRET: z.string().default(''),
  // Lifetime, in seconds, of a minted bearer token before it must be refreshed.
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // --- Queue processing & worker infrastructure (Phase 3B) ---
  // How long a worker's claim/lock on an item is held before it is considered
  // expired and eligible for recovery.
  QUEUE_LOCK_MINUTES: z.coerce.number().int().positive().default(5),
  // How often workers refresh their lease via the heartbeat endpoint.
  QUEUE_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(30),
  // Maximum number of expired locks the recovery sweep reclaims per batch.
  QUEUE_RECOVERY_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  // Total attempts allowed before an item is moved to the Dead Letter Queue.
  QUEUE_MAX_RETRIES: z.coerce.number().int().positive().default(3),
  // Interval, in seconds, between background recovery sweeps.
  QUEUE_RECOVERY_INTERVAL: z.coerce.number().int().positive().default(60),

  // --- Queue scheduling & orchestration (Phase 3C) ---
  // Interval, in seconds, between scheduler activation sweeps. The scheduler
  // wakes delayed/scheduled/snoozed/unblocked items whose available_at <= now().
  QUEUE_SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  // Maximum items the activation sweep moves to claimable state per tick.
  QUEUE_ACTIVATION_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  // Maximum recurring rules the recurrence sweep processes per tick.
  QUEUE_RECURRENCE_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  // Default sliding-window duration (seconds) for a rate-limit bucket when not
  // specified at item creation time.
  QUEUE_RATE_LIMIT_DEFAULT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Default max items allowed per window for a rate-limit bucket when not
  // specified at item creation time.
  QUEUE_RATE_LIMIT_DEFAULT_MAX_ITEMS: z.coerce.number().int().positive().default(100),

  // --- Automation & notifications (Phase 5) ---
  // Interval, in seconds, between follow-up reminder sweeps. The sweep DMs the
  // owner of each FollowUp item whose follow_up_due_at <= now().
  QUEUE_FOLLOW_UP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  // Maximum due follow-ups the reminder sweep processes per tick.
  QUEUE_FOLLOW_UP_BATCH_SIZE: z.coerce.number().int().positive().default(200),
  // Interval, in seconds, between daily-digest sweeps. Each sweep DMs a queue
  // summary to owners in workspaces whose dailyDigestHourUtc equals the current
  // UTC hour; a per-owner/day idempotency key keeps it to one digest per day.
  QUEUE_DIGEST_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),

  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_SIGNING_SECRET: z.string().default(''),
  SLACK_STATE_SECRET: z.string().default(''),
  SLACK_APP_TOKEN: z.string().default(''),
  // Bot/user OAuth scopes requested during installation. Stored as CSV so the
  // requested scope set can be changed without code changes. `im:write` lets the
  // notifier open DM channels; `im:read`/`im:history` let MyQueue capture
  // metadata-only attention pointers from personal DMs the installer authorizes.
  SLACK_BOT_SCOPES: z
    .string()
    .default(
      'commands,chat:write,im:write,im:read,users:read,team:read,channels:read,channels:history,groups:read,groups:history,mpim:read,mpim:history,im:history',
    )
    .transform(splitCsv),
  SLACK_USER_SCOPES: z.string().default('im:read,im:history').transform(splitCsv),

  // --- Billing (Phase 6) ---
  // Stripe secret API key and webhook signing secret. Both default empty so the
  // app boots without billing configured (the billing surface is then disabled,
  // mirroring the Slack-optional pattern). Stripe price ids map each purchasable
  // plan to its recurring price; the return URLs are where Stripe sends the user
  // after Checkout or the billing portal.
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_PRO: z.string().default(''),
  STRIPE_PRICE_BUSINESS: z.string().default(''),
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().default(''),
  STRIPE_CHECKOUT_CANCEL_URL: z.string().default(''),
  STRIPE_PORTAL_RETURN_URL: z.string().default(''),
});

/** Slack OAuth credentials required for the installation flow to operate. */
const REQUIRED_SLACK_KEYS = [
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'SLACK_STATE_SECRET',
] as const;

/**
 * Whether every Slack credential needed to run the OAuth/install flow is
 * present. When false, the Slack surface is not mounted (e.g. local infra-only
 * development) but the rest of the application still boots.
 */
export function isSlackConfigured(source: Env): boolean {
  return REQUIRED_SLACK_KEYS.every((key) => source[key].length > 0);
}

/** Stripe credentials required for the billing surface to operate. */
const REQUIRED_STRIPE_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

/**
 * Whether the core Stripe credentials needed to run checkout and verify webhooks
 * are present. When false, the billing surface is not mounted but the rest of the
 * application still boots, mirroring {@link isSlackConfigured}.
 */
export function isBillingConfigured(source: Env): boolean {
  return REQUIRED_STRIPE_KEYS.every((key) => source[key].length > 0);
}

/** Minimum AUTH_TOKEN_SECRET length (bytes) accepted for HS256 signing. */
const MIN_AUTH_TOKEN_SECRET_BYTES = 32;

/**
 * Whether a usable API-token secret is present. When false, bearer-token auth is
 * inactive and the HTTP guards rely on their development header fallback (which
 * is itself disabled in production, where the secret is mandatory).
 */
export function isAuthConfigured(source: Env): boolean {
  return source.AUTH_TOKEN_SECRET.length >= MIN_AUTH_TOKEN_SECRET_BYTES;
}

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate an environment record. Throws a descriptive error listing
 * every invalid or missing variable when validation fails.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const parsed = result.data;

  // Slack credentials are mandatory in production: the platform cannot serve
  // its OAuth/install surface without them.
  if (parsed.NODE_ENV === 'production' && !isSlackConfigured(parsed)) {
    const missing = REQUIRED_SLACK_KEYS.filter((key) => parsed[key].length === 0);
    throw new Error(
      `Invalid environment configuration:\n  - Slack credentials are required in production. Missing: ${missing.join(', ')}`,
    );
  }

  // A strong API-token secret is mandatory in production: without it, bearer
  // tokens cannot be verified and the development header fallback is disabled,
  // leaving the HTTP API unauthenticated and unusable.
  if (parsed.NODE_ENV === 'production' && !isAuthConfigured(parsed)) {
    throw new Error(
      `Invalid environment configuration:\n  - AUTH_TOKEN_SECRET is required in production ` +
        `and must be at least ${MIN_AUTH_TOKEN_SECRET_BYTES} characters.`,
    );
  }

  return parsed;
}
