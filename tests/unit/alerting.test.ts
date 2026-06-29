import { alertError, getAlertSink, setAlertSink, type AlertSink } from '../../src/utils/alerting';

describe('alerting', () => {
  afterEach(() => {
    setAlertSink(undefined);
  });

  it('is a no-op when no sink is installed', () => {
    expect(getAlertSink()).toBeUndefined();
    expect(() => alertError(new Error('boom'), { source: 'http' })).not.toThrow();
  });

  it('forwards the error and context to the installed sink', () => {
    const captureError = jest.fn();
    const sink: AlertSink = { captureError };
    setAlertSink(sink);

    const error = new Error('boom');
    alertError(error, { source: 'http', code: 'INTERNAL_SERVER_ERROR', requestId: 'r1' });

    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'http',
      code: 'INTERNAL_SERVER_ERROR',
      requestId: 'r1',
    });
  });

  it('swallows synchronous throws from the sink (never breaks the caller)', () => {
    const captureError = jest.fn(() => {
      throw new Error('sink exploded');
    });
    setAlertSink({ captureError });

    expect(() => alertError(new Error('boom'), { source: 'uncaughtException' })).not.toThrow();
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('swallows asynchronous rejections from the sink', async () => {
    const captureError = jest.fn().mockRejectedValue(new Error('async sink failed'));
    setAlertSink({ captureError });

    expect(() => alertError(new Error('boom'), { source: 'unhandledRejection' })).not.toThrow();
    // Allow the internal .catch() to settle without an unhandled rejection.
    await Promise.resolve();
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('clears the sink when set to undefined', () => {
    const captureError = jest.fn();
    setAlertSink({ captureError });
    setAlertSink(undefined);

    alertError(new Error('boom'), { source: 'http' });

    expect(captureError).not.toHaveBeenCalled();
  });
});
