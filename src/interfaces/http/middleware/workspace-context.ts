import type { Request, RequestHandler } from 'express';
import { isProduction } from '../../../config';
import { UnauthorizedError } from '../../../domain/errors';
import type { AuthVerifier } from '../../../application/auth';
import type { QueueContext } from '../../../application/queue';
import { authVerifier } from '../../../infrastructure/auth';

/** HTTP headers carrying the explicit tenant context (development fallback). */
export const WORKSPACE_ID_HEADER = 'x-workspace-id';
export const WORKSPACE_USER_ID_HEADER = 'x-workspace-user-id';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Tenant context resolved by {@link workspaceContext}; set on guarded routes. */
      workspaceContext?: QueueContext;
    }
  }
}

/** Read a single, non-empty header value, or null when absent/blank. */
function header(req: Request, name: string): string | null {
  const raw = req.header(name);
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 ? value : null;
}

/** Extract the credential from an `Authorization: Bearer <token>` header. */
export function bearerToken(req: Request): string | null {
  const raw = req.header('authorization');
  if (typeof raw !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match === null ? null : match[1]!.trim();
}

/** Dependencies for {@link createWorkspaceContext}; injectable for testing. */
export interface WorkspaceContextDeps {
  /** Verifies inbound bearer tokens into a principal. */
  verifier: AuthVerifier;
  /** Whether the explicit-header fallback is permitted (non-production only). */
  allowDevHeaders: boolean;
}

/**
 * Build the tenant-context guard for user-facing queue routes.
 *
 * Primary path: an `Authorization: Bearer <token>` minted from a verified Slack
 * identity is validated by the {@link AuthVerifier}; only a `user` principal is
 * accepted, and its workspace/user ids are trusted because membership was
 * established at mint time. When no bearer is present the guard falls back to the
 * explicit `x-workspace-id` / `x-workspace-user-id` headers, but only when
 * `allowDevHeaders` is set — that fallback is disabled in production so an
 * untrusted client can never assert an identity by header alone.
 */
export function createWorkspaceContext(deps: WorkspaceContextDeps): RequestHandler {
  const { verifier, allowDevHeaders } = deps;
  return (req, _res, next) => {
    void (async () => {
      try {
        const token = bearerToken(req);
        if (token !== null) {
          const principal = await verifier.verify(token);
          if (principal === null) {
            next(new UnauthorizedError('Invalid or expired bearer token'));
            return;
          }
          if (principal.kind !== 'user') {
            next(new UnauthorizedError('Bearer token is not a user token'));
            return;
          }
          req.workspaceContext = {
            workspaceId: principal.workspaceId,
            workspaceUserId: principal.workspaceUserId,
          };
          next();
          return;
        }

        if (!allowDevHeaders) {
          next(
            new UnauthorizedError(
              'Missing credentials: an "Authorization: Bearer <token>" header is required',
            ),
          );
          return;
        }

        const workspaceId = header(req, WORKSPACE_ID_HEADER);
        const workspaceUserId = header(req, WORKSPACE_USER_ID_HEADER);
        if (workspaceId === null || workspaceUserId === null) {
          next(
            new UnauthorizedError(
              `Missing workspace context: both "${WORKSPACE_ID_HEADER}" and ` +
                `"${WORKSPACE_USER_ID_HEADER}" headers are required`,
            ),
          );
          return;
        }
        req.workspaceContext = { workspaceId, workspaceUserId };
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/** Default tenant guard: signed-token verification with dev-header fallback. */
export const workspaceContext: RequestHandler = createWorkspaceContext({
  verifier: authVerifier,
  allowDevHeaders: !isProduction,
});

/** Retrieve the guaranteed workspace context, throwing if the guard was skipped. */
export function requireWorkspaceContext(req: Request): QueueContext {
  if (req.workspaceContext === undefined) {
    throw new UnauthorizedError('Workspace context is not available on this request');
  }
  return req.workspaceContext;
}
