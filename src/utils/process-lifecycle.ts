import { logger } from './logger';
import { alertError } from './alerting';

type ShutdownTask = () => Promise<void> | void;

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
const FORCE_EXIT_MS = 15_000;

/**
 * Register handlers that run a graceful shutdown sequence on termination
 * signals and fatal, non-recoverable errors. The provided task should release
 * all external resources (HTTP server, queues, datastore connections).
 */
export function registerShutdownHandlers(task: ShutdownTask): void {
  let shuttingDown = false;

  const runShutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ reason }, 'graceful shutdown initiated');

    const forceTimer = setTimeout(() => {
      logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, FORCE_EXIT_MS);
    forceTimer.unref();

    try {
      await task();
      logger.info('graceful shutdown complete');
      process.exit(exitCode);
    } catch (error) {
      logger.error({ err: error }, 'error during graceful shutdown');
      process.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      void runShutdown(signal, 0);
    });
  }

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    alertError(error, { source: 'uncaughtException' });
    void runShutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    alertError(reason, { source: 'unhandledRejection' });
    void runShutdown('unhandledRejection', 1);
  });
}
