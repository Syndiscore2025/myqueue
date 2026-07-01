# Security Audit

A control-by-control review of MyQueue's security posture: what is implemented in
the codebase, and the gaps/recommendations that remain before and after launch.
This is an internal engineering audit, not a third-party penetration test.

## Summary

MyQueue is built multi-tenant-first: every record and query is scoped by
`workspaceId`, secrets are encrypted at rest, the API is authenticated with
signed tokens anchored to verified Slack identity, and the HTTP surface is
hardened (strict CSP, CORS allowlist, shared rate limiting). The main remaining
items are operational/business rather than code: a third-party pen test, secret
rotation procedures, and dependency-scanning automation.

## Controls implemented

### Tenant isolation

- Every repository query and write is scoped by `workspaceId`; tenant-scoped
  routes derive the workspace from a verified principal, never from arbitrary
  client input in production.

### Secrets & cryptography

- Slack bot tokens encrypted at rest with **AES-256-GCM** (`TokenService`,
  `ENCRYPTION_KEY`, 64 hex chars), never logged or echoed.
- `ENCRYPTION_KEY` and `AUTH_TOKEN_SECRET` are **required in production**; the
  process refuses to boot on invalid config (`src/config/env.ts`, Zod).
- Pino redacts secret fields and `Authorization` headers in logs.

### Authentication & authorization

- API auth is a **stateless HS256 bearer token** verified with a constant-time
  comparison (`SignedTokenService.verify`, `timingSafeEqual`); invalid/expired/
  malformed tokens yield a single non-revealing `401`.
- Tokens are anchored to a **verified Slack identity** (`/myqueue token`); Slack
  is the trust root. The dev-only `x-workspace-id`/`x-worker-id` header fallback
  is **disabled in production**.
- A pluggable `AuthVerifier` seam lets a host integrate their own IdP without
  touching the guards.

### Slack trust boundary

- Inbound Slack requests are **signature-verified** (Bolt) with a 5-minute replay
  window; OAuth `state` is server-side, single-use, and expires in 10 minutes
  (CSRF/replay protection).
- Stripe webhooks are **HMAC signature-verified** against `STRIPE_WEBHOOK_SECRET`.

### HTTP hardening

- **Helmet** with a strict CSP for the JSON API (`default-src 'self'`,
  `object-src 'none'`); a relaxed CSP is scoped to the Swagger docs routes only.
- **CORS** driven by `CORS_ORIGINS` (explicit allowlist; `*` is dev-only and
  disables credentials).
- **Redis-backed rate limiting** shared across instances, standardised
  `RateLimit-*` headers, JSON error envelope; **fails open** on a Redis outage.

### Data minimisation

- The "Add to MyQueue" shortcut stores **no message content** — only a permalink
  and channel/message/thread ids.

### Resilience

- Notification delivery and the idempotency guard fail safe; Slack/Redis outages
  degrade gracefully rather than breaking use cases.

## Gaps & recommendations

| Area | Status | Recommendation |
| --- | --- | --- |
| Third-party pen test | Not done | **[BUSINESS]** Commission before public launch. |
| Secret rotation | Not formalised | **[BUSINESS]** Document rotation for `ENCRYPTION_KEY` (with token re-encryption plan), `AUTH_TOKEN_SECRET`, Slack/Stripe creds. |
| Dependency scanning | Manual | Add automated SCA (e.g. `npm audit` / Dependabot) to CI. |
| Per-identity rate limiting | IP-based | Layer per-identity keys now that auth establishes identity. |
| Brute-force/abuse monitoring | Basic | **[BUSINESS]** Add alerting on auth-failure spikes (see monitoring guide). |
| Backup encryption & access | Provider default | **[BUSINESS]** Confirm encryption + least-privilege access to DB backups and the key store. |
| Incident response | Runbooks exist | **[BUSINESS]** Add a security incident + breach-notification procedure. |

## Verification

- The full quality gate (lint, typecheck, tests, build) runs in CI; integration
  tests (gated) exercise auth, tenancy, and concurrency against a real database.
- Config validation is covered by unit tests; the security middleware is exercised
  by the HTTP test suite.

## See also

- [compliance-checklist.md](./compliance-checklist.md) — GDPR/CCPA and retention.
- [monitoring-and-alerting.md](./monitoring-and-alerting.md) — security signals.
- [environment.md](./environment.md) — every security-relevant variable.
