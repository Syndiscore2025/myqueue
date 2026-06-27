import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { appInfo } from '../../config/app-info';
import { env } from '../../config';
import { WORKER_ID_HEADER } from './middleware/worker-context';
import { WORKSPACE_ID_HEADER, WORKSPACE_USER_ID_HEADER } from './middleware/workspace-context';
import {
  assignSchema,
  changeStatusSchema,
  createItemSchema,
  followUpSchema,
  failSchema,
  heartbeatSchema,
  permanentIdParamSchema,
  workerItemSchema,
  queuePrioritySchema,
  queueRankingModeSchema,
  queueSourceTypeSchema,
  queueStatusSchema,
  recalculateSchema,
  requeueDeadLetterSchema,
  snoozeSchema,
  updatePrioritySchema,
  updateSettingsSchema,
  workerStatusSchema,
} from './routes/queue.schemas';
import { startCheckoutSchema, workspacePlanSchema } from './routes/billing.schemas';
import { updateWorkspaceSettingsSchema } from './routes/workspace.schemas';
import { WorkspacePlanStatus } from '../../domain/billing';

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
    'Receives Slack events (e.g. app_home_opened), slash commands (/myqueue), ' +
    'message shortcuts (Add to MyQueue), and Block Kit interactivity payloads. ' +
    'The raw body is signature-verified against SLACK_SIGNING_SECRET before ' +
    'processing, and side-effecting interactions are idempotent across Slack retries.',
  tags: ['Slack'],
  request: { body: { content: json(SlackEventEnvelope) } },
  responses: {
    200: { description: 'Event acknowledged (echoes challenge on url_verification).' },
    401: { description: 'Request signature verification failed.' },
  },
});

// --- Queue API (Phase 3A) ----------------------------------------------------
// Internal/development-safe routes guarded by explicit tenant headers.

const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
      details: z.unknown().optional(),
    }),
  }),
);

const QueueItemSchema = registry.register(
  'QueueItem',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    permanentQueueId: z.string().openapi({ example: 'MQ-000123' }),
    ownerWorkspaceUserId: z.string(),
    creatorWorkspaceUserId: z.string().nullable(),
    title: z.string(),
    summary: z.string().nullable(),
    status: queueStatusSchema,
    priority: queuePrioritySchema,
    sourceType: queueSourceTypeSchema,
    rankingTimestamp: z.string(),
    snoozedUntil: z.string().nullable(),
    followUpDueAt: z.string().nullable(),
    assignedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

const QueueSettingsSchema = registry.register(
  'WorkspaceQueueSettings',
  z.object({
    workspaceId: z.string(),
    rankingMode: queueRankingModeSchema,
    includeWaitingInActive: z.boolean(),
    includeWorkingInActive: z.boolean(),
  }),
);

const WorkerRegistrationSchema = registry.register(
  'WorkerRegistration',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    workerId: z.string().openapi({ example: 'worker-1' }),
    hostname: z.string().nullable(),
    status: workerStatusSchema,
    processingCount: z
      .number()
      .int()
      .openapi({ description: 'Items the worker currently holds in Processing (derived live).' }),
    startedAt: z.string(),
    lastSeenAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);
const WorkersEnvelope = z.object({ workers: z.array(WorkerRegistrationSchema) });

const RankedItem = z.object({ item: QueueItemSchema, position: z.number().int() });
const ItemEnvelope = z.object({ item: QueueItemSchema });
const ItemWithPosition = z.object({
  item: QueueItemSchema,
  position: z.number().int().nullable(),
});
const ItemsEnvelope = z.object({ items: z.array(QueueItemSchema) });
const RankedEnvelope = z.object({ items: z.array(RankedItem) });
const SettingsEnvelope = z.object({ settings: QueueSettingsSchema });

const workspaceHeaders = z.object({
  [WORKSPACE_ID_HEADER]: z.string().openapi({ description: 'Acting workspace (tenant) id.' }),
  [WORKSPACE_USER_ID_HEADER]: z.string().openapi({ description: 'Acting workspace user id.' }),
});

const guarded = {
  400: { description: 'Request validation failed.', content: json(ErrorResponse) },
  401: { description: 'Missing or invalid workspace context.', content: json(ErrorResponse) },
};
const ownerQueryParam = z.object({
  ownerWorkspaceUserId: z
    .string()
    .optional()
    .openapi({ description: 'Owner to scope the view to; defaults to the acting user.' }),
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/items',
  summary: 'Create a queue item',
  description: 'Creates an item; priority is auto-classified from the text when omitted.',
  tags: ['Queue'],
  request: { headers: workspaceHeaders, body: { content: json(createItemSchema) } },
  responses: {
    201: { description: 'Item created.', content: json(ItemEnvelope) },
    ...guarded,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/queue/items/{permanentQueueId}',
  summary: 'Get an item with its active-queue position',
  tags: ['Queue'],
  request: { headers: workspaceHeaders, params: permanentIdParamSchema },
  responses: {
    200: { description: 'The item and its computed position.', content: json(ItemWithPosition) },
    404: { description: 'Item not found in this workspace.', content: json(ErrorResponse) },
    ...guarded,
  },
});

for (const view of ['active', 'waiting', 'follow-up', 'completed-today'] as const) {
  registry.registerPath({
    method: 'get',
    path: `/api/v1/queue/${view}`,
    summary: `List the ${view} queue`,
    tags: ['Queue'],
    request: { headers: workspaceHeaders, query: ownerQueryParam },
    responses: {
      200: {
        description: 'Queue items.',
        content: json(view === 'active' ? RankedEnvelope : ItemsEnvelope),
      },
      ...guarded,
    },
  });
}

const itemAction = (action: string, summary: string, body?: z.ZodTypeAny): void => {
  registry.registerPath({
    method: 'post',
    path: `/api/v1/queue/items/{permanentQueueId}/${action}`,
    summary,
    tags: ['Queue'],
    request: {
      headers: workspaceHeaders,
      params: permanentIdParamSchema,
      ...(body === undefined ? {} : { body: { content: json(body) } }),
    },
    responses: {
      200: { description: 'Updated item.', content: json(ItemEnvelope) },
      404: { description: 'Item not found in this workspace.', content: json(ErrorResponse) },
      ...guarded,
    },
  });
};

itemAction('status', 'Change item status', changeStatusSchema);
itemAction('complete', 'Mark item done');
itemAction('archive', 'Archive item');
itemAction('waiting', 'Move item to waiting');
itemAction('follow-up', 'Move item to follow-up', followUpSchema);
itemAction('snooze', 'Snooze item', snoozeSchema);
itemAction('unsnooze', 'Wake a snoozed item');
itemAction('priority', 'Change item priority', updatePrioritySchema);
itemAction('assign', 'Assign/reassign item owner', assignSchema);

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/recalculate',
  summary: "Recalculate an owner's active queue positions",
  tags: ['Queue'],
  request: { headers: workspaceHeaders, body: { content: json(recalculateSchema) } },
  responses: {
    200: {
      description: 'Ranked items plus their count.',
      content: json(RankedEnvelope.extend({ count: z.number().int() })),
    },
    ...guarded,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/queue/settings',
  summary: 'Read workspace queue settings',
  tags: ['Queue'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'Queue settings.', content: json(SettingsEnvelope) },
    ...guarded,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/queue/settings',
  summary: 'Update workspace queue settings',
  tags: ['Queue'],
  request: { headers: workspaceHeaders, body: { content: json(updateSettingsSchema) } },
  responses: {
    200: { description: 'Updated queue settings.', content: json(SettingsEnvelope) },
    ...guarded,
  },
});

// --- Dead Letter Queue (Phase 3B) --------------------------------------------
// Operator-facing routes guarded by workspace context.

registry.registerPath({
  method: 'get',
  path: '/api/v1/queue/dead-letter',
  summary: 'List dead-lettered items',
  description: 'Items that exhausted their retry budget, oldest dead-lettered first.',
  tags: ['Queue'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'The dead-lettered items.', content: json(ItemsEnvelope) },
    ...guarded,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/dead-letter/requeue',
  summary: 'Requeue a dead-lettered item',
  description:
    'Moves a DeadLetter item back to New, resetting attempt_count and clearing failure state ' +
    'so it receives a fresh processing budget.',
  tags: ['Queue'],
  request: { headers: workspaceHeaders, body: { content: json(requeueDeadLetterSchema) } },
  responses: {
    200: { description: 'The requeued item.', content: json(ItemEnvelope) },
    404: { description: 'No such item in the workspace.', content: json(ErrorResponse) },
    409: { description: 'Item is not in the Dead Letter Queue.', content: json(ErrorResponse) },
    ...guarded,
  },
});

// --- Queue statistics (Phase 3B) ---------------------------------------------
// Operator-facing aggregate view guarded by workspace context.

const QueueStatisticsSchema = registry.register(
  'QueueStatistics',
  z.object({
    counts: z.record(z.string(), z.number().int()).openapi({
      description: 'Item counts keyed by status; every status is present (zero when empty).',
    }),
    averageWaitTimeMs: z.number().nullable(),
    averageProcessingTimeMs: z.number().nullable(),
    totalRetries: z.number().int(),
    averageRetryCount: z.number().nullable(),
    oldestQueuedAt: z.string().nullable(),
    newestQueuedAt: z.string().nullable(),
    averageQueueAgeMs: z.number().nullable(),
    longestProcessingJobMs: z.number().nullable(),
    workerUtilization: z.object({
      totalWorkers: z.number().int(),
      busyWorkers: z.number().int(),
      ratio: z.number().openapi({ description: 'busyWorkers / totalWorkers in [0, 1].' }),
    }),
  }),
);
const StatisticsEnvelope = z.object({ statistics: QueueStatisticsSchema });

registry.registerPath({
  method: 'get',
  path: '/api/v1/queue/statistics',
  summary: 'Read aggregate queue statistics',
  description:
    'Counts by status, average wait/processing time, retries, oldest/newest queued item, ' +
    'average queue age, longest in-flight job, and live worker utilization for the workspace.',
  tags: ['Queue'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'The workspace queue statistics.', content: json(StatisticsEnvelope) },
    ...guarded,
  },
});

// --- Queue worker processing (Phase 3B) --------------------------------------
// Worker-facing routes identified by an explicit worker id rather than a user.

const workerHeaders = z.object({
  [WORKSPACE_ID_HEADER]: z.string().openapi({ description: 'Acting workspace (tenant) id.' }),
  [WORKER_ID_HEADER]: z.string().openapi({ description: 'Claiming worker id.' }),
});
const ClaimEnvelope = z.object({ item: QueueItemSchema.nullable() });

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/claim',
  summary: 'Claim the next queued item for a worker',
  description:
    'Atomically claims the highest-ranked New item (FOR UPDATE SKIP LOCKED), moving it to ' +
    'Processing and stamping the lease. Returns { item: null } when nothing is queued.',
  tags: ['Queue'],
  request: { headers: workerHeaders },
  responses: {
    200: {
      description: 'The claimed item, or null when the queue is empty.',
      content: json(ClaimEnvelope),
    },
    401: { description: 'Missing worker context.', content: json(ErrorResponse) },
  },
});

const HeartbeatEnvelope = z.object({ item: QueueItemSchema });

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/heartbeat',
  summary: 'Extend the lease on an item a worker is processing',
  description:
    'Refreshes heartbeat_at and pushes back lock_expires_at for the named item, provided it ' +
    'is still Processing and still leased by this worker. Workers that stop heartbeating ' +
    'become recoverable.',
  tags: ['Queue'],
  request: { headers: workerHeaders, body: { content: json(heartbeatSchema) } },
  responses: {
    200: { description: 'The item with its refreshed lease.', content: json(HeartbeatEnvelope) },
    401: { description: 'Missing worker context.', content: json(ErrorResponse) },
    404: { description: 'No such item in the workspace.', content: json(ErrorResponse) },
    409: { description: 'The item is not leased by this worker.', content: json(ErrorResponse) },
  },
});

const WorkerItemEnvelope = z.object({ item: QueueItemSchema });

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/complete',
  summary: 'Mark an item as successfully completed by a worker',
  tags: ['Queue'],
  request: { headers: workerHeaders, body: { content: json(workerItemSchema) } },
  responses: {
    200: { description: 'The completed item.', content: json(WorkerItemEnvelope) },
    401: { description: 'Missing worker context.', content: json(ErrorResponse) },
    404: { description: 'No such item.', content: json(ErrorResponse) },
    409: { description: 'Item not leased by this worker.', content: json(ErrorResponse) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/release',
  summary: 'Gracefully release an item back to the queue',
  tags: ['Queue'],
  request: { headers: workerHeaders, body: { content: json(workerItemSchema) } },
  responses: {
    200: { description: 'The released item.', content: json(WorkerItemEnvelope) },
    401: { description: 'Missing worker context.', content: json(ErrorResponse) },
    404: { description: 'No such item.', content: json(ErrorResponse) },
    409: { description: 'Item not leased by this worker.', content: json(ErrorResponse) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/queue/fail',
  summary: 'Report a processing failure; retries or moves to Dead Letter Queue',
  description:
    'Increments attempt_count. If attempts < QUEUE_MAX_RETRIES, re-queues the item (Processing → New). ' +
    'Otherwise moves it to DeadLetter.',
  tags: ['Queue'],
  request: { headers: workerHeaders, body: { content: json(failSchema) } },
  responses: {
    200: { description: 'The failed/re-queued item.', content: json(WorkerItemEnvelope) },
    401: { description: 'Missing worker context.', content: json(ErrorResponse) },
    404: { description: 'No such item.', content: json(ErrorResponse) },
    409: { description: 'Item not leased by this worker.', content: json(ErrorResponse) },
  },
});

// --- Worker registry (Phase 3B) ----------------------------------------------
// Operator-facing read of the workspace's known workers. Workers auto-register
// on their first claim or heartbeat; this route is guarded by workspace context.

registry.registerPath({
  method: 'get',
  path: '/api/v1/workers',
  summary: 'List the workspace registered workers',
  description:
    'Workers auto-register on their first claim or heartbeat. Each entry carries a live ' +
    'processing_count of the items the worker currently holds in Processing.',
  tags: ['Workers'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'The registered workers.', content: json(WorkersEnvelope) },
    ...guarded,
  },
});

// --- SaaS: workspace settings, billing & analytics (Phase 6) -----------------
// Tenant-scoped routes guarded by workspace context. The Stripe webhook is the
// one exception: it is signature-verified rather than header-guarded.

const PlanStatusSchema = z.nativeEnum(WorkspacePlanStatus);

const EntitlementsSchema = registry.register(
  'PlanEntitlements',
  z.object({
    maxActiveItems: z.number().int().nullable().openapi({ description: 'null = unlimited.' }),
    maxWorkers: z.number().int().nullable().openapi({ description: 'null = unlimited.' }),
    maxRecurrenceRules: z.number().int().nullable().openapi({ description: 'null = unlimited.' }),
    dailyDigest: z.boolean(),
    analytics: z.boolean(),
  }),
);

const WorkspaceEntitlementsSchema = registry.register(
  'WorkspaceEntitlements',
  z.object({
    plan: workspacePlanSchema,
    status: PlanStatusSchema,
    entitlements: EntitlementsSchema,
  }),
);
const PlanEnvelope = z.object({ plan: WorkspaceEntitlementsSchema });

const WorkspaceSettingsSchema = registry.register(
  'WorkspaceSettings',
  z.object({
    workspaceId: z.string(),
    rankingMode: queueRankingModeSchema,
    includeWaitingInActive: z.boolean(),
    includeWorkingInActive: z.boolean(),
    notifyOnAssignment: z.boolean(),
    notifyOnSnoozeWake: z.boolean(),
    notifyOnFollowUpDue: z.boolean(),
    dailyDigestEnabled: z.boolean(),
    dailyDigestHourUtc: z.number().int().openapi({ description: 'Digest send hour, 0–23 UTC.' }),
  }),
);
const WorkspaceSettingsEnvelope = z.object({ settings: WorkspaceSettingsSchema });

const CheckoutEnvelope = z.object({
  url: z.string().openapi({ description: 'Hosted provider URL to redirect the admin to.' }),
});

const LimitUsageSchema = z.object({
  used: z.number().int(),
  limit: z.number().int().nullable().openapi({ description: 'null = unlimited.' }),
  remaining: z.number().int().nullable().openapi({ description: 'null = unlimited.' }),
  withinLimit: z.boolean(),
});
const UsageReportSchema = registry.register(
  'UsageReport',
  z.object({
    plan: workspacePlanSchema,
    status: PlanStatusSchema,
    entitlements: EntitlementsSchema,
    usage: z.object({
      activeItems: LimitUsageSchema,
      workers: LimitUsageSchema,
      recurrenceRules: LimitUsageSchema,
    }),
  }),
);
const UsageEnvelope = z.object({ usage: UsageReportSchema });

const AdminOverviewSchema = registry.register(
  'AdminOverview',
  z.object({
    workspace: z.object({
      id: z.string(),
      slackTeamName: z.string().nullable(),
      isEnterpriseInstall: z.boolean(),
      status: z.string(),
      installedAt: z.string(),
      createdAt: z.string(),
    }),
    billing: z.object({
      plan: workspacePlanSchema,
      status: PlanStatusSchema,
      hasActiveSubscription: z.boolean(),
      planUpdatedAt: z.string().nullable(),
    }),
    entitlements: EntitlementsSchema,
    statistics: QueueStatisticsSchema,
  }),
);

const paymentRequired = {
  402: {
    description: 'Plan limit reached or feature not available.',
    content: json(ErrorResponse),
  },
};
const notFound = {
  404: { description: 'Workspace not found.', content: json(ErrorResponse) },
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/workspace/settings',
  summary: 'Read workspace settings and plan',
  description: 'Returns the queue + notification settings together with the plan and entitlements.',
  tags: ['Workspace'],
  request: { headers: workspaceHeaders },
  responses: {
    200: {
      description: 'Settings and plan.',
      content: json(WorkspaceSettingsEnvelope.extend({ plan: WorkspaceEntitlementsSchema })),
    },
    ...guarded,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/workspace/settings',
  summary: 'Update workspace queue & notification settings',
  tags: ['Workspace'],
  request: { headers: workspaceHeaders, body: { content: json(updateWorkspaceSettingsSchema) } },
  responses: {
    200: { description: 'Updated settings.', content: json(WorkspaceSettingsEnvelope) },
    ...guarded,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/billing/plan',
  summary: 'Read the workspace plan and entitlements',
  tags: ['Billing'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'The plan and entitlements in force.', content: json(PlanEnvelope) },
    ...guarded,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/billing/checkout',
  summary: 'Start a hosted checkout session for a plan upgrade',
  tags: ['Billing'],
  request: { headers: workspaceHeaders, body: { content: json(startCheckoutSchema) } },
  responses: {
    200: { description: 'The checkout URL to redirect to.', content: json(CheckoutEnvelope) },
    ...guarded,
    ...notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/billing/portal',
  summary: 'Open the self-serve billing portal',
  description: 'Returns a portal URL for an existing customer to manage or cancel a subscription.',
  tags: ['Billing'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'The billing portal URL.', content: json(CheckoutEnvelope) },
    ...guarded,
    ...notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/billing/webhook',
  summary: 'Stripe webhook receiver',
  description:
    'Receives Stripe subscription events. The raw body is HMAC-verified against the ' +
    'STRIPE_WEBHOOK_SECRET using the Stripe-Signature header before any plan change is applied.',
  tags: ['Billing'],
  request: {
    headers: z.object({
      'stripe-signature': z
        .string()
        .openapi({ description: 'Stripe signature header (t=...,v1=...).' }),
    }),
    body: { content: { 'application/json': { schema: z.unknown() } } },
  },
  responses: {
    200: { description: 'Event received/acknowledged.' },
    400: { description: 'Missing or invalid signature.', content: json(ErrorResponse) },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/overview',
  summary: 'Workspace admin overview',
  description:
    'Consolidated view: workspace identity, billing posture, entitlements, and statistics.',
  tags: ['Admin'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'The workspace overview.', content: json(AdminOverviewSchema) },
    ...guarded,
    ...notFound,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/analytics/usage',
  summary: 'Workspace usage vs plan limits',
  description:
    'Reports current usage of each countable entitlement with remaining headroom. A paid ' +
    'feature: a plan without the analytics entitlement receives 402.',
  tags: ['Analytics'],
  request: { headers: workspaceHeaders },
  responses: {
    200: { description: 'The usage report.', content: json(UsageEnvelope) },
    ...guarded,
    ...paymentRequired,
  },
});

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'MyQueue API',
      version: appInfo.version,
      description:
        'MyQueue platform API: infrastructure probes, the Slack surface — OAuth/install ' +
        '(Phase 2) and the in-Slack experience (Phase 4) — the internal queue API ' +
        '(Phase 3A), and the SaaS surface — workspace settings, billing, admin, and ' +
        'analytics (Phase 6).',
    },
    servers: [{ url: env.APP_BASE_URL }],
  });
}

export const openApiDocument = buildOpenApiDocument();
