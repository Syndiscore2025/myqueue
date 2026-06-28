import request from 'supertest';

const checkDatabaseHealth = jest.fn<Promise<boolean>, []>();
const checkRedisHealth = jest.fn<Promise<boolean>, []>();

jest.mock('../../src/infrastructure/database/prisma', () => ({
  checkDatabaseHealth: () => checkDatabaseHealth(),
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  // The repository singletons construct lazily against getPrisma() at import
  // time; the HTTP suite never touches the database, so a stub client suffices.
  getPrisma: jest.fn(() => ({})),
}));

jest.mock('../../src/infrastructure/redis/redis', () => ({
  checkRedisHealth: () => checkRedisHealth(),
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  createBullConnection: jest.fn(),
}));

import { createApp } from '../../src/interfaces/http/app';

const app = createApp();

describe('infrastructure HTTP endpoints', () => {
  beforeEach(() => {
    checkDatabaseHealth.mockResolvedValue(true);
    checkRedisHealth.mockResolvedValue(true);
  });

  it('GET /health returns liveness', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /version returns build metadata', async () => {
    const res = await request(app).get('/version');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('myqueue');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.nodeEnv).toBe('test');
  });

  it('GET /ready returns 200 when all dependencies are healthy', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      checks: { database: true, redis: true },
    });
  });

  it('GET /ready returns 503 when a dependency is unhealthy', async () => {
    checkRedisHealth.mockResolvedValue(false);
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.checks.redis).toBe(false);
  });

  it('GET /openapi.json serves the generated document', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.paths['/health']).toBeDefined();
  });

  it('serves a strict CSP (no inline scripts) on the API surface', async () => {
    const res = await request(app).get('/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it('relaxes the CSP only on the docs routes', async () => {
    const res = await request(app).get('/openapi.json');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('unknown routes return the standard error envelope via the error middleware', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.requestId).toBeDefined();
  });

  it('honours an inbound x-request-id header', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'fixed-id-123');
    expect(res.headers['x-request-id']).toBe('fixed-id-123');
  });
});
