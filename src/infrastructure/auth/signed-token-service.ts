import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  AuthPrincipal,
  AuthTokenMinter,
  AuthVerifier,
  UserTokenClaims,
  WorkerTokenClaims,
} from '../../application/auth';

/**
 * Stateless bearer tokens in the compact JWS form `<header>.<payload>.<sig>`,
 * signed with HS256 (HMAC-SHA256) over the shared `AUTH_TOKEN_SECRET`.
 *
 * The format is a standard signed JWT so it interoperates with off-the-shelf
 * tooling and lets a host swap in their own provider, while the implementation
 * stays dependency-free (mirroring the AES-GCM {@link TokenService}). Tokens are
 * minted only from a Slack-signature-verified identity, so the signature is the
 * sole authority at verification time: a valid, unexpired signature is trusted
 * without a datastore lookup. The minimum 32-byte secret is enforced at
 * construction so a weak key can never be used.
 */
const HEADER = { alg: 'HS256', typ: 'JWT' } as const;
const ISSUER = 'myqueue';
const AUDIENCE = 'myqueue-api';
const MIN_SECRET_BYTES = 32;

interface TokenPayload {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  kind: 'user' | 'worker';
  wsid: string;
  sub: string;
  host?: string;
}

/** Options for {@link SignedTokenService}; `now` is injectable for testing. */
export interface SignedTokenServiceOptions {
  readonly defaultTtlSeconds: number;
  readonly now?: () => number;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export class SignedTokenService implements AuthVerifier, AuthTokenMinter {
  private readonly secret: Buffer;
  private readonly defaultTtlSeconds: number;
  private readonly now: () => number;
  private readonly headerSegment: string;

  constructor(secret: string, options: SignedTokenServiceOptions) {
    const secretBuffer = Buffer.from(secret, 'utf8');
    if (secretBuffer.length < MIN_SECRET_BYTES) {
      throw new Error(
        `SignedTokenService requires an AUTH_TOKEN_SECRET of at least ${MIN_SECRET_BYTES} ` +
          `bytes (got ${secretBuffer.length})`,
      );
    }
    this.secret = secretBuffer;
    this.defaultTtlSeconds = options.defaultTtlSeconds;
    this.now = options.now ?? Date.now;
    this.headerSegment = encode(HEADER);
  }

  signUser(claims: UserTokenClaims, ttlSeconds?: number): string {
    return this.sign({
      kind: 'user',
      wsid: claims.workspaceId,
      sub: claims.workspaceUserId,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    });
  }

  signWorker(claims: WorkerTokenClaims, ttlSeconds?: number): string {
    return this.sign({
      kind: 'worker',
      wsid: claims.workspaceId,
      sub: claims.workerId,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
      ...(claims.hostname === undefined ? {} : { host: claims.hostname }),
    });
  }

  verify(token: string): AuthPrincipal | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];

    const expected = this.signature(`${header}.${payload}`);
    const provided = Buffer.from(signature, 'base64url');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return null;
    }

    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload;
      return this.toPrincipal(claims);
    } catch {
      return null;
    }
  }

  private sign(input: {
    kind: 'user' | 'worker';
    wsid: string;
    sub: string;
    ttlSeconds?: number;
    host?: string;
  }): string {
    const issuedAt = Math.floor(this.now() / 1000);
    const ttl = input.ttlSeconds ?? this.defaultTtlSeconds;
    const payload: TokenPayload = {
      iss: ISSUER,
      aud: AUDIENCE,
      iat: issuedAt,
      exp: issuedAt + ttl,
      kind: input.kind,
      wsid: input.wsid,
      sub: input.sub,
      ...(input.host === undefined ? {} : { host: input.host }),
    };
    const signingInput = `${this.headerSegment}.${encode(payload)}`;
    return `${signingInput}.${this.signature(signingInput).toString('base64url')}`;
  }

  private signature(signingInput: string): Buffer {
    return createHmac('sha256', this.secret).update(signingInput).digest();
  }

  private toPrincipal(claims: TokenPayload): AuthPrincipal | null {
    if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= this.now()) return null;
    if (typeof claims.wsid !== 'string' || typeof claims.sub !== 'string') return null;
    if (claims.kind === 'user') {
      return { kind: 'user', workspaceId: claims.wsid, workspaceUserId: claims.sub };
    }
    if (claims.kind === 'worker') {
      return {
        kind: 'worker',
        workspaceId: claims.wsid,
        workerId: claims.sub,
        ...(typeof claims.host === 'string' ? { hostname: claims.host } : {}),
      };
    }
    return null;
  }
}
