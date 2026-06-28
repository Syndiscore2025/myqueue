import { logger } from './logger';

/**
 * Where an alert originated, plus any structured context worth paging on. Kept
 * client-unsafe details out: this is operator-facing telemetry, not a response.
 */
export interface AlertContext {
  /** Origin of the alert, e.g. 'http', 'uncaughtException', 'unhandledRejection'. */
  source: string;
  /** Stable application error code, when the error is an ApplicationError. */
  code?: string;
  /** Correlating request id, when the alert fires inside a request. */
  requestId?: string;
  /** Additional structured context. */
  [key: string]: unknown;
}

/**
 * Destination for non-operational/fatal errors that warrant operator attention
 * (paging, Sentry, etc.). Deployments wire a concrete sink via {@link setAlertSink}
 * without touching call sites — mirroring the notifier/billing optional-port pattern.
 */
export interface AlertSink {
  captureError(error: unknown, context: AlertContext): void | Promise<void>;
}

let sink: AlertSink | undefined;

/** Install (or clear, with `undefined`) the process-wide alert sink. */
export function setAlertSink(next: AlertSink | undefined): void {
  sink = next;
}

/** The currently-installed sink, if any. Primarily for tests. */
export function getAlertSink(): AlertSink | undefined {
  return sink;
}

/**
 * Forward an error to the installed alert sink. Fail-safe by design: with no
 * sink it is a no-op, and a throwing or rejecting sink is logged but never
 * propagated, so alerting can never break request handling or shutdown.
 */
export function alertError(error: unknown, context: AlertContext): void {
  if (sink === undefined) {
    return;
  }
  try {
    const result = sink.captureError(error, context);
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        logger.error({ err, source: context.source }, 'alert sink rejected');
      });
    }
  } catch (err) {
    logger.error({ err, source: context.source }, 'alert sink threw');
  }
}
