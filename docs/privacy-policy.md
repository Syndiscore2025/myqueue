# Privacy Policy (Template)

> **TEMPLATE — NOT LEGAL ADVICE.** This is a starting draft grounded in how
> MyQueue actually handles data. Replace every `{{PLACEHOLDER}}` and have it
> reviewed by qualified legal counsel before publishing. Items needing counsel
> are flagged **[COUNSEL]**.

**Effective date:** `{{EFFECTIVE_DATE}}`
**Provider:** `{{LEGAL_ENTITY_NAME}}` ("we", "us"), `{{ENTITY_ADDRESS}}`
**Contact:** `{{PRIVACY_CONTACT_EMAIL}}`

## 1. Scope

This policy explains how MyQueue ("the App") collects, uses, and protects data
when a Slack workspace installs and uses it. It covers the App only and not Slack
itself or any third-party service you connect.

## 2. Data we collect

MyQueue is designed for data minimisation. We collect:

- **Workspace / installation data:** Slack workspace (team) id and name, whether
  it is an enterprise install, installation timestamps, and the OAuth bot token
  (stored **encrypted at rest**, AES-256-GCM).
- **User identifiers:** the Slack user id and display name of users who interact
  with the App, mapped to an internal workspace user for queue ownership.
- **Queue items:** titles, priority, status, scheduling/snooze/follow-up times,
  and lifecycle metadata you create.
- **Message references (shortcut):** when you use "Add to MyQueue", a
  privacy-safe reference only — a permalink and the channel/message/thread ids.
  **We do not store the message text.**
- **Billing data:** plan, billing status, and Stripe customer/subscription
  identifiers (payment card data is handled by Stripe, not stored by us).
- **Operational logs:** request metadata and errors, with secret fields and
  tokens redacted.

We do **not** request Slack scopes to read message history, files, or channel
contents.

## 3. How we use data

- Provide the queue service (ranking, notifications, scheduling) within your
  workspace.
- Enforce plan entitlements and process billing via Stripe.
- Operate, secure, debug, and improve the service.
- Send transactional Slack DMs (assignment, snooze-wake, follow-up, optional
  digest) per your workspace's notification preferences.

We do **not** sell personal data. **[COUNSEL]** Confirm any analytics/marketing
uses and lawful bases.

## 4. Legal bases [COUNSEL]

`{{LEGAL_BASES}}` — e.g. performance of a contract and legitimate interests
(GDPR Art. 6) for EU/UK users. Confirm with counsel for your jurisdictions.

## 5. Sharing & sub-processors

We share data only with sub-processors necessary to run the service:

| Sub-processor | Purpose |
| --- | --- |
| Slack | The platform the App runs on. |
| Stripe | Payment processing and billing. |
| `{{HOSTING_PROVIDER}}` | Application hosting / database / cache. |
| `{{OTHER_SUBPROCESSORS}}` | `{{PURPOSE}}` |

**[COUNSEL]** Maintain an accurate sub-processor list and any DPAs.

## 6. Data retention & deletion

- Workspace and queue data are retained while the App is installed.
- On uninstall, the installation is revoked and tokens are invalidated; remaining
  tenant data is retained for `{{RETENTION_PERIOD}}` then deleted.
- You may request export or deletion of your workspace's data by contacting
  `{{PRIVACY_CONTACT_EMAIL}}`; we will respond within `{{RESPONSE_SLA}}`.

See [compliance-checklist.md](./compliance-checklist.md) for the operational
deletion process. **[COUNSEL]** Confirm retention periods and SLAs.

## 7. Security

We apply tenant isolation (every record scoped to a workspace), encryption of
Slack tokens at rest, signed-token API authentication, Slack request-signature
verification, transport encryption (HTTPS), and log redaction of secrets. No
system is perfectly secure; we cannot guarantee absolute security.

## 8. International transfers [COUNSEL]

`{{TRANSFER_MECHANISM}}` — describe data location(s) and any transfer safeguards
(e.g. SCCs).

## 9. Your rights [COUNSEL]

Depending on your jurisdiction (e.g. GDPR, CCPA/CPRA) you may have rights to
access, correct, delete, or port your data, and to object to or restrict
processing. Contact `{{PRIVACY_CONTACT_EMAIL}}` to exercise them.

## 10. Children

The App is not directed to children under `{{MIN_AGE}}` and we do not knowingly
collect their data.

## 11. Changes

We may update this policy; material changes will be communicated via
`{{CHANGE_NOTICE_METHOD}}` and reflected in the effective date above.

## 12. Contact

Questions: `{{PRIVACY_CONTACT_EMAIL}}`, `{{ENTITY_ADDRESS}}`.
`{{EU_REP_OR_DPO_IF_REQUIRED}}` **[COUNSEL]**
