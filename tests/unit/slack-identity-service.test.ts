import { SlackIdentityService } from '../../src/application/slack';
import { NotFoundError } from '../../src/domain/errors';
import type { WorkspaceRepository } from '../../src/infrastructure/repositories';

interface Mocks {
  findByTenant: jest.Mock;
  upsertUser: jest.Mock;
}

/** Fresh mock workspace repository plus a service wired to it. */
function build(): { svc: SlackIdentityService; m: Mocks } {
  const m: Mocks = { findByTenant: jest.fn(), upsertUser: jest.fn() };
  const svc = new SlackIdentityService({
    workspaces: m as unknown as WorkspaceRepository,
  });
  return { svc, m };
}

describe('SlackIdentityService', () => {
  it('resolves a team install to internal workspace and user ids', async () => {
    const { svc, m } = build();
    m.findByTenant.mockResolvedValue({ id: 'ws-1', slackTeamId: 'T1' });
    m.upsertUser.mockResolvedValue({ id: 'wu-1', slackUserId: 'U1' });

    const ctx = await svc.resolveContext({
      teamId: 'T1',
      slackUserId: 'U1',
      displayName: 'Ada',
    });

    expect(ctx).toEqual({ workspaceId: 'ws-1', workspaceUserId: 'wu-1' });
    expect(m.findByTenant).toHaveBeenCalledWith({ teamId: 'T1', enterpriseId: null });
    expect(m.upsertUser).toHaveBeenCalledWith('ws-1', {
      slackUserId: 'U1',
      displayName: 'Ada',
    });
  });

  it('passes the enterprise tenant identity through when an enterprise install', async () => {
    const { svc, m } = build();
    m.findByTenant.mockResolvedValue({ id: 'ws-2' });
    m.upsertUser.mockResolvedValue({ id: 'wu-2' });

    await svc.resolveContext({
      enterpriseId: 'E1',
      isEnterpriseInstall: true,
      slackUserId: 'U2',
    });

    expect(m.findByTenant).toHaveBeenCalledWith({
      teamId: null,
      enterpriseId: 'E1',
      isEnterpriseInstall: true,
    });
  });

  it('omits displayName from the upsert when not provided', async () => {
    const { svc, m } = build();
    m.findByTenant.mockResolvedValue({ id: 'ws-3' });
    m.upsertUser.mockResolvedValue({ id: 'wu-3' });

    await svc.resolveContext({ teamId: 'T3', slackUserId: 'U3' });

    expect(m.upsertUser).toHaveBeenCalledWith('ws-3', { slackUserId: 'U3' });
  });

  it('throws NotFoundError when the workspace is not installed', async () => {
    const { svc, m } = build();
    m.findByTenant.mockResolvedValue(null);

    await expect(svc.resolveContext({ teamId: 'T9', slackUserId: 'U9' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(m.upsertUser).not.toHaveBeenCalled();
  });
});
