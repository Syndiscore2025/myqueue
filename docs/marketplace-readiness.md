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

Default bot scopes (`SLACK_BOT_SCOPES`), each mapped to the feature that needs
it. No user scopes are requested.

| Scope | Why it is needed | Feature |
| --- | --- | --- |
| `commands` | Receive the `/myqueue` slash command. | In-Slack navigation. |
| `chat:write` | Post Block Kit messages (notifications). | Phase 5 DMs. |
| `im:write` | Open a DM channel (`conversations.open`) before posting. | Phase 5 DMs. |
| `users:read` | Resolve a Slack user to a workspace user. | Identity mapping. |
| `team:read` | Read the workspace/team metadata at install. | Tenant setup. |

Scopes are env-driven (CSV) so they can change without code edits; keep the
portal's Bot Token Scopes aligned. MyQueue requests no message-history,
file, or channel-read scopes — the "Add to MyQueue" shortcut stores only a
privacy-safe reference and reads no message content.

✅ Scope set is minimal and justified. **[BUSINESS]** Re-confirm at submission
time that no scope is requested beyond those in active use.

## 3. Data handling for review

Slack's review asks how customer data is handled:

- **No message content stored.** The shortcut persists only a permalink plus
  channel/message/thread ids and a generic title (see [slack.md](./slack.md) §6).
- **Tenant isolation.** Every record and query is scoped by `workspaceId`.
- **Secrets.** Slack tokens encrypted at rest; broad log redaction of secret
  fields and headers.
- **Retention/deletion.** See the privacy policy and compliance checklist
  (Slice 4) for the retention schedule and deletion-on-request process.

## 4. Branding assets [BUSINESS]

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

## 5. Legal & support links [BUSINESS]

The listing must link to:

- **Privacy policy** URL — see [privacy-policy.md](./privacy-policy.md) (templated
  in Slice 4; needs the legal entity, contact, and jurisdiction).
- **Terms of service** URL — see [terms-of-service.md](./terms-of-service.md).
- **Support contact** — a monitored email/URL.
- **Pricing page** — reflecting the Free/Pro/Business tiers (see the
  [admin guide](./admin-guide.md)).

## 6. Submission checklist

- [ ] Production deployment live at a stable HTTPS domain (`APP_BASE_URL`).
- [ ] Portal Redirect URLs, Event Subscriptions, Interactivity, Slash Commands,
      and App Home configured per [slack.md](./slack.md). **[BUSINESS]** domain.
- [ ] Bot Token Scopes in the portal exactly match `SLACK_BOT_SCOPES`.
- [ ] OAuth install/uninstall verified end-to-end in a clean workspace.
- [ ] `/health`, `/ready`, `/version` green from the public domain.
- [ ] **[BUSINESS]** Branding assets uploaded (§4).
- [ ] **[BUSINESS]** Privacy policy, ToS, support, and pricing links live (§5).
- [ ] Data-handling answers prepared from §3.
- [ ] Security review materials ready (see [security-audit.md](./security-audit.md),
      Slice 6).
- [ ] Accessibility notes prepared (see
      [accessibility-audit.md](./accessibility-audit.md), Slice 6).

## 7. Open business decisions

1. **[BUSINESS]** Legal entity, support contact, and jurisdiction for legal docs.
2. **[BUSINESS]** Production domain and final redirect URL.
3. **[BUSINESS]** Branding artwork and listing copy.
4. **[BUSINESS]** Public pricing presentation for the plan tiers.
