import { pino, type Logger, type LoggerOptions } from 'pino';
import { env, isProduction, isTest } from '../config';

/**
 * Build Pino logger options appropriate for the current environment.
 *
 * - Production emits structured JSON for log aggregation.
 * - Development uses pino-pretty for human-readable output.
 * - Tests are silent to keep output clean.
 */
function buildOptions(): LoggerOptions {
  const base: LoggerOptions = {
    level: isTest ? 'silent' : env.LOG_LEVEL,
    base: { service: 'myqueue' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-slack-signature"]',
        '*.password',
        '*.token',
        '*.secret',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  };

  if (isProduction) {
    return base;
  }

  return {
    ...base,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  };
}

/** Root application logger. Create child loggers for module-specific context. */
export const logger: Logger = pino(buildOptions());

/** Create a namespaced child logger with a stable `module` field. */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}
