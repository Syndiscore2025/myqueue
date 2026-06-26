import type { Request, RequestHandler } from 'express';
import { UnauthorizedError } from '../../../domain/errors';
import type { QueueContext } from '../../../application/queue';

/** HTTP headers carrying the explicit tenant context (no real session yet). */
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

/**
 * Guard that resolves the acting tenant context for internal queue routes.
 *
 * NOTE: This is a development/internal-safe stand-in for real authentication.
 * Until production user/session auth exists, the workspace and acting user are
 * supplied explicitly via the `x-workspace-id` and `x-workspace-user-id`
 * headers. These routes must not be exposed to untrusted clients as-is, since a
 * caller can assert any identity. The guard only enforces that both ids are
 * present so every downstream query and audit record is tenant-scoped.
 */
export const workspaceContext: RequestHandler = (req, _res, next) => {
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
};

/** Retrieve the guaranteed workspace context, throwing if the guard was skipped. */
export function requireWorkspaceContext(req: Request): QueueContext {
  if (req.workspaceContext === undefined) {
    throw new UnauthorizedError('Workspace context is not available on this request');
  }
  return req.workspaceContext;
}
