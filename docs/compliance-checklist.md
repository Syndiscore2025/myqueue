# Compliance Checklist

Operational compliance posture for MyQueue: data retention/deletion, secrets
handling, and GDPR/CCPA touchpoints. This maps regulatory expectations to what
the codebase implements and what the business must still decide.

> **[COUNSEL]** marks items requiring legal review; **[BUSINESS]** marks items
> requiring a business decision. Engineering controls below reflect the current
> codebase.

## 1. Data inventory

| Data | Where | Sensitivity | Notes |
| --- | --- | --- | --- |
| Slack bot tokens | Postgres (`SlackInstallation`) | High | AES-256-GCM encrypted at rest. |
| Workspace + user identifiers | Postgres | Medium | Tenant-scoped by `workspaceId`. |
| Queue items | Postgres | Low–Medium | No Slack message content stored. |
| Message references | Postgres | Low | Permalink + ids only, no body. |
| Billing identifiers | Postgres | Medium | Stripe ids; no card data stored. |
| Operational logs | Log sink | Low | Secrets/headers redacted (Pino). |

## 2. Secrets handling (implemented)

- Slack tokens encrypted at rest with `ENCRYPTION_KEY` (AES-256-GCM).
- `ENCRYPTION_KEY` and `AUTH_TOKEN_SECRET` required in production; the process
  refuses to boot without valid configuration.
- API auth uses stateless HS256 bearer tokens anchored to verified Slack
  identity; the dev-only header fallback is disabled in production.
- Stripe webhooks are HMAC signature-verified; Slack requests are
  signature-verified with a 5-minute replay window.
- Broad log redaction of secret fields and authorization headers.
- **[BUSINESS]** Define a secret rotation procedure and cadence for
  `ENCRYPTION_KEY`, `AUTH_TOKEN_SECRET`, and Slack/Stripe credentials.

## 3. Data retention & deletion

- **Retention:** tenant data is retained while installed; after uninstall,
  retained for `{{RETENTION_PERIOD}}` then deleted. **[BUSINESS]/[COUNSEL]**
- **Deletion on request:** support a workspace's export/delete request via
  `{{PRIVACY_CONTACT_EMAIL}}` within `{{RESPONSE_SLA}}`.
- **Deletion mechanism:** because every record is scoped by `workspaceId`, a
  deletion is a tenant-scoped purge across the workspace's rows (installation,
  users, items, recurrence/rate-limit rows, audit events, billing columns).
  **[BUSINESS]** Decide whether to offer self-serve deletion or operator-run.
- **Backups:** ensure the retention/deletion policy accounts for backup
  lifecycle (see [disaster-recovery.md](./disaster-recovery.md)).

## 4. GDPR touchpoints [COUNSEL]

- **Roles:** the customer (workspace) is typically the controller; we are the
  processor. Confirm and reflect in a DPA. **[COUNSEL]**
- **Lawful basis:** see the [privacy policy](./privacy-policy.md) §4.
- **Data subject rights:** access, rectification, erasure, portability,
  restriction, objection — fulfilled via the deletion/export process above.
- **Sub-processors:** maintain the list (Slack, Stripe, `{{HOSTING_PROVIDER}}`)
  and DPAs; notify customers of changes.
- **International transfers:** document data location and safeguards (e.g. SCCs).
- **Records of processing (Art. 30):** maintain. **[BUSINESS]/[COUNSEL]**
- **Breach notification:** define a process within 72 hours of awareness.
  **[BUSINESS]**

## 5. CCPA/CPRA touchpoints [COUNSEL]

- We do not sell personal information.
- Honour access/deletion requests for California residents via the same process.
- Provide the required "Do Not Sell/Share" and notice-at-collection statements if
  applicable. **[COUNSEL]**

## 6. Slack Marketplace data requirements

- No message-history/file scopes requested; no message content stored.
- Tokens encrypted at rest; tenant isolation enforced.
- Privacy policy and ToS links live (Slices linked from
  [marketplace-readiness.md](./marketplace-readiness.md)).

## 7. Outstanding actions

- [ ] **[COUNSEL]** Finalise privacy policy and ToS placeholders.
- [ ] **[COUNSEL]** Confirm controller/processor roles and execute DPAs.
- [ ] **[BUSINESS]** Set retention period and deletion SLA.
- [ ] **[BUSINESS]** Define secret rotation and breach-notification procedures.
- [ ] **[BUSINESS]** Choose self-serve vs operator-run data deletion.
- [ ] **[BUSINESS]** Maintain the sub-processor list and Records of Processing.
