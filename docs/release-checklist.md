# Release Checklist

The go/no-go gate for shipping MyQueue to production and submitting to the Slack
Marketplace. Each item links to the doc that covers it. **[BUSINESS]** marks items
needing a business/legal decision or asset that cannot be derived from the code.

## 1. Engineering quality gate

- [ ] `npm run format:check` clean.
- [ ] `npm run lint` clean (zero warnings).
- [ ] `npm run typecheck` clean.
- [ ] `npm test` green.
- [ ] `npm run build` succeeds.
- [ ] Gated integration tests pass against a real DB
      (`RUN_INTEGRATION=true`) — see [testing.md](./testing.md).
- [ ] Docker `runtime` and `migrate` images build clean — see
      [docker.md](./docker.md).

## 2. Configuration & secrets

- [ ] All required production env vars set and validated at boot — see
      [environment.md](./environment.md).
- [ ] `ENCRYPTION_KEY` and `AUTH_TOKEN_SECRET` set (prod-mandatory) and backed up
      securely.
- [ ] `CORS_ORIGINS` set to explicit origins (never `*`); `TRUST_PROXY=true`
      behind the proxy.
- [ ] Slack credentials present; Stripe credentials present if billing is enabled.

## 3. Deployment

- [ ] Target chosen and provisioned (App Platform vs Droplet) — see
      [digitalocean-deployment.md](./digitalocean-deployment.md). **[BUSINESS]**
- [ ] Managed PostgreSQL + Redis (with persistence) provisioned and reachable.
- [ ] Migrations applied with the deployed commit before app start.
- [ ] `/ready` used as the routing gate; `/health`, `/version` verified from the
      public domain.
- [ ] Rollback rehearsed (tag swap) — see [deployment.md](./deployment.md).

## 4. Slack app

- [ ] Portal Redirect URLs, Event Subscriptions, Interactivity, Slash Commands,
      and App Home configured — see [slack.md](./slack.md). **[BUSINESS]** domain.
- [ ] Bot Token Scopes exactly match `SLACK_BOT_SCOPES`.
- [ ] OAuth install **and** uninstall verified end-to-end in a clean workspace —
      see [installation.md](./installation.md).
- [ ] In-Slack surfaces verified: App Home, `/myqueue` views, "Add to MyQueue",
      a notification DM.

## 5. Marketplace submission

- [ ] Submission checklist complete — see
      [marketplace-readiness.md](./marketplace-readiness.md).
- [ ] Scope justification reviewed (least privilege).
- [ ] Data-handling answers prepared.
- [ ] **[BUSINESS]** Branding assets uploaded (icon, screenshots, descriptions).
- [ ] **[BUSINESS]** Privacy policy, ToS, support, and pricing links live.

## 6. Legal & compliance

- [ ] **[BUSINESS]/[COUNSEL]** Privacy policy finalised (placeholders filled,
      counsel-reviewed) — see [privacy-policy.md](./privacy-policy.md).
- [ ] **[BUSINESS]/[COUNSEL]** Terms of service finalised — see
      [terms-of-service.md](./terms-of-service.md).
- [ ] **[BUSINESS]** Retention period, deletion SLA, and process set — see
      [compliance-checklist.md](./compliance-checklist.md).
- [ ] **[BUSINESS]** Sub-processor list and DPAs in place.

## 7. Security

- [ ] Security audit reviewed and gaps triaged — see
      [security-audit.md](./security-audit.md).
- [ ] **[BUSINESS]** Third-party penetration test commissioned/completed.
- [ ] **[BUSINESS]** Secret rotation and breach-notification procedures defined.

## 8. Observability & resilience

- [ ] Alerts wired for the key signals — see
      [monitoring-and-alerting.md](./monitoring-and-alerting.md).
- [ ] Log forwarding configured.
- [ ] Backups enabled and a **restore drill** completed — see
      [disaster-recovery.md](./disaster-recovery.md).
- [ ] **[BUSINESS]** RTO/RPO targets set and on-call/escalation documented.

## 9. Performance

- [ ] Baseline benchmark captured on a representative DB and recorded — see
      [performance-results.md](./performance-results.md).

## 10. Documentation

- [ ] Product report current — see [myqueue-report.md](./myqueue-report.md).
- [ ] User, admin, and installation guides current.
- [ ] API surface reviewed — see [api-review.md](./api-review.md).
- [ ] Accessibility notes reviewed — see
      [accessibility-audit.md](./accessibility-audit.md).
- [ ] README documentation list updated.

## Go / No-go

Ship only when **all engineering items (§1–§3) are complete**, the **Slack app is
verified (§4)**, and every **[BUSINESS]/[COUNSEL]** item required for a public,
legally-compliant launch (§5–§8) is signed off. Record the decision, the deployed
commit/tag, and the sign-off owner here:

| Decision | Date | Commit/tag | Owner |
| --- | --- | --- | --- |
| `{{GO/NO-GO}}` | `{{DATE}}` | `{{TAG}}` | `{{OWNER}}` |
