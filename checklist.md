# MyQueue — Launch Checklist (step by step)

Your personal, ordered walk-through to take MyQueue from "code complete" to "live
and submitted to the Slack Marketplace". Tick each box in order. Deeper detail for
every step is linked into `docs/`. The formal go/no-go gate lives in
[docs/release-checklist.md](docs/release-checklist.md); this file is the _how_.

> **Legend:** 🧑‍💼 = a business/legal decision only you can make · 🔧 = a hands-on
> technical step · ⏱️ = rough effort.

---

## Step 0 — Decisions to make first 🧑‍💼

Make these four calls before touching infrastructure; everything downstream needs
them.

- [ ] **Where to deploy: App Platform vs Droplet.**
      **➡️ Recommended: DigitalOcean App Platform** (managed TLS, scaling, host).
      Pick a Droplet only if you want lower cost and are happy running the host.
      Detail: [docs/digitalocean-deployment.md](docs/digitalocean-deployment.md).
- [ ] **Production domain** (e.g. `app.myqueue.com`). This becomes `APP_BASE_URL`
      and every Slack redirect/event URL.
- [ ] **Legal entity, support email, and jurisdiction** for the privacy policy and
      terms (fills the `[COUNSEL]` placeholders).
- [ ] **Billing on or off at launch?** If off, skip all Stripe steps and ship
      Free-only. You can enable billing later with zero code changes.

---

## Step 1 — Provision infrastructure 🔧 ⏱️ ~1 hr

All on DigitalOcean unless noted.

- [ ] **Managed PostgreSQL** database → copy its connection string for
      `DATABASE_URL`. Restrict access to the app's private network.
- [ ] **Managed Redis / Valkey** with persistence → connection string for
      `REDIS_URL`. Restrict to the private network.
- [ ] **Container registry** (DigitalOcean Container Registry or GHCR) to hold the
      runtime image.
- [ ] **Domain + DNS** pointed at the deployment; HTTPS will terminate at App
      Platform (or your Droplet's reverse proxy).

---

## Step 2 — Generate secrets 🔧 ⏱️ ~10 min

Run each locally and store the output in your secret manager (never commit these):

```bash
# ENCRYPTION_KEY  — 32 bytes hex (64 chars). Encrypts Slack tokens at rest.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# SLACK_STATE_SECRET — 32 bytes hex (64 chars). OAuth CSRF/replay protection.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# AUTH_TOKEN_SECRET — >= 32 chars. Signs API bearer tokens.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

- [ ] `ENCRYPTION_KEY` generated and **backed up securely** (losing it makes every
      stored Slack install unusable — never rotate without a re-encryption plan).
- [ ] `SLACK_STATE_SECRET` generated.
- [ ] `AUTH_TOKEN_SECRET` generated and backed up.

---

## Step 3 — Create the Slack app & collect credentials 🔧 ⏱️ ~20 min

Full walkthrough: [docs/slack.md](docs/slack.md) §1.

- [ ] Create the app at <https://api.slack.com/apps> → **From scratch**.
- [ ] From **Basic Information** copy → `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`,
      `SLACK_SIGNING_SECRET`.
- [ ] Leave portal URL config until Step 7 (you need the app deployed first), but
      keep this app open.

> You'll come back to the portal in Step 7 to wire redirect/event URLs and scopes.

---

## Step 4 — Set the production environment variables 🔧

Set these as App-level secrets (App Platform) or in a host `.env` (Droplet). The
app validates everything at boot and **refuses to start** if any required value is
missing or invalid. Full reference: [docs/environment.md](docs/environment.md).

**Required (always):**

| Variable             | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| `NODE_ENV`           | `production`                                                 |
| `APP_BASE_URL`       | `https://YOUR_DOMAIN` (from Step 0)                          |
| `DATABASE_URL`       | Managed PostgreSQL string (Step 1)                          |
| `REDIS_URL`          | Managed Redis string (Step 1)                               |
| `ENCRYPTION_KEY`     | 64-hex key (Step 2)                                          |
| `AUTH_TOKEN_SECRET`  | >= 32-char secret (Step 2)                                  |
| `CORS_ORIGINS`       | Explicit origin(s), comma-separated — **never `*`**          |
| `TRUST_PROXY`        | `true` (behind App Platform / a reverse proxy)             |
| `SLACK_CLIENT_ID`    | from Step 3                                                  |
| `SLACK_CLIENT_SECRET`| from Step 3                                                  |
| `SLACK_SIGNING_SECRET`| from Step 3                                                 |
| `SLACK_STATE_SECRET` | 64-hex secret (Step 2)                                       |

**Has a sensible default — only set to override:** `PORT` (3000), `LOG_LEVEL`
(info), `SLACK_BOT_SCOPES` (the default least-privilege set is correct),
`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`, and the `QUEUE_*` tuning vars.

**Stripe — only if billing is ON (Step 0):** `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, and the `STRIPE_PRICE_PRO` / `STRIPE_PRICE_BUSINESS`
price ids. Point the Stripe webhook at `{APP_BASE_URL}/api/v1/billing/webhook`.

- [ ] All required vars set.
- [ ] `ENCRYPTION_KEY` + `AUTH_TOKEN_SECRET` also recorded in your secret backup.
- [ ] Stripe vars set **or** confirmed intentionally omitted (Free-only launch).

---

## Step 5 — Build & push the image 🔧 ⏱️ ~15 min

One image, built at a specific commit, produces both processes.

```bash
docker build --target runtime -t YOUR_REGISTRY/myqueue:<sha> .
docker push YOUR_REGISTRY/myqueue:<sha>
```

- [ ] Runtime image built and pushed to your registry, tagged with the commit sha.
- [ ] Keep the **previous two tags** available so rollback is a tag swap, never a
      rebuild ([docs/deployment.md](docs/deployment.md) §Rollback).

---

## Step 6 — Deploy

### Path A — App Platform (recommended) 🔧 ⏱️ ~45 min

Detail: [docs/digitalocean-deployment.md](docs/digitalocean-deployment.md) Option A.

- [ ] Create the App from your image with **two components** off the same image:
      - **Web Service** → run `node dist/server.js`, HTTP port `3000`.
      - **Worker** → run `node dist/workers/index.js` (no HTTP), **1 instance**.
- [ ] Attach the Managed PostgreSQL + Redis and expose them as `DATABASE_URL` /
      `REDIS_URL`.
- [ ] Add a **pre-deploy Job** running `npx prisma migrate deploy` (this is Step 7).
- [ ] Add all env vars from Step 4 as App-level secrets.
- [ ] Set the Web Service **health check** to `GET /ready`; liveness `GET /health`.
- [ ] Scale the Web Service horizontally if needed (rate limiting is Redis-shared);
      keep the **Worker at a single instance**.

### Path B — Droplet + Docker Compose (alternative) 🔧

Detail: [docs/digitalocean-deployment.md](docs/digitalocean-deployment.md) Option B.

- [ ] Provision an Ubuntu LTS Droplet; install Docker + the Compose plugin.
- [ ] Put **Caddy or Nginx** in front to terminate TLS for your domain → port 3000.
- [ ] Provide all Step 4 vars via a host `.env` (never committed).
- [ ] `docker compose up -d` — `migrate` runs first, then `api` + `worker` start
      only on its success. Confirm with `docker compose ps`.

---

## Step 7 — Apply database migrations 🔧

Must run **before** the app serves traffic, using the **same commit** as the image.

- [ ] App Platform: the pre-deploy Job ran `npx prisma migrate deploy` and exited 0.
- [ ] Droplet: the Compose `migrate` service shows `Exited (0)`.
- [ ] Migrations are forward-only — never edit an applied migration; fix forward.

---

## Step 8 — Verify the deployment 🔧 ⏱️ ~10 min

From the **public domain** ([docs/deployment.md](docs/deployment.md) §Verify):

- [ ] `GET /version` returns the expected version.
- [ ] `GET /ready` returns `200` (confirms PostgreSQL + Redis reachable).
- [ ] `GET /health` returns `200`.
- [ ] `GET /api/v1/queue/scheduler` returns sane counts; worker logs show
      "worker runtime started".

---

## Step 9 — Configure the Slack app portal 🔧 ⏱️ ~20 min

Now that the domain is live. Detail: [docs/slack.md](docs/slack.md) §3, §6.

- [ ] **OAuth & Permissions → Redirect URLs:** add
      `https://YOUR_DOMAIN/slack/oauth_redirect`.
- [ ] **OAuth & Permissions → Bot Token Scopes:** set exactly to
      `commands, chat:write, im:write, users:read, team:read` (match
      `SLACK_BOT_SCOPES`).
- [ ] **Event Subscriptions:** Request URL `https://YOUR_DOMAIN/slack/events`
      (Slack's challenge is answered automatically); subscribe to the
      `app_home_opened` bot event.
- [ ] **Interactivity & Shortcuts:** turn on; Request URL
      `https://YOUR_DOMAIN/slack/events`. Add a **message** shortcut "Add to MyQueue".
- [ ] **Slash Commands:** create `/myqueue` → same Request URL.
- [ ] **App Home:** enable the Home Tab.

---

## Step 10 — End-to-end test in a clean workspace 🔧 ⏱️ ~20 min

- [ ] Install via `https://YOUR_DOMAIN/slack/install`; consent screen scopes match.
- [ ] App Home tab renders your ranked queue.
- [ ] `/myqueue` views work; `/myqueue token` returns a bearer token.
- [ ] "Add to MyQueue" message shortcut creates an item (no message text stored).
- [ ] Item action buttons (Start/Snooze/Complete…) re-render in place.
- [ ] You receive a notification DM (e.g. assignment).
- [ ] **Uninstall** the app → the workspace is marked uninstalled (verify logs).
- [ ] (If billing on) run a test Checkout and confirm the plan updates via webhook.

---

## Step 11 — Legal, branding & listing copy 🧑‍💼 ⏱️ depends on counsel

- [ ] Fill `[COUNSEL]` placeholders in
      [docs/privacy-policy.md](docs/privacy-policy.md) and
      [docs/terms-of-service.md](docs/terms-of-service.md); have counsel review;
      publish both at live HTTPS URLs.
- [ ] Set retention period + deletion SLA in
      [docs/compliance-checklist.md](docs/compliance-checklist.md).
- [ ] Produce branding assets per
      [docs/marketplace-readiness.md](docs/marketplace-readiness.md) §4 (512×512
      icon, banner, screenshots, descriptions).
- [ ] Stand up a **support contact** and a **pricing page**.

---

## Step 12 — Observability, backups & resilience 🔧

- [ ] Alerts wired for key signals —
      [docs/monitoring-and-alerting.md](docs/monitoring-and-alerting.md).
- [ ] Log forwarding configured.
- [ ] Automated PostgreSQL backups enabled **and a restore drill completed** —
      [docs/disaster-recovery.md](docs/disaster-recovery.md).
- [ ] 🧑‍💼 RTO/RPO targets set; on-call/escalation documented.
- [ ] Rollback rehearsed once (tag swap to the previous image).

---

## Step 13 — Submit to the Slack Marketplace 🧑‍💼 🔧

Work [docs/marketplace-readiness.md](docs/marketplace-readiness.md) §6.

- [ ] Deployment live at a stable HTTPS domain; `/health`, `/ready`, `/version`
      green.
- [ ] Portal config (Step 9) complete; scopes match exactly.
- [ ] Branding assets uploaded; privacy/ToS/support/pricing links live.
- [ ] Data-handling answers prepared (no message content stored; tenant isolation;
      encryption at rest).
- [ ] Security ([docs/security-audit.md](docs/security-audit.md)) and accessibility
      ([docs/accessibility-audit.md](docs/accessibility-audit.md)) materials ready.
- [ ] Submit for review.

---

## Step 14 — Merge the PR chain 🔧

The phase branches are stacked PRs; **merge bottom-up** so each base resolves
cleanly: PR #1/#2 → #3 → #4 → #5 (Phase 7) → #6 (Phase 8). Review each, then merge
in order into the one below it, finishing at `main`.

- [ ] All PRs reviewed and merged in order; `main` is the released commit.

---

## Final — Go / No-Go ✅

Ship only when **Steps 1–10 are green**, the **legal/branding items (Step 11) are
signed off**, and **backups + a restore drill (Step 12) are done**. Record the
decision in the table at the bottom of
[docs/release-checklist.md](docs/release-checklist.md): decision, date,
commit/tag, owner.
