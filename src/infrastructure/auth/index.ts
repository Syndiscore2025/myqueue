import { authConfigured, env } from '../../config';
import type { AuthPrincipal, AuthVerifier } from '../../application/auth';
import { SignedTokenService } from './signed-token-service';

export { SignedTokenService } from './signed-token-service';
export type { SignedTokenServiceOptions } from './signed-token-service';

/**
 * Verifier used when no `AUTH_TOKEN_SECRET` is configured (local/test). It never
 * accepts a token, so a presented bearer is treated as invalid; the dev-header
 * fallback in the guards remains the only way to assert identity outside
 * production.
 */
class NullAuthVerifier implements AuthVerifier {
  verify(): AuthPrincipal | null {
    return null;
  }
}

/**
 * Process-wide signed-token service, bound to the validated secret/TTL. It is the
 * default {@link AuthVerifier} for the HTTP guards and the {@link AuthTokenMinter}
 * behind the `/myqueue token` command. `null` when auth is not configured, in
 * which case minting is unavailable and {@link authVerifier} rejects all tokens.
 */
export const authTokenService: SignedTokenService | null = authConfigured
  ? new SignedTokenService(env.AUTH_TOKEN_SECRET, {
      defaultTtlSeconds: env.AUTH_TOKEN_TTL_SECONDS,
    })
  : null;

/** The active verifier: the real signed-token service, or a reject-all fallback. */
export const authVerifier: AuthVerifier = authTokenService ?? new NullAuthVerifier();
