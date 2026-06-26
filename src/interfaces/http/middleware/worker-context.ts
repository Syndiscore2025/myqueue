import type { Request, RequestHandler } from 'express';
import { UnauthorizedError } from '../../../domain/errors';
import type { WorkerContext } from '../../../application/queue';
import { WORKSPACE_ID_HEADER } from './workspace-context';

/** Header carrying the claiming worker's identity. */
export const WORKER_ID_HEADER = 'x-worker-id';

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

/**
 * Guard for worker-facing queue routes.
 *
 * A worker is identified by the workspace it operates in (`x-workspace-id`) and
 * its own id (`x-worker-id`). Unlike the user-facing routes there is no acting
 * workspace user — the worker itself is the actor. Workers cannot operate
 * without an id, so both headers are required. The same development/internal
 * security caveat as {@link workspaceContext} applies: these headers are not a
 * substitute for authenticated worker identity.
 */
export const workerContext: RequestHandler = (req, _res, next) => {
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
  req.workerContext = { workspaceId, workerId };
  next();
};

/** Retrieve the guaranteed worker context, throwing if the guard was skipped. */
export function requireWorkerContext(req: Request): WorkerContext {
  if (req.workerContext === undefined) {
    throw new UnauthorizedError('Worker context is not available on this request');
  }
  return req.workerContext;
}
