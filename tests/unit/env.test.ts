import { isSlackConfigured, parseEnv } from '../../src/config/env';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0'.repeat(64),
};

const slackEnv: NodeJS.ProcessEnv = {
  SLACK_CLIENT_ID: 'client-id',
  SLACK_CLIENT_SECRET: 'client-secret',
  SLACK_SIGNING_SECRET: 'signing-secret',
  SLACK_STATE_SECRET: 'state-secret',
};

describe('environment validation', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = parseEnv(validEnv);
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.RATE_LIMIT_MAX).toBe(100);
    expect(env.CORS_ORIGINS).toEqual(['*']);
    expect(env.QUEUE_LOCK_MINUTES).toBe(5);
    expect(env.QUEUE_HEARTBEAT_SECONDS).toBe(30);
    expect(env.QUEUE_RECOVERY_BATCH_SIZE).toBe(100);
    expect(env.QUEUE_MAX_RETRIES).toBe(3);
    expect(env.QUEUE_RECOVERY_INTERVAL).toBe(60);
  });

  it('coerces the Phase 3B queue-processing variables', () => {
    const env = parseEnv({
      ...validEnv,
      QUEUE_LOCK_MINUTES: '10',
      QUEUE_HEARTBEAT_SECONDS: '15',
      QUEUE_RECOVERY_BATCH_SIZE: '250',
      QUEUE_MAX_RETRIES: '5',
      QUEUE_RECOVERY_INTERVAL: '120',
    });
    expect(env.QUEUE_LOCK_MINUTES).toBe(10);
    expect(env.QUEUE_HEARTBEAT_SECONDS).toBe(15);
    expect(env.QUEUE_RECOVERY_BATCH_SIZE).toBe(250);
    expect(env.QUEUE_MAX_RETRIES).toBe(5);
    expect(env.QUEUE_RECOVERY_INTERVAL).toBe(120);
  });

  it('coerces numeric and boolean strings', () => {
    const env = parseEnv({ ...validEnv, PORT: '8080', TRUST_PROXY: 'true' });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(true);
  });

  it('splits CORS_ORIGINS into a trimmed list', () => {
    const env = parseEnv({
      ...validEnv,
      CORS_ORIGINS: 'http://a.com, http://b.com ',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = validEnv;
    expect(() => parseEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid encryption key', () => {
    expect(() => parseEnv({ ...validEnv, ENCRYPTION_KEY: 'tooshort' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseEnv({ ...validEnv, PORT: '99999' })).toThrow();
  });

  it('applies the default Slack bot scopes as a parsed list', () => {
    const env = parseEnv(validEnv);
    expect(env.SLACK_BOT_SCOPES).toEqual(['commands', 'chat:write', 'users:read', 'team:read']);
    expect(env.SLACK_USER_SCOPES).toEqual([]);
  });

  it('reports Slack as unconfigured without credentials and configured with them', () => {
    expect(isSlackConfigured(parseEnv(validEnv))).toBe(false);
    expect(isSlackConfigured(parseEnv({ ...validEnv, ...slackEnv }))).toBe(true);
  });

  it('requires Slack credentials in production', () => {
    expect(() => parseEnv({ ...validEnv, NODE_ENV: 'production' })).toThrow(/Slack credentials/);
    expect(() => parseEnv({ ...validEnv, ...slackEnv, NODE_ENV: 'production' })).not.toThrow();
  });
});
