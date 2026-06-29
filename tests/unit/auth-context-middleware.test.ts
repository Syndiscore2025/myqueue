/**
 * Unit tests for the verifier-backed workspace/worker guards. A fake
 * AuthVerifier is injected so the tests pin: the bearer-token path (accepting
 * only the matching principal kind), the dev-header fallback when allowed, and
 * the production lock-down that rejects header-only identity.
 */
import type { NextFunction, Request, Response } from 'express';
import type { AuthPrincipal, AuthVerifier } from '../../src/application/auth';
import { UnauthorizedError } from '../../src/domain/errors';
import { createWorkspaceContext } from '../../src/interfaces/http/middleware/workspace-context';
import { createWorkerContext } from '../../src/interfaces/http/middleware/worker-context';

function makeReq(headers: Record<string, string>): Request {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name: string) => lower.get(name.toLowerCase()) } as unknown as Request;
}

function makeVerifier(result: AuthPrincipal | null): AuthVerifier {
  return { verify: jest.fn().mockResolvedValue(result) };
}

function invoke(
  handler: ReturnType<typeof createWorkspaceContext>,
  req: Request,
): Promise<unknown> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: unknown) => resolve(err);
    handler(req, {} as Response, next);
  });
}

describe('createWorkspaceContext', () => {
  const userPrincipal: AuthPrincipal = { kind: 'user', workspaceId: 'w1', workspaceUserId: 'u1' };

  it('accepts a valid user bearer token and sets the tenant context', async () => {
    const verifier = makeVerifier(userPrincipal);
    const guard = createWorkspaceContext({ verifier, allowDevHeaders: false });
    const req = makeReq({ authorization: 'Bearer tok' });
    expect(await invoke(guard, req)).toBeUndefined();
    expect(verifier.verify).toHaveBeenCalledWith('tok');
    expect(req.workspaceContext).toEqual({ workspaceId: 'w1', workspaceUserId: 'u1' });
  });

  it('rejects a worker token on a user route', async () => {
    const verifier = makeVerifier({ kind: 'worker', workspaceId: 'w1', workerId: 'k1' });
    const guard = createWorkspaceContext({ verifier, allowDevHeaders: true });
    const err = await invoke(guard, makeReq({ authorization: 'Bearer tok' }));
    expect(err).toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an invalid token without falling back to headers', async () => {
    const verifier = makeVerifier(null);
    const guard = createWorkspaceContext({ verifier, allowDevHeaders: true });
    const req = makeReq({
      authorization: 'Bearer bad',
      'x-workspace-id': 'w1',
      'x-workspace-user-id': 'u1',
    });
    expect(await invoke(guard, req)).toBeInstanceOf(UnauthorizedError);
    expect(req.workspaceContext).toBeUndefined();
  });

  it('falls back to dev headers when allowed and no bearer is present', async () => {
    const verifier = makeVerifier(null);
    const guard = createWorkspaceContext({ verifier, allowDevHeaders: true });
    const req = makeReq({ 'x-workspace-id': 'w1', 'x-workspace-user-id': 'u1' });
    expect(await invoke(guard, req)).toBeUndefined();
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(req.workspaceContext).toEqual({ workspaceId: 'w1', workspaceUserId: 'u1' });
  });

  it('errors when dev headers are allowed but incomplete', async () => {
    const guard = createWorkspaceContext({ verifier: makeVerifier(null), allowDevHeaders: true });
    expect(await invoke(guard, makeReq({ 'x-workspace-id': 'w1' }))).toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects header-only identity when dev headers are disabled (production)', async () => {
    const verifier = makeVerifier(null);
    const guard = createWorkspaceContext({ verifier, allowDevHeaders: false });
    const req = makeReq({ 'x-workspace-id': 'w1', 'x-workspace-user-id': 'u1' });
    expect(await invoke(guard, req)).toBeInstanceOf(UnauthorizedError);
    expect(verifier.verify).not.toHaveBeenCalled();
  });
});

describe('createWorkerContext', () => {
  const workerPrincipal: AuthPrincipal = {
    kind: 'worker',
    workspaceId: 'w1',
    workerId: 'k1',
    hostname: 'host-a',
  };

  it('accepts a valid worker bearer token and sets the worker context', async () => {
    const verifier = makeVerifier(workerPrincipal);
    const guard = createWorkerContext({ verifier, allowDevHeaders: false });
    const req = makeReq({ authorization: 'Bearer tok' });
    expect(await invoke(guard, req)).toBeUndefined();
    expect(req.workerContext).toEqual({ workspaceId: 'w1', workerId: 'k1', hostname: 'host-a' });
  });

  it('rejects a user token on a worker route', async () => {
    const verifier = makeVerifier({ kind: 'user', workspaceId: 'w1', workspaceUserId: 'u1' });
    const guard = createWorkerContext({ verifier, allowDevHeaders: true });
    expect(await invoke(guard, makeReq({ authorization: 'Bearer tok' }))).toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('falls back to dev headers when allowed and no bearer is present', async () => {
    const guard = createWorkerContext({ verifier: makeVerifier(null), allowDevHeaders: true });
    const req = makeReq({ 'x-workspace-id': 'w1', 'x-worker-id': 'k1' });
    expect(await invoke(guard, req)).toBeUndefined();
    expect(req.workerContext).toEqual({ workspaceId: 'w1', workerId: 'k1' });
  });

  it('rejects header-only identity when dev headers are disabled (production)', async () => {
    const guard = createWorkerContext({ verifier: makeVerifier(null), allowDevHeaders: false });
    const req = makeReq({ 'x-workspace-id': 'w1', 'x-worker-id': 'k1' });
    expect(await invoke(guard, req)).toBeInstanceOf(UnauthorizedError);
  });
});
