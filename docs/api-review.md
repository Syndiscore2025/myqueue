# API Review

A review of MyQueue's HTTP API surface: how it is documented, the route map, the
conventions it follows, and recommendations. The API is internal/SaaS-facing
(the primary product surface is Slack); it is fully described by an OpenAPI 3
document generated from Zod schemas.

## Documentation

- The OpenAPI document is generated in `src/interfaces/http/openapi.ts` from the
  same Zod schemas the routes validate against, so the spec cannot drift from the
  implementation.
- Served at **`GET /openapi.json`**; **Swagger UI** is mounted at **`/docs`**
  (the only routes with a relaxed CSP).
- Document metadata: title "MyQueue API", version from `appInfo.version`, server
  set to `APP_BASE_URL`.

## Route map

| Method | Path | Tag | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Health | Liveness. |
| GET | `/ready` | Health | Readiness (PostgreSQL + Redis). |
| GET | `/version` | Health | Build/version. |
| * | `/api/v1/queue/*` | Queue | Queue CRUD, status transitions, scheduling, dead-letter, scheduler stats (see [queue-engine.md](./queue-engine.md)). |
| GET | `/api/v1/workers` | Workers | Registered workers + processing counts. |
| GET/PATCH | `/api/v1/workspace/settings` | Workspace | Read/patch queue + notification settings. |
| GET | `/api/v1/billing/plan` | Billing | Current plan + entitlements. |
| POST | `/api/v1/billing/checkout` | Billing | Start Stripe Checkout. |
| POST | `/api/v1/billing/portal` | Billing | Open billing portal. |
| POST | `/api/v1/billing/webhook` | Billing | Stripe webhook (raw-body, HMAC-verified; mounted before JSON parser). |
| GET | `/api/v1/admin/overview` | Admin | Workspace + billing + entitlements + stats. |
| GET | `/api/v1/analytics/usage` | Analytics | Usage vs plan limits (paid feature). |
| GET | `/openapi.json`, `/docs` | — | API spec + Swagger UI. |
| * | `/slack/*` | Slack | OAuth install/redirect + events (see [slack.md](./slack.md)). |

## Conventions (verified)

- **Auth:** application routes are guarded by workspace/worker context middleware;
  in production every request needs `Authorization: Bearer <token>`.
- **Validation:** request bodies/params/query validated by Zod; invalid input is
  rendered as a consistent error envelope by the central error handler.
- **Error envelope:** errors return `{ error: { code, message } }` with a stable
  machine-readable `code` and the request id logged.
- **Versioning:** the application API is namespaced under `/api/v1`.
- **Tenant scoping:** responses are confined to the acting workspace; raw Stripe
  identifiers are never echoed (only `hasActiveSubscription`).
- **Paid features:** analytics returns `402` without the entitlement; plan-limit
  breaches return `402 PLAN_LIMIT_EXCEEDED`.
- **Rate limiting:** standardised `RateLimit-*` headers; `429` uses the same JSON
  envelope (`RATE_LIMITED`).

## Strengths

- Spec generated from the validation schemas — no drift between docs and code.
- Consistent error and auth model across every route.
- Conditional mounting: Slack and billing surfaces only mount when configured,
  keeping the attack surface minimal in reduced deployments.

## Recommendations

| Item | Recommendation |
| --- | --- |
| Pagination | Confirm list endpoints (queue, dead-letter, workers) expose explicit, documented pagination for large tenants. |
| Per-identity rate limits | Document per-identity limits once layered on top of IP keying. |
| OpenAPI completeness | Ensure every `/api/v1` route (incl. all queue sub-routes) is registered in `openapi.ts`, not just the representative set. |
| Examples | Add request/response examples for the most-used queue endpoints to the spec. |
| Deprecation policy | **[BUSINESS]** Define an API versioning/deprecation policy before exposing the API to external integrators. |

## See also

- [queue-engine.md](./queue-engine.md) — the full queue route reference.
- [admin-guide.md](./admin-guide.md) — workspace/billing/admin/analytics usage.
- [slack.md](./slack.md) — the Slack routes.
