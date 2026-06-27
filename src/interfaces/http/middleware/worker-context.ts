import type { Request, RequestHandler } from 'express';
import { isProduction } from '../../../config';
import { UnauthorizedError } from '../../../domain/errors';
import type { AuthVerifier } from '../../../application/auth';
import type { WorkerContext } from '../../../application/queue';
import { authVerifier } from '../../../infrastructure/auth';
import { WORKSPACE_ID_HEADER, bearerToken } from './workspace-context';

/** Header carrying the claiming worker's identity. */
export const WORKER_ID_HEADER = 'x-worker-id';

/** Optional header carrying the worker's host, recorded in the worker registry. */
export const WORKER_HOSTNAME_HEADER = 'x-worker-hostname';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Worker context resolved by {@link workerContext}; set on worker routes. */
      workerContext?: WorkerContext;
    }
  }
}

/** Read a single, non-empty header value, or null when absent/blank. */
function header(req: Request, name: string): string | null {
  const raw = req.header(name);
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 ? value : null;
}

/** Dependencies for {@link createWorkerContext}; injectable for testing. */
export interface WorkerContextDeps {
  /** Verifies inbound bearer tokens into a principal. */
  verifier: AuthVerifier;
  /** Whether the explicit-header fallback is permitted (non-production only). */
  allowDevHeaders: boolean;
}

/**
 * Build the guard for worker-facing queue routes.
 *
 * Primary path: an `Authorization: Bearer <token>` is validated by the
 * {@link AuthVerifier} and only a `worker` principal is accepted; the worker
 * itself is the actor, so there is no acting workspace user. When no bearer is
 * present the guard falls back to the explicit `x-workspace-id` / `x-worker-id`
 * (and optional `x-worker-hostname`) headers, but only when `allowDevHeaders` is
 * set — the fallback is disabled in production.
 */
export function createWorkerContext(deps: WorkerContextDeps): RequestHandler {
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
          if (principal.kind !== 'worker') {
            next(new UnauthorizedError('Bearer token is not a worker token'));
            return;
          }
          req.workerContext = {
            workspaceId: principal.workspaceId,
            workerId: principal.workerId,
            ...(principal.hostname === undefined ? {} : { hostname: principal.hostname }),
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
        const workerId = header(req, WORKER_ID_HEADER);
        if (workspaceId === null || workerId === null) {
          next(
            new UnauthorizedError(
              `Missing worker context: both "${WORKSPACE_ID_HEADER}" and ` +
                `"${WORKER_ID_HEADER}" headers are required`,
            ),
          );
          return;
        }
        const hostname = header(req, WORKER_HOSTNAME_HEADER);
        req.workerContext = { workspaceId, workerId, ...(hostname === null ? {} : { hostname }) };
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/** Default worker guard: signed-token verification with dev-header fallback. */
export const workerContext: RequestHandler = createWorkerContext({
  verifier: authVerifier,
  allowDevHeaders: !isProduction,
});

/** Retrieve the guaranteed worker context, throwing if the guard was skipped. */
export function requireWorkerContext(req: Request): WorkerContext {
  if (req.workerContext === undefined) {
    throw new UnauthorizedError('Worker context is not available on this request');
  }
  return req.workerContext;
}
