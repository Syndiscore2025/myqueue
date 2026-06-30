# MyQueue Comprehensive Runbook

This document is the high-level handoff for MyQueue: what it is, what it does,
how it works, which credentials exist, where those credentials belong, and how to
re-open the project later in VS Code or a new IDE extension.

> **Security rule:** this file intentionally lists credential **names**, locations,
> and setup steps only. Do not paste real API keys, tokens, passwords, signing
> secrets, OAuth secrets, database URLs, Redis URLs, or `.env` contents into this
> file, chat, screenshots, tickets, commits, or AI tools.

---

## 1. What MyQueue is

MyQueue is a Slack-first personal command center for work attention. It turns the
messy stream of Slack DMs, channel mentions, threads, follow-ups, and reminders
into a private ranked queue for each user.

The product goal is simple:

- conversations stay in Slack;
- MyQueue tracks what needs attention;
- each user gets one ranked, private work list;
- urgent or blocked items rise above routine noise;
- users can open the original Slack chat/message when they are ready to respond.

MyQueue is currently a production-grade Node.js/TypeScript backend intended to
ship as a Slack Marketplace app.

---

## 2. What MyQueue does

### Slack attention capture

MyQueue listens to configured Slack Events API deliveries and creates privacy-safe
attention pointers. A pointer stores metadata such as:

- owner user/workspace id;
- sender Slack user id;
- Slack channel id;
- message timestamp/thread timestamp;
- Slack permalink;
- priority;
- lifecycle status;
- grouped message count.

It does **not** persist normal Slack message bodies for automatic capture.

### App Home queue

Inside Slack, users open **Apps → MyQueue**. The App Home renders queue views for:

- all active items;
- red/yellow/green priority filters;
- working;
- waiting;
- follow-up;
- snoozed;
- archived.

### Queue item controls

Each queue item can expose Slack Block Kit actions for:

- start/working;
- waiting;
- follow-up;
- snooze;
- resolved/done;
- archive;
- open original Slack chat/message;
- mark priority as red/yellow/green.

### Slash command

`/myqueue` lets a user navigate queue views from Slack.

`/myqueue token` mints a short-lived API bearer token for HTTP API use, when token
auth is configured.

### Message shortcut

The Slack message shortcut **Add to MyQueue** manually captures a privacy-safe
reference to a message. It stores channel/timestamp/permalink metadata, not the
message body.

### Notifications and automation

The backend includes Slack notification support for:

- assignment notifications;
- snooze wake-ups;
- follow-up reminders;
- daily digest summaries.

These are deduplicated so retries do not spam users.

---

## 3. MCA edition priority classifier

The default automatic classifier is called the **MCA edition**. It is tuned for
merchant-cash-advance and business-funding language.

The classifier reads message text transiently in memory, assigns a priority, and
then persists only the resulting priority plus metadata. It does not store the
message body.

### Priority levels

| Priority | Meaning | Typical Slack result |
| --- | --- | --- |
| Red | urgent/blocking | Needs immediate action |
| Yellow | needs attention/missing info | Should be reviewed |
| Green | normal/FYI | Low urgency |

### Punctuation is not a signal

Adding punctuation does not escalate priority.

Examples:

- `routine update` → Green
- `routine update!!!` → Green
- `what is the status?` → Green unless there are real priority signals
- `Bitty is asking for proof of ownership` → Yellow
- `Bitty is asking for proof of ownership or they can't proceed` → Red

### MCA edition Red examples

The classifier treats these kinds of terms/phrases as urgent blockers:

- `urgent`, `asap`, `immediately`, `critical`, `blocker`, `blocked`, `stuck`;
- `can't proceed`, `cannot proceed`, `unable to proceed`;
- `can't fund`, `cannot fund`, `unable to fund`, `do not fund`, `stop funding`;
- `funding blocked`, `funding paused`, `funding held`, `funding on hold`;
- `wire rejected`, `ACH rejected`, `ACH was rejected`;
- `file declined`, `offer pulled`, `approval pulled`, `deal lost`;
- `deal is dying`, `deal will die`, `merchant backed out`;
- `merchant disappeared`, `merchant unresponsive`, `merchant will walk`;
- `contract void`, `contract expired`, `offer expired`, `approval expired`;
- `stip blocker`, `missing ownership proof`, `proof of ownership missing`;
- `negative days`, `negative balance days`, `account went negative`;
- `bank account frozen`, `account frozen`, `account closed`;
- `tax lien filed`, `judgment filed`, `bankruptcy filed`;
- `UCC issue`, `stacking issue`, `fraud`, `chargeback`, `default`, `NSF`.

### MCA edition Yellow examples

The classifier treats these kinds of terms/phrases as needs-attention signals:

- `MCA`, `merchant`, `funder`, `lender`, `ISO`, `broker`;
- `underwriting`, `underwriter`, `processor`, `closer`;
- `approval`, `approved`, `contract`, `contracts`, `docs`, `documents`;
- `stip`, `stips`, `stips needed`, `clear stips`, `missing docs`;
- `bank statement`, `bank statements`, `processing statements`;
- `proof of ownership`, `ownership docs`, `ownership percentage`;
- `voided check`, `routing number`, `account number`, `bank login`, `Plaid login`;
- `drivers license`, `EIN`, `SSN`, `TIN`, `DBA`, `SOS`, `COI`, `MID`, `TIB`;
- `entity`, `guarantor`, `guaranty`, `beneficial owner`;
- `sales volume`, `monthly revenue`, `average daily balance`, `NSF count`;
- `factor rate`, `buy rate`, `sell rate`, `RTR`, `payback`, `purchase price`;
- `daily remit`, `weekly remit`, `remittance`, `holdback`, `specified percentage`;
- `gross funding`, `net funding`, `funding amount`, `approval amount`;
- `renewal`, `renewal offer`, `buyout`, `payoff`, `payoff letter`, `balance letter`;
- `same day funding`, `funding call`, `closing call`, `welcome call`;
- `landlord verification`, `site inspection`, `tenant ledger`;
- `credit pull`, `soft pull`, `hard pull`, `background check`;
- `UCC search`, `lien search`, `tax lien`, `judgment search`;
- `KYC review`, `OFAC check`, `business bank account`, `account verification`.

---

## 4. How the system works internally

### Runtime stack

- Runtime: Node.js 22+
- Language: TypeScript, strict mode
- HTTP: Express
- Slack: `@slack/bolt`
- Database: PostgreSQL through Prisma
- Cache/queues: Redis, BullMQ, ioredis
- Validation: Zod
- Logging: Pino
- Tests: Jest
- Formatting/linting: Prettier, ESLint

### Main layers

| Layer | Purpose |
| --- | --- |
| `src/domain` | Pure domain rules: queue statuses, ranking, priority classification |
| `src/application` | Use cases/services: queue operations, Slack identity, billing, notifications |
| `src/infrastructure` | Database, Redis, Slack client adapters, repositories |
| `src/interfaces` | HTTP routes and Slack handlers |
| `src/workers` | Background processors/sweeps |
| `prisma` | Schema and migrations |
| `tests` | Unit and integration tests |

### Slack request flow

1. Slack sends an event/command/action to `POST /slack/events`.
2. The app verifies Slack's request signature using `SLACK_SIGNING_SECRET`.
3. The Slack identity is resolved to a MyQueue workspace/user context.
4. The handler delegates to queue application services.
5. The queue service writes tenant-scoped records in Postgres.
6. Slack App Home or ephemeral replies are re-rendered with Block Kit.

### OAuth install flow

1. A workspace admin visits `/slack/install`.
2. MyQueue creates a signed OAuth state using `SLACK_STATE_SECRET`.
3. Slack redirects back to `/slack/oauth_redirect`.
4. MyQueue exchanges Slack's temporary code for tokens.
5. Tokens are encrypted using `ENCRYPTION_KEY` before storage.
6. The workspace is now installed and can use Slack surfaces.

### Queue lifecycle

Items move through statuses such as:

- New
- Working
- Waiting
- FollowUp
- Snoozed
- Done
- Archived
- Processing
- DeadLetter

Priority and status are separate. Priority decides urgency/ranking; status decides
workflow state.

---

## 5. Production URLs and Slack endpoints

Current production base URL:

- `https://app.myqueue.syndiscore.com`

Slack portal URLs should point to:

- OAuth redirect URL: `https://app.myqueue.syndiscore.com/slack/oauth_redirect`
- Events request URL: `https://app.myqueue.syndiscore.com/slack/events`
- Interactivity request URL: `https://app.myqueue.syndiscore.com/slack/events`
- Slash command request URL: `https://app.myqueue.syndiscore.com/slack/events`

Install URL:

- `https://app.myqueue.syndiscore.com/slack/install`

Useful health URLs:

- `GET /health`
- `GET /ready`
- `GET /version`
- `GET /docs`
- `GET /openapi.json`

---

## 6. Credential inventory

Do not store actual secret values in this file. Store real values in Render,
Slack, Stripe, Supabase/DB provider, GitHub secrets, or a password manager.

### Core runtime credentials

| Variable | Required in production | Where it comes from | Purpose |
| --- | --- | --- | --- |
| `APP_BASE_URL` | yes | public app URL | OAuth callbacks, links, OpenAPI server URL |
| `DATABASE_URL` | yes | Postgres provider/Render/Supabase/etc. | Prisma database connection |
| `REDIS_URL` | yes | Redis provider/Render/etc. | cache, idempotency, queues |
| `ENCRYPTION_KEY` | yes | generate yourself | encrypt Slack tokens at rest |
| `AUTH_TOKEN_SECRET` | yes | generate yourself | sign personal API bearer tokens |

### Slack credentials

| Variable | Where to find/generate | Notes |
| --- | --- | --- |
| `SLACK_CLIENT_ID` | Slack app → Basic Information → App Credentials | not secret like a password, but still keep private |
| `SLACK_CLIENT_SECRET` | Slack app → Basic Information → App Credentials | secret |
| `SLACK_SIGNING_SECRET` | Slack app → Basic Information → App Credentials | secret; verifies inbound Slack requests |
| `SLACK_STATE_SECRET` | generate yourself | protects OAuth state |
| `SLACK_APP_TOKEN` | Slack app-level token | only needed for Socket Mode; leave blank for HTTP mode |
| `SLACK_BOT_SCOPES` | env config + Slack portal | comma-separated OAuth bot scopes |
| `SLACK_USER_SCOPES` | env config + Slack portal | user scopes for authorized personal DM capture |

### Slack scope values

Bot scopes:

```text
commands,chat:write,im:write,im:read,users:read,team:read,channels:read,channels:history,groups:read,groups:history,mpim:read,mpim:history,im:history
```

User scopes:

```text
im:read,im:history
```

### Stripe credentials

Billing is optional. If Stripe credentials are blank, the app runs in Free-only
mode.

| Variable | Where to find | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe dashboard | Checkout, billing portal, API calls |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint | verify Stripe webhook signatures |
| `STRIPE_PRICE_PRO` | Stripe product/price | Pro recurring price id |
| `STRIPE_PRICE_BUSINESS` | Stripe product/price | Business recurring price id |
| `STRIPE_CHECKOUT_SUCCESS_URL` | configured URL | return after successful Checkout |
| `STRIPE_CHECKOUT_CANCEL_URL` | configured URL | return after cancelled Checkout |
| `STRIPE_PORTAL_RETURN_URL` | configured URL | return from billing portal |

Stripe webhook endpoint:

```text
https://app.myqueue.syndiscore.com/api/v1/billing/webhook
```

### Generated secrets

Generate new values with Node.js and store them securely:

```bash
# ENCRYPTION_KEY and SLACK_STATE_SECRET: 64 hex chars
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# AUTH_TOKEN_SECRET: long random token
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Important: after Slack installs exist, do **not** rotate `ENCRYPTION_KEY` unless
you plan a token re-encryption/reinstall process. Existing encrypted Slack tokens
cannot be decrypted with a different key.

---

## 7. Slack app setup checklist

Slack app portal:

- https://api.slack.com/apps

Create/open app:

- App name: `MyQueue`
- Workspace: the intended production Slack workspace

OAuth & Permissions:

- add redirect URL `https://app.myqueue.syndiscore.com/slack/oauth_redirect`;
- add all bot token scopes listed above;
- add user token scopes `im:read` and `im:history`;
- reinstall app after scope changes.

Event Subscriptions:

- enable events;
- request URL `https://app.myqueue.syndiscore.com/slack/events`;
- subscribe to bot events:
  - `app_home_opened`
  - `message.channels`
  - `message.groups`
  - `message.mpim`
  - `message.im`
- subscribe to events on behalf of users:
  - `message.im`

Interactivity & Shortcuts:

- enable interactivity;
- request URL `https://app.myqueue.syndiscore.com/slack/events`;
- create message shortcut:
  - name: `Add to MyQueue`
  - callback id: `myqueue_add_message`
  - short description: `Save this message to your queue`

Slash Commands:

- command: `/myqueue`
- request URL: `https://app.myqueue.syndiscore.com/slack/events`
- short description: `Manage your MyQueue`
- usage hint: `[view|token]`

App Home:

- enable Home Tab;
- leave Messages Tab off unless product requirements change.

After changing scopes/events/interactivity, reinstall the app to the workspace.
Code-only deploys do not require reinstall.

---

## 8. Local development

Prerequisites:

- Node.js 22+
- npm
- Docker Desktop for local Postgres/Redis
- Git
- VS Code or another IDE

Setup:

```bash
npm install
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

Worker process in a second terminal:

```bash
npm run dev:worker
```

Local checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Prisma:

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate
```

For local Slack testing, expose the local server with a tunnel such as ngrok and
set Slack URLs to the tunnel domain. Production Slack should use the production
domain above.

---

## 9. Deploy and release workflow

Current repository:

- `https://github.com/Syndiscore2025/myqueue.git`

Current feature branch during this runbook update:

- `feat/phase-8-marketplace-readiness`

Normal safe workflow:

1. Make code changes.
2. Run focused tests.
3. Run `npm run lint`.
4. Run `npm run typecheck`.
5. Run `npm test`.
6. Commit changes with a clear message.
7. Push branch.
8. Open/merge PR or trigger deployment according to the hosting workflow.
9. Verify production health/readiness.
10. Test Slack flows.

Do not deploy by editing production secrets casually. Use the host's environment
variable UI and rotate secrets only intentionally.

---

## 10. Smoke tests after deploy

### App Home

In Slack:

1. Open **Apps → MyQueue**.
2. Confirm the Home tab renders.
3. Confirm priority/status filters work.

### Slash command

Run:

```text
/myqueue
```

Expected: MyQueue responds with queue controls or a queue view.

### Channel mention

In a channel where MyQueue is invited:

```text
@User please review the docs today
```

Expected: a Yellow pointer appears for the mentioned user.

If the app is not in the channel:

```text
/invite @MyQueue
```

### Personal DM capture

A true live test requires another Slack user or test account. Self-messages should
not be trusted as a full recipient-flow test.

Example from test user to Michael:

```text
Bitty is asking for proof of ownership or they can't proceed
```

Expected: Red pointer in Michael's MyQueue.

Routine DM example:

```text
routine update
```

Expected: Green pointer.

### Manual priority change

In MyQueue App Home:

1. Open an item overflow menu.
2. Select Mark Red, Mark Yellow, or Mark Green.
3. Confirm the Home view refreshes and item priority changes.

---

## 11. Privacy and security commitments

- Slack tokens are encrypted at rest.
- Workspace data is tenant-scoped.
- Slack request signatures are verified.
- OAuth state is single-use/short-lived.
- Automatic capture stores metadata pointers, not message bodies.
- The MCA classifier uses text transiently in memory for priority only.
- Secrets should live only in approved secret stores/environment-variable UIs.
- Do not paste tokens, `.env` contents, or screenshots of token pages into AI/chat.

---

## 12. VS Code / new IDE extension handoff instructions

Use this section when opening the project in a new VS Code AI/coding extension.

### Open the project

1. Clone or open the repository root:
   - `c:\Users\rakin\myqueue\myqueue` on the current Windows machine.
2. Open that folder in VS Code.
3. Confirm the integrated terminal starts at the repository root.
4. Confirm Git branch with:

```bash
git branch --show-current
git status --short
```

### Tell the extension what to read first

Ask the extension to read:

1. `docs/myqueue-comprehensive.md`
2. `README.md`
3. `docs/environment.md`
4. `docs/slack-app-setup.md`
5. `docs/slack.md`
6. `docs/queue-engine.md`

### Give the extension this instruction

Paste this into the new extension, but do **not** include secrets:

```text
This is the MyQueue repository. Read docs/myqueue-comprehensive.md first. Do not
print, request, or store secret values. Treat all API keys, OAuth tokens,
database URLs, Redis URLs, signing secrets, encryption keys, and .env files as
secret. Use .env.example and docs/environment.md for variable names only. Before
editing, inspect the relevant source/tests. After editing, run focused tests,
lint, typecheck, and the full Jest suite when appropriate.
```

### Local env setup for the extension

- Copy `.env.example` to `.env` locally.
- Fill local values manually from password manager/Render/Slack/Stripe as needed.
- Never ask the extension to generate commands that echo or print real secrets.
- Never paste real `.env` contents into the extension chat.

### Safe commands the extension can run

```bash
npm run lint
npm run typecheck
npm test
npm run build
git status --short
git diff --stat
```

### Commands requiring care

- `npm install`: ask first because it changes lockfiles/dependencies.
- database migrations: inspect migration intent first.
- deploy commands: ask first.
- `git push`: ask first unless explicitly instructed.
- secret rotation: ask first and document the rotation plan.

---

## 13. Common troubleshooting

### Slack app does not show in the app portal

Usually this is an account/workspace ownership/session issue. Confirm the browser
is signed into the correct Slack account and workspace, then visit:

- https://api.slack.com/apps

### Event URL verification fails

Check:

- production service is deployed and healthy;
- `APP_BASE_URL` is correct;
- `SLACK_SIGNING_SECRET` is set;
- `/slack/events` is reachable publicly;
- Slack credentials are configured in the runtime environment.

### Events arrive but no DM capture happens

Check:

- user scopes include `im:read` and `im:history`;
- app was reinstalled after scope changes;
- Event Subscriptions includes user `message.im`;
- the installing/authorized user has visibility to the DM;
- app logs for identity resolution errors.

### Channel mention does not create a pointer

Check:

- MyQueue is invited to the channel;
- bot event subscriptions include the relevant channel event type;
- app was reinstalled after scope changes;
- the message mentions another user, not only the sender.

### Priority seems wrong

Remember:

- punctuation does not escalate priority;
- Red means blocker/urgent;
- Yellow means needs attention/missing-info;
- Green means routine/FYI;
- recipient can manually override from App Home.

If MCA terms are missing, add them to `src/domain/queue/priority-classification.ts`
and add tests in `tests/unit/priority-classification.test.ts`.

---

## 14. Key files for future changes

| Area | Files |
| --- | --- |
| Env validation | `src/config/env.ts`, `.env.example`, `docs/environment.md` |
| Slack setup/docs | `docs/slack.md`, `docs/slack-app-setup.md` |
| Slack handlers | `src/interfaces/slack/handlers/*` |
| Slack Block Kit views | `src/interfaces/slack/views/*` |
| Queue service | `src/application/queue/*` |
| Queue domain | `src/domain/queue/*` |
| MCA classifier | `src/domain/queue/priority-classification.ts` |
| Prisma schema | `prisma/schema.prisma` |
| Unit tests | `tests/unit/*` |
| Integration tests | `tests/integration/*` |

---

## 15. Final notes

MyQueue should remain Slack-native and privacy-safe. Do not try to inject custom
controls into Slack's native message composer; Slack does not allow that. The
correct pattern is:

1. classify from message content transiently;
2. store only metadata pointers;
3. let recipients override priority in App Home;
4. link users back to the original Slack conversation for replies.
