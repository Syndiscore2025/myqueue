# Slack Marketplace Readiness

The submission checklist for listing MyQueue on the Slack Marketplace, the OAuth
flow review, the least-privilege scope justification, and the branding assets the
business must supply. Slack's own requirements are authoritative; this maps them
to what MyQueue already implements and what still needs business input.

> Items marked **[BUSINESS]** require company-specific decisions or assets that
> cannot be derived from the codebase.

## 1. OAuth flow review

MyQueue uses Slack OAuth v2 with a server-side, single-use, expiring `state`,
matching Slack's security expectations (see [slack.md](./slack.md) §4):

- **Install entry:** `GET /slack/install` issues a single-use `state` (stored in
  Postgres, expires after 10 minutes) and redirects to Slack's consent screen.
- **Callback:** `GET /slack/oauth_redirect` verifies and consumes the `state`
  once (CSRF + replay protection), exchanges the `code` for tokens, and persists
  an encrypted installation.
- **Tokens at rest:** bot tokens are AES-256-GCM encrypted via `ENCRYPTION_KEY`;
  never logged or echoed.
- **Uninstall:** the `app_uninstalled` event revokes the installation and marks
  the workspace uninstalled.
- **Request verification:** all Slack requests to `/slack/events` are
  signature-verified with a 5-minute replay window; retries are idempotent.

✅ The flow is implemented and tenant-isolated. **[BUSINESS]** Confirm the
production redirect URL and that it is added to the portal's Redirect URLs.

## 2. Scope justification (least privilege)

Default bot scopes (`SLACK_BOT_SCOPES`) and user scopes (`SLACK_USER_SCOPES`),
each mapped to the feature that needs it. MyQueue must not request scopes for
planned future features; every scope below backs implemented, testable Slack
functionality.

| Scope | Why it is needed | Feature |
| --- | --- | --- |
| `commands` | Receive the `/myqueue` slash command. | In-Slack navigation. |
| `chat:write` | Post Block Kit messages (notifications). | Phase 5 DMs. |
| `im:write` | Open a DM channel (`conversations.open`) before posting. | Phase 5 DMs. |
| `im:read` | Resolve 1:1 DM membership metadata where authorized. | Personal DM capture. |
| `im:history` | Receive app/bot DM events where authorized. | DM attention pointers. |
| `users:read` | Resolve a Slack user to a workspace user. | Identity mapping. |
| `team:read` | Read the workspace/team metadata at install. | Tenant setup. |
| `channels:read` | Resolve public channel metadata. | Channel attention context. |
| `channels:history` | Receive public-channel message events where app has visibility. | Mention attention pointers. |
| `groups:read` | Resolve private channel metadata where the app is a member. | Private-channel context. |
| `groups:history` | Receive private-channel events where the app is a member. | Private-channel attention pointers. |
| `mpim:read` | Resolve group-DM metadata where allowed. | Group-DM context. |
| `mpim:history` | Receive group-DM events where allowed. | Group-DM attention pointers. |

User token scopes:

| Scope | Why it is needed | Feature |
| --- | --- | --- |
| `im:read` | Resolve authorized personal DM membership metadata. | Personal DM recipient detection. |
| `im:history` | Receive authorized personal DM message events. | Personal DM attention pointers. |

Scopes are env-driven (CSV) so they can change without code edits; keep the
portal scopes aligned. MyQueue requests no `admin.*`, `search:read`, workflow,
file, legacy `read`/`post`/`client`, `identity.*`, `triggers:*`, or coded
workflow scopes. Message event scopes are used only to create privacy-safe
attention pointers and MCA edition classifier signals; message bodies are not
persisted.

✅ Scope set is minimal and justified. **[BUSINESS]** Re-confirm at submission
time that no scope is requested beyond those in active use.

## 3. Data handling for review

Slack's review asks how customer data is handled:

- **No message content stored.** Automatic capture and shortcuts persist only a
  permalink plus channel/message/thread ids, priority, derived classifier signal,
  and a generic title (see [slack.md](./slack.md) §6).
- **Tenant isolation.** Every record and query is scoped by `workspaceId`.
- **Secrets.** Slack tokens encrypted at rest; broad log redaction of secret
  fields and headers.
- **Slack privacy model.** MyQueue only acts on events Slack delivers to the app
  or the authorized user. It does not grant users access to channels, DMs, or
  messages they cannot already access in Slack.
- **No in-Slack financial transactions.** The MCA edition understands funding
  language for attention triage only. It does not approve, fund, transfer, mint,
  or execute financial transactions in Slack.
- **Retention/deletion.** See the privacy policy and compliance checklist
  (Slice 4) for the retention schedule and deletion-on-request process.

## 4. Marketplace eligibility notes

- MyQueue includes functionality inside Slack: App Home, `/myqueue`, shortcuts,
  events, notifications, and Block Kit actions.
- MyQueue is not a coded workflow app and does not request coded workflow scopes.
- MyQueue should not be submitted while still in private beta or while core Slack
  functionality is incomplete.
- Slack requires the app to be installed on 5+ active workspaces before
  Marketplace submission, unless Slack's current policy grants an exception.
- Marketplace reviewers need a production-ready install flow, test account
  details for the non-Slack service if applicable, and a demo video covering
  install, setup, end-to-end use, and uninstall.
- Any future scope additions require review planning, updated OAuth URLs after
  approval, and likely a demo/staging app.

## 5. Branding assets [BUSINESS]

Slack listings require these assets. MyQueue ships none of them; the business
must supply final artwork to spec:

| Asset | Spec (verify against Slack's current guidelines) |
| --- | --- |
| App icon | Square, 512×512 px PNG, no transparency, safe padding. |
| Background / banner | Per Slack's current Marketplace listing template. |
| Short description | One sentence (≤ ~140 chars). |
| Long description | Feature overview, value prop, supported workflows. |
| Screenshots | App Home dashboard, `/myqueue` views, a notification DM. |
| Demo/video (optional) | Short walkthrough of adding and acting on an item. |

Use the [user guide](./user-guide.md) as the source for accurate feature copy and
screenshot scenarios.

## 6. Legal & support links [BUSINESS]

The listing must link to:

- **Privacy policy** URL — see [privacy-policy.md](./privacy-policy.md) (templated
  in Slice 4; needs the legal entity, contact, and jurisdiction).
- **Terms of service** URL — see [terms-of-service.md](./terms-of-service.md).
- **Support contact** — a monitored email/URL.
- **Pricing page** — reflecting the Free/Pro/Business tiers (see the
  [admin guide](./admin-guide.md)).

## 7. Submission checklist

- [ ] Production deployment live at a stable HTTPS domain (`APP_BASE_URL`).
- [ ] Portal Redirect URLs, Event Subscriptions, Interactivity, Slash Commands,
      and App Home configured per [slack.md](./slack.md). **[BUSINESS]** domain.
- [ ] Bot/User scopes in the portal exactly match `SLACK_BOT_SCOPES` and
      `SLACK_USER_SCOPES`.
- [ ] OAuth install/uninstall verified end-to-end in a clean workspace.
- [ ] End-to-end testing completed on a workspace that is not the development workspace.
- [ ] App installed on 5+ active workspaces before Marketplace submission.
- [ ] Demo video recorded: install/OAuth, setup, App Home, auto capture, priority
      correction, follow-up action, Open chat, and uninstall.
- [ ] `/health`, `/ready`, `/version` green from the public domain.
- [ ] **[BUSINESS]** Branding assets uploaded (§5).
- [ ] **[BUSINESS]** Privacy policy, ToS, support, and pricing links live (§6).
- [ ] Data-handling answers prepared from §3.
- [ ] Security review materials ready (see [security-audit.md](./security-audit.md),
      Slice 6).
- [ ] Accessibility notes prepared (see
      [accessibility-audit.md](./accessibility-audit.md), Slice 6).

## 8. Open business decisions

1. **[BUSINESS]** Legal entity, support contact, and jurisdiction for legal docs.
2. **[BUSINESS]** Production domain and final redirect URL.
3. **[BUSINESS]** Branding artwork and listing copy.
4. **[BUSINESS]** Public pricing presentation for the plan tiers.
