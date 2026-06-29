/**
 * Unit tests for RedisRateLimitStore. A fake ioredis client is injected so no
 * Redis instance is required; the tests pin the Lua-eval contract, prefixing,
 * window re-arming, and the decrement/reset/get behaviour.
 */
import type { Redis } from 'ioredis';
import { RedisRateLimitStore } from '../../src/infrastructure/rate-limit/redis-rate-limit-store';

interface FakeRedis {
  eval: jest.Mock;
  pexpire: jest.Mock;
  get: jest.Mock;
  decr: jest.Mock;
  del: jest.Mock;
  pttl: jest.Mock;
}

function makeClient(): FakeRedis {
  return {
    eval: jest.fn(),
    pexpire: jest.fn().mockResolvedValue(1),
    get: jest.fn(),
    decr: jest.fn().mockResolvedValue(0),
    del: jest.fn().mockResolvedValue(1),
    pttl: jest.fn(),
  };
}

function makeStore(client: FakeRedis, windowMs = 60_000): RedisRateLimitStore {
  return new RedisRateLimitStore({ client: client as unknown as Redis, windowMs });
}

describe('RedisRateLimitStore', () => {
  it('increments via the Lua script and returns hits + reset time', async () => {
    const client = makeClient();
    client.eval.mockResolvedValue([1, 60_000]);
    const store = makeStore(client);

    const before = Date.now();
    const result = await store.increment('1.2.3.4');

    expect(result.totalHits).toBe(1);
    expect(result.resetTime).toBeInstanceOf(Date);
    expect(result.resetTime!.getTime()).toBeGreaterThanOrEqual(before + 60_000 - 50);
    // eval(script, numKeys, prefixedKey, windowMs)
    expect(client.eval).toHaveBeenCalledTimes(1);
    const args = client.eval.mock.calls[0];
    expect(args[1]).toBe(1);
    expect(args[2]).toBe('rl:1.2.3.4');
    expect(args[3]).toBe(60_000);
  });

  it('returns the running total for subsequent hits', async () => {
    const client = makeClient();
    client.eval.mockResolvedValue([5, 30_000]);
    const result = await makeStore(client).increment('ip');
    expect(result.totalHits).toBe(5);
  });

  it('re-arms the expiry when the key has no TTL', async () => {
    const client = makeClient();
    client.eval.mockResolvedValue([3, -1]);
    const before = Date.now();
    const result = await makeStore(client).increment('ip');

    expect(client.pexpire).toHaveBeenCalledWith('rl:ip', 60_000);
    expect(result.resetTime!.getTime()).toBeGreaterThanOrEqual(before + 60_000 - 50);
  });

  it('uses the window length supplied by init()', async () => {
    const client = makeClient();
    client.eval.mockResolvedValue([1, 1_000]);
    const store = makeStore(client, 60_000);
    store.init({ windowMs: 1_000 } as never);

    await store.increment('ip');
    expect(client.eval.mock.calls[0][3]).toBe(1_000);
  });

  it('applies a custom prefix to keys', async () => {
    const client = makeClient();
    client.eval.mockResolvedValue([1, 60_000]);
    const store = new RedisRateLimitStore({
      client: client as unknown as Redis,
      prefix: 'api:',
    });
    await store.increment('ip');
    expect(client.eval.mock.calls[0][2]).toBe('api:ip');
  });

  it('decrements only when the counter is above zero', async () => {
    const client = makeClient();
    client.get.mockResolvedValue('3');
    await makeStore(client).decrement('ip');
    expect(client.decr).toHaveBeenCalledWith('rl:ip');
  });

  it('does not decrement a missing or zero counter', async () => {
    const client = makeClient();
    client.get.mockResolvedValue(null);
    await makeStore(client).decrement('ip');
    client.get.mockResolvedValue('0');
    await makeStore(client).decrement('ip');
    expect(client.decr).not.toHaveBeenCalled();
  });

  it('resetKey deletes the prefixed key', async () => {
    const client = makeClient();
    await makeStore(client).resetKey('ip');
    expect(client.del).toHaveBeenCalledWith('rl:ip');
  });

  it('get returns undefined when the key is absent', async () => {
    const client = makeClient();
    client.get.mockResolvedValue(null);
    expect(await makeStore(client).get('ip')).toBeUndefined();
  });

  it('get returns the count and reset time when present', async () => {
    const client = makeClient();
    client.get.mockResolvedValue('7');
    client.pttl.mockResolvedValue(12_000);
    const before = Date.now();
    const result = await makeStore(client).get('ip');
    expect(result?.totalHits).toBe(7);
    expect(result?.resetTime!.getTime()).toBeGreaterThanOrEqual(before + 12_000 - 50);
  });
});
