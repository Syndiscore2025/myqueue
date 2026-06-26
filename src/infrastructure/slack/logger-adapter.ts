import { LogLevel, type Logger as SlackLogger } from '@slack/bolt';
import type { Logger as PinoLogger } from 'pino';
import { createLogger } from '../../utils/logger';

type PinoLevel = 'error' | 'warn' | 'info' | 'debug';

/** Map Slack's coarse log levels onto the Pino levels we emit through. */
const SLACK_TO_PINO: Record<LogLevel, PinoLevel> = {
  [LogLevel.ERROR]: 'error',
  [LogLevel.WARN]: 'warn',
  [LogLevel.INFO]: 'info',
  [LogLevel.DEBUG]: 'debug',
};

/**
 * Adapts the Slack SDK {@link SlackLogger} interface onto our shared Pino
 * logger so Bolt/OAuth internals flow through the same structured, redacted
 * pipeline as the rest of the application instead of writing to the console.
 */
export class SlackLoggerAdapter implements SlackLogger {
  private level: LogLevel = LogLevel.INFO;

  constructor(private logger: PinoLogger = createLogger('slack')) {}

  debug(...msg: unknown[]): void {
    this.emit('debug', msg);
  }

  info(...msg: unknown[]): void {
    this.emit('info', msg);
  }

  warn(...msg: unknown[]): void {
    this.emit('warn', msg);
  }

  error(...msg: unknown[]): void {
    this.emit('error', msg);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
    this.logger.level = SLACK_TO_PINO[level];
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setName(name: string): void {
    this.logger = this.logger.child({ slackComponent: name });
  }

  /**
   * Split the SDK's variadic arguments into a merged structured object (from
   * any object arguments) and a single message string (from the rest).
   */
  private emit(level: PinoLevel, args: unknown[]): void {
    const objects = args.filter(
      (arg): arg is Record<string, unknown> => typeof arg === 'object' && arg !== null,
    );
    const message = args
      .filter((arg) => typeof arg !== 'object' || arg === null)
      .map((arg) => String(arg))
      .join(' ');

    if (objects.length > 0) {
      this.logger[level](Object.assign({}, ...objects), message);
    } else {
      this.logger[level](message);
    }
  }
}
