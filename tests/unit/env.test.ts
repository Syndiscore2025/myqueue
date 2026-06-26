import { parseEnv } from '../../src/config/env';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: '0'.repeat(64),
};

describe('environment validation', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = parseEnv(validEnv);
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.RATE_LIMIT_MAX).toBe(100);
    expect(env.CORS_ORIGINS).toEqual(['*']);
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
});
