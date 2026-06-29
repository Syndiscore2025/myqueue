import type { QueueContext, WorkerContext } from '../queue';

/**
 * A verified actor, derived from a trusted credential (by default a signed
 * bearer token minted from a verified Slack identity). The discriminant mirrors
 * the two HTTP guards: `user` principals act on behalf of a workspace member and
 * map to a {@link QueueContext}; `worker` principals are infrastructure actors
 * and map to a {@link WorkerContext}.
 */
export type AuthPrincipal =
  | ({ readonly kind: 'user' } & QueueContext)
  | ({ readonly kind: 'worker' } & WorkerContext);

/**
 * Pluggable verification seam for inbound bearer credentials.
 *
 * This is the single extension point a host company overrides to plug MyQueue
 * into their own Slack/SSO flow: implement {@link verify} against your identity
 * provider (e.g. validate a JWT against a JWKS) and return the resolved
 * principal, or `null` when the credential is absent/invalid/expired. The HTTP
 * guards depend only on this port, never on a concrete provider.
 */
export interface AuthVerifier {
  /**
   * Validate a raw bearer credential and resolve the acting principal. Returns
   * `null` for any credential that fails validation (bad signature, expired,
   * malformed) so the caller can render a single, non-revealing 401.
   */
  verify(token: string): Promise<AuthPrincipal | null> | AuthPrincipal | null;
}

/** Claims required to mint a user bearer token. */
export type UserTokenClaims = QueueContext;

/** Claims required to mint a worker bearer token. */
export type WorkerTokenClaims = WorkerContext;

/**
 * Companion minting seam to {@link AuthVerifier}. The default implementation
 * issues short-lived signed tokens from the {@link SlackIdentityService}-verified
 * context (see the `/myqueue token` command), keeping Slack the single trust
 * root. Hosts with their own identity provider issue tokens there instead and
 * only implement {@link AuthVerifier}.
 */
export interface AuthTokenMinter {
  /** Mint a user bearer token. `ttlSeconds` overrides the configured default. */
  signUser(claims: UserTokenClaims, ttlSeconds?: number): string;
  /** Mint a worker bearer token. `ttlSeconds` overrides the configured default. */
  signWorker(claims: WorkerTokenClaims, ttlSeconds?: number): string;
}
