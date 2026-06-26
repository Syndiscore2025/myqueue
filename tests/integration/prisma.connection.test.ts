import {
  checkDatabaseHealth,
  connectDatabase,
  disconnectDatabase,
} from '../../src/infrastructure/database/prisma';

// Requires a live PostgreSQL. Enabled in CI / when RUN_INTEGRATION=true.
const describeIntegration = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegration('prisma connectivity', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('connects and answers a health query', async () => {
    await connectDatabase();
    await expect(checkDatabaseHealth()).resolves.toBe(true);
  });
});
