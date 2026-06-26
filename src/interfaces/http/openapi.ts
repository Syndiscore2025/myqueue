import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { appInfo } from '../../config/app-info';
import { env } from '../../config';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const HealthResponse = registry.register(
  'HealthResponse',
  z.object({
    status: z.literal('ok'),
    uptime: z.number(),
    timestamp: z.string(),
  }),
);

const ReadyResponse = registry.register(
  'ReadyResponse',
  z.object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.object({ database: z.boolean(), redis: z.boolean() }),
    timestamp: z.string(),
  }),
);

const VersionResponse = registry.register(
  'VersionResponse',
  z.object({
    name: z.string(),
    version: z.string(),
    nodeEnv: z.string(),
    node: z.string(),
  }),
);

function json<T extends z.ZodTypeAny>(schema: T): { 'application/json': { schema: T } } {
  return { 'application/json': { schema } };
}

registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Liveness probe',
  tags: ['Infrastructure'],
  responses: { 200: { description: 'Process is alive', content: json(HealthResponse) } },
});

registry.registerPath({
  method: 'get',
  path: '/ready',
  summary: 'Readiness probe',
  tags: ['Infrastructure'],
  responses: {
    200: { description: 'All dependencies healthy', content: json(ReadyResponse) },
    503: { description: 'One or more dependencies unhealthy', content: json(ReadyResponse) },
  },
});

registry.registerPath({
  method: 'get',
  path: '/version',
  summary: 'Build and version information',
  tags: ['Infrastructure'],
  responses: { 200: { description: 'Version details', content: json(VersionResponse) } },
});

/** Generate the OpenAPI 3.0 document for the infrastructure surface. */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'MyQueue API',
      version: appInfo.version,
      description: 'MyQueue platform infrastructure API (Phase 1).',
    },
    servers: [{ url: env.APP_BASE_URL }],
  });
}

export const openApiDocument = buildOpenApiDocument();
