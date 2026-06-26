import { checkRedisHealth, disconnectRedis } from '../../src/infrastructure/redis/redis';

// Requires a live Redis. Enabled in CI / when RUN_INTEGRATION=true.
const describeIntegration = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegration('redis connectivity', () => {
  afterAll(async () => {
    await disconnectRedis();
  });

  it('answers a health PING', async () => {
    await expect(checkRedisHealth()).resolves.toBe(true);
  });
});
