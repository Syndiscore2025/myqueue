import express, { type Application } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env, slackConfigured } from '../../config';
import { getSlackApp } from '../../infrastructure/slack';
import { registerSlackHandlers } from '../slack/register';
import { logger } from '../../utils/logger';
import {
  compressionMiddleware,
  corsMiddleware,
  docsSecurityHeaders,
  errorHandler,
  notFoundHandler,
  rateLimiter,
  requestLogger,
  securityHeaders,
} from './middleware';
import { healthRouter } from './routes/health';
import { queueRouter } from './routes/queue';
import { workersRouter } from './routes/workers';
import { adminRouter } from './routes/admin';
import { analyticsRouter } from './routes/analytics';
import { billingRouter } from './routes/billing';
import { billingWebhookRouter } from './routes/billing-webhook';
import { workspaceRouter } from './routes/workspace';
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
    const { app: slackApp, receiver } = getSlackApp();
    registerSlackHandlers(slackApp);
    app.use(receiver.router);
    logger.info('Slack surface mounted (events, install, oauth_redirect)');
  }

  // Stripe webhook receiver. Mounted before the JSON body parser so its
  // express.raw() handler can preserve the exact signed bytes for HMAC
  // verification; the route carries its own full path (/api/v1/billing/webhook).
  app.use(billingWebhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(rateLimiter);

  // Infrastructure routes.
  app.use(healthRouter);

  // Application API. Each route is guarded by the workspaceContext/workerContext
  // middleware, which require an Authorization: Bearer token in production and
  // only fall back to explicit tenant headers in development/test.
  app.use('/api/v1/queue', queueRouter);
  app.use('/api/v1/workers', workersRouter);
  app.use('/api/v1/workspace', workspaceRouter);
  app.use('/api/v1/billing', billingRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/analytics', analyticsRouter);

  // API documentation. The Swagger UI page needs inline scripts/styles, so the
  // docs routes carry a relaxed CSP while the rest of the API stays strict.
  app.get('/openapi.json', docsSecurityHeaders, (_req, res) => {
    res.json(openApiDocument);
  });
  app.use('/docs', docsSecurityHeaders, swaggerUi.serve, swaggerUi.setup(openApiDocument));

  // Terminal handlers.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
