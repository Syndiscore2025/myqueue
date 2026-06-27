import {
  SlackNotifier,
  type SlackDmClient,
  type SlackDmClientFactory,
} from '../../src/infrastructure/slack/slack-notifier';
import type { SlackInstallationRepository } from '../../src/infrastructure/repositories';

interface Mocks {
  getBotToken: jest.Mock;
  open: jest.Mock;
  postMessage: jest.Mock;
  factory: jest.Mock;
}

function build(): { svc: SlackNotifier; m: Mocks } {
  const m: Mocks = {
    getBotToken: jest.fn(),
    open: jest.fn(),
    postMessage: jest.fn(),
    factory: jest.fn(),
  };
  const client: SlackDmClient = {
    conversations: { open: m.open },
    chat: { postMessage: m.postMessage },
  };
  m.factory.mockReturnValue(client);
  const svc = new SlackNotifier({
    installations: { getBotToken: m.getBotToken } as unknown as SlackInstallationRepository,
    clientFactory: m.factory as unknown as SlackDmClientFactory,
  });
  return { svc, m };
}

describe('SlackNotifier.dmUser', () => {
  it('opens a DM with the decrypted bot token and posts the message', async () => {
    const { svc, m } = build();
    m.getBotToken.mockResolvedValue('xoxb-token');
    m.open.mockResolvedValue({ channel: { id: 'D123' } });
    m.postMessage.mockResolvedValue({ ok: true });

    const ok = await svc.dmUser('w1', 'U1', { text: 'hello' });

    expect(ok).toBe(true);
    expect(m.factory).toHaveBeenCalledWith('xoxb-token');
    expect(m.open).toHaveBeenCalledWith({ users: 'U1' });
    expect(m.postMessage).toHaveBeenCalledWith({ channel: 'D123', text: 'hello' });
  });

  it('forwards Block Kit blocks when provided', async () => {
    const { svc, m } = build();
    m.getBotToken.mockResolvedValue('xoxb-token');
    m.open.mockResolvedValue({ channel: { id: 'D123' } });
    m.postMessage.mockResolvedValue({ ok: true });
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }] as never;

    await svc.dmUser('w1', 'U1', { text: 'hello', blocks });

    expect(m.postMessage).toHaveBeenCalledWith({ channel: 'D123', text: 'hello', blocks });
  });

  it('returns false and never opens a DM when the workspace has no bot token', async () => {
    const { svc, m } = build();
    m.getBotToken.mockResolvedValue(null);

    await expect(svc.dmUser('w1', 'U1', { text: 'hi' })).resolves.toBe(false);
    expect(m.factory).not.toHaveBeenCalled();
    expect(m.open).not.toHaveBeenCalled();
  });

  it('returns false when no DM channel can be opened', async () => {
    const { svc, m } = build();
    m.getBotToken.mockResolvedValue('xoxb-token');
    m.open.mockResolvedValue({ channel: null });

    await expect(svc.dmUser('w1', 'U1', { text: 'hi' })).resolves.toBe(false);
    expect(m.postMessage).not.toHaveBeenCalled();
  });

  it('fails safe (returns false) when the Slack API throws', async () => {
    const { svc, m } = build();
    m.getBotToken.mockResolvedValue('xoxb-token');
    m.open.mockResolvedValue({ channel: { id: 'D123' } });
    m.postMessage.mockRejectedValue(new Error('rate_limited'));

    await expect(svc.dmUser('w1', 'U1', { text: 'hi' })).resolves.toBe(false);
  });
});
