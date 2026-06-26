import { createHmac } from 'node:crypto';
import request from 'supertest';

// Slack credentials must be present before any src module is imported so the
// config singleton mounts the Slack surface. Non-secret test values only.
const SIGNING_SECRET = 'test-signing-secret';
process.env.SLACK_CLIENT_ID = 'test-client-id';
process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
process.env.SLACK_STATE_SECRET = 'a'.repeat(64);

// The repository singletons construct against getPrisma() at import time. The
// url_verification handshake never touches the database, so a stub suffices.
jest.mock('../../src/infrastructure/database/prisma', () => ({
  checkDatabaseHealth: jest.fn(),
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  getPrisma: jest.fn(() => ({})),
}));

jest.mock('../../src/infrastructure/redis/redis', () => ({
  checkRedisHealth: jest.fn(),
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
  createBullConnection: jest.fn(),
}));

import { createApp } from '../../src/interfaces/http/app';

const app = createApp();

/** Build the headers Slack sends, with a valid v0 request signature. */
function signedHeaders(body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const base = `v0:${timestamp}:${body}`;
  const signature = `v0=${createHmac('sha256', SIGNING_SECRET).update(base).digest('hex')}`;
  return {
    'content-type': 'application/json',
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': signature,
  };
}

describe('Slack surface wiring', () => {
  it('echoes the challenge for a correctly-signed url_verification request', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
    const res = await request(app).post('/slack/events').set(signedHeaders(body)).send(body);

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe('abc123');
  });

  it('rejects an events request whose signature does not verify', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'nope' });
    const res = await request(app)
      .post('/slack/events')
      .set({
        'content-type': 'application/json',
        'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        'x-slack-signature': 'v0=deadbeef',
      })
      .send(body);

    expect(res.status).toBe(401);
  });

  it('still serves the infrastructure routes alongside the Slack surface', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('documents the Slack routes in the OpenAPI document', async () => {
    const res = await request(app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/slack/events']).toBeDefined();
    expect(res.body.paths['/slack/oauth_redirect']).toBeDefined();
    expect(res.body.paths['/slack/install']).toBeDefined();
  });
});
