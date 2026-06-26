import express, { type Application } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env, slackConfigured } from '../../config';
import { getSlackApp } from '../../infrastructure/slack';
import { logger } from '../../utils/logger';
import {
  compressionMiddleware,
  corsMiddleware,
  errorHandler,
  notFoundHandler,
  rateLimiter,
  requestLogger,
  securityHeaders,
} from './middleware';
import { healthRouter } from './routes/health';
import { openApiDocument } from './openapi';

/**
 * Construct and configure the Express application.
 *
 * Middleware ordering matters: request context/logging first, then security,
 * body parsing, rate limiting, routes, and finally the not-found and error
 * handlers as the terminal middleware.
 */
export function createApp(): Application {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(compressionMiddleware);

  // Slack surface. Mounted before the JSON/urlencoded body parsers so Bolt's
  // ExpressReceiver can verify request signatures against the raw body, and
  // before the rate limiter so Slack's event retries are never throttled. Only
  // mounted when Slack credentials are present (e.g. omitted in infra-only or
  // test environments).
  if (slackConfigured) {
    const { receiver } = getSlackApp();
    app.use(receiver.router);
    logger.info('Slack surface mounted (events, install, oauth_redirect)');
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(rateLimiter);

  // Infrastructure routes.
  app.use(healthRouter);

  // API documentation.
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  // Terminal handlers.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
