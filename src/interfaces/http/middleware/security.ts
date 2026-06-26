import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import type { RequestHandler } from 'express';
import { env } from '../../../config';

/** Strict, production-grade security headers. */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Swagger UI requires inline styles/scripts to render the docs page.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

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
