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

  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_SIGNING_SECRET: z.string().default(''),
  SLACK_STATE_SECRET: z.string().default(''),
  SLACK_APP_TOKEN: z.string().default(''),
  // Bot/user OAuth scopes requested during installation. Stored as CSV so the
  // requested scope set can be changed without code changes.
  SLACK_BOT_SCOPES: z
    .string()
    .default('commands,chat:write,users:read,team:read')
    .transform(splitCsv),
  SLACK_USER_SCOPES: z.string().default('').transform(splitCsv),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
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

  return parsed;
}
