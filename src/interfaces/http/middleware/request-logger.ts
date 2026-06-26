import { randomUUID } from 'node:crypto';
import { pinoHttp, type Options } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from '../../../utils/logger';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * HTTP request logging middleware.
 *
 * Assigns a stable request id (honouring an inbound `x-request-id` header when
 * present), echoes it back on the response, and attaches a child logger to each
 * request via `req.log`.
 */
const options: Options = {
  logger,
  genReqId: (req: IncomingMessage, res: ServerResponse): string => {
    const existing = req.headers[REQUEST_ID_HEADER];
    const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err !== undefined || res.statusCode >= 500) {
      return 'error';
    }
    if (res.statusCode >= 400) {
      return 'warn';
    }
    return 'info';
  },
  customSuccessMessage: (req, res) =>
    `${req.method ?? 'UNKNOWN'} ${req.url ?? ''} ${res.statusCode}`,
  autoLogging: {
    ignore: (req) => req.url === '/health',
  },
};

export const requestLogger = pinoHttp(options);
