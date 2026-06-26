import {
  SLACK_IDEMPOTENCY_TTL_SECONDS,
  SlackIdempotencyService,
  type IdempotencyStore,
} from '../../src/application/slack';

/** Fresh mock Redis plus a service wired to it. */
function build(): { svc: SlackIdempotencyService; set: jest.Mock } {
  const set = jest.fn();
  const svc = new SlackIdempotencyService({ redis: { set } as unknown as IdempotencyStore });
  return { svc, set };
}

describe('SlackIdempotencyService', () => {
  it('claims a fresh key with an atomic SET NX EX and reports success', async () => {
    const { svc, set } = build();
    set.mockResolvedValue('OK');

    await expect(svc.claim('slack:shortcut:add_message:TRIG')).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith(
      'slack:shortcut:add_message:TRIG',
      '1',
      'EX',
      SLACK_IDEMPOTENCY_TTL_SECONDS,
      'NX',
    );
  });

  it('reports failure when the key was already claimed within the TTL', async () => {
    const { svc, set } = build();
    set.mockResolvedValue(null);

    await expect(svc.claim('k')).resolves.toBe(false);
  });

  it('honours a caller-supplied TTL', async () => {
    const { svc, set } = build();
    set.mockResolvedValue('OK');

    await svc.claim('k', 30);
    expect(set).toHaveBeenCalledWith('k', '1', 'EX', 30, 'NX');
  });

  it('fails open and allows the action when Redis is unavailable', async () => {
    const { svc, set } = build();
    set.mockRejectedValue(new Error('connection refused'));

    await expect(svc.claim('k')).resolves.toBe(true);
  });
});
