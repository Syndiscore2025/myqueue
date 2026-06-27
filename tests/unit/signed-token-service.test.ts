/**
 * Unit tests for SignedTokenService (HS256 bearer tokens). A controllable clock
 * is injected so expiry is deterministic; tests pin the mint/verify round trip,
 * the user/worker discriminant, and rejection of tampered, expired, wrong-key,
 * and malformed tokens.
 */
import { SignedTokenService } from '../../src/infrastructure/auth/signed-token-service';

const SECRET = 's'.repeat(32);
const OTHER_SECRET = 'x'.repeat(32);
const FIXED_NOW = 1_700_000_000_000;

function makeService(now: () => number = () => FIXED_NOW): SignedTokenService {
  return new SignedTokenService(SECRET, { defaultTtlSeconds: 3600, now });
}

describe('SignedTokenService', () => {
  it('rejects a secret shorter than 32 bytes at construction', () => {
    expect(() => new SignedTokenService('short', { defaultTtlSeconds: 60 })).toThrow(/at least 32/);
  });

  it('round-trips a user token into a user principal', () => {
    const service = makeService();
    const token = service.signUser({ workspaceId: 'w1', workspaceUserId: 'u1' });
    expect(token.split('.')).toHaveLength(3);
    expect(service.verify(token)).toEqual({
      kind: 'user',
      workspaceId: 'w1',
      workspaceUserId: 'u1',
    });
  });

  it('round-trips a worker token, preserving the optional hostname', () => {
    const service = makeService();
    const token = service.signWorker({ workspaceId: 'w1', workerId: 'k1', hostname: 'host-a' });
    expect(service.verify(token)).toEqual({
      kind: 'worker',
      workspaceId: 'w1',
      workerId: 'k1',
      hostname: 'host-a',
    });
  });

  it('omits hostname from the principal when not minted with one', () => {
    const service = makeService();
    const principal = service.verify(service.signWorker({ workspaceId: 'w1', workerId: 'k1' }));
    expect(principal).toEqual({ kind: 'worker', workspaceId: 'w1', workerId: 'k1' });
    expect(principal).not.toHaveProperty('hostname');
  });

  it('rejects a token signed with a different secret', () => {
    const minted = makeService().signUser({ workspaceId: 'w1', workspaceUserId: 'u1' });
    const verifier = new SignedTokenService(OTHER_SECRET, { defaultTtlSeconds: 3600 });
    expect(verifier.verify(minted)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const service = makeService();
    const [header, payload, signature] = service
      .signUser({ workspaceId: 'w1', workspaceUserId: 'u1' })
      .split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ kind: 'user', wsid: 'w9', sub: 'u9' })).toString(
      'base64url',
    );
    expect(payload).not.toBe(forged);
    expect(service.verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    let now = FIXED_NOW;
    const service = makeService(() => now);
    const token = service.signUser({ workspaceId: 'w1', workspaceUserId: 'u1' }, 60);
    expect(service.verify(token)).not.toBeNull();
    now = FIXED_NOW + 61_000;
    expect(service.verify(token)).toBeNull();
  });

  it('honours a per-token ttl override', () => {
    const service = makeService();
    const token = service.signUser({ workspaceId: 'w1', workspaceUserId: 'u1' }, 10);
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
      iat: number;
      exp: number;
    };
    expect(payload.exp - payload.iat).toBe(10);
  });

  it.each(['', 'not-a-token', 'a.b', 'a.b.c.d'])('rejects the malformed token %p', (token) => {
    expect(makeService().verify(token)).toBeNull();
  });
});
