import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import type { RequestHandler } from 'express';
import { env } from '../../../config';

/**
 * Build Helmet with our base CSP. `allowInline` adds `'unsafe-inline'` to the
 * script/style sources, which only the Swagger UI docs page needs.
 */
function helmetWith(allowInline: boolean): RequestHandler {
  const inline = allowInline ? ["'unsafe-inline'"] : [];
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...inline],
        styleSrc: ["'self'", ...inline],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * Strict, production-grade security headers for the JSON API surface. The API
 * returns data only, so no inline scripts or styles are permitted.
 */
export const securityHeaders: RequestHandler = helmetWith(false);

/**
 * Relaxed headers scoped to the Swagger UI docs routes, which require inline
 * scripts/styles to render. Applied only on `/docs` and `/openapi.json` so the
 * rest of the API keeps the strict policy above.
 */
export const docsSecurityHeaders: RequestHandler = helmetWith(true);

const allowAllOrigins = env.CORS_ORIGINS.includes('*');

const corsOptions: CorsOptions = {
  origin: allowAllOrigins ? true : env.CORS_ORIGINS,
  credentials: !allowAllOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
};

/** CORS policy driven by the validated `CORS_ORIGINS` configuration. */
export const corsMiddleware: RequestHandler = cors(corsOptions);

/** Response compression. */
export const compressionMiddleware: RequestHandler = compression();
