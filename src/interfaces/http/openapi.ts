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

const SlackEventEnvelope = registry.register(
  'SlackEventEnvelope',
  z
    .object({
      token: z.string().optional(),
      type: z.string().openapi({ example: 'event_callback' }),
      challenge: z.string().optional().openapi({ description: 'Present on url_verification.' }),
      team_id: z.string().optional(),
      api_app_id: z.string().optional(),
      event: z.record(z.string(), z.unknown()).optional(),
    })
    .openapi({ description: 'Slack Events API request envelope (shape varies by event type).' }),
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

// --- Slack surface (handled by Bolt's ExpressReceiver) -----------------------
// These routes are served by the Slack SDK rather than Express handlers; they
// are documented here for completeness. They are only mounted when Slack
// credentials are configured.

registry.registerPath({
  method: 'get',
  path: '/slack/install',
  summary: 'Begin Slack app installation (OAuth)',
  description:
    'Starts the OAuth flow. Issues a single-use state parameter and redirects ' +
    'the browser to the Slack authorization screen.',
  tags: ['Slack'],
  responses: {
    302: { description: 'Redirect to the Slack authorization URL.' },
    200: { description: 'Installation landing page (when directInstall is disabled).' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/slack/oauth_redirect',
  summary: 'Slack OAuth redirect (callback)',
  description:
    'Completes the OAuth flow: verifies the state parameter, exchanges the code ' +
    'for tokens, and persists the encrypted installation.',
  tags: ['Slack'],
  request: {
    query: z.object({
      code: z.string().openapi({ description: 'Authorization code from Slack.' }),
      state: z.string().openapi({ description: 'Single-use state parameter.' }),
    }),
  },
  responses: {
    200: { description: 'Installation succeeded.' },
    302: { description: 'Redirect after a successful install.' },
    500: { description: 'OAuth exchange or state verification failed.' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/slack/events',
  summary: 'Slack Events API endpoint',
  description:
    'Receives Slack events, slash commands, and interactivity payloads. The raw ' +
    'body is signature-verified against SLACK_SIGNING_SECRET before processing.',
  tags: ['Slack'],
  request: { body: { content: json(SlackEventEnvelope) } },
  responses: {
    200: { description: 'Event acknowledged (echoes challenge on url_verification).' },
    401: { description: 'Request signature verification failed.' },
  },
});

/** Generate the OpenAPI 3.0 document for the MyQueue HTTP surface. */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'MyQueue API',
      version: appInfo.version,
      description:
        'MyQueue platform API: infrastructure probes and the Slack OAuth/install surface (Phase 2).',
    },
    servers: [{ url: env.APP_BASE_URL }],
  });
}

export const openApiDocument = buildOpenApiDocument();
