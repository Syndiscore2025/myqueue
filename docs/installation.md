# Installing MyQueue

This guide walks a Slack workspace administrator through installing MyQueue into
a workspace. It assumes the MyQueue backend is already deployed and reachable at
a public HTTPS URL (`APP_BASE_URL`). For standing up that backend, see
[deployment.md](./deployment.md); for the Slack app configuration that backs
this flow, see [slack.md](./slack.md).

## 1. Prerequisites

Before a workspace can install MyQueue you need:

- A **running MyQueue deployment** with PostgreSQL and Redis reachable, served
  over HTTPS at a stable domain.
- A **Slack app** created in the
  [Slack Developer Portal](https://api.slack.com/apps) and configured per
  [slack.md](./slack.md), with these values wired into the deployment's
  environment:
  - `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
  - `SLACK_STATE_SECRET` (64 hex chars), `ENCRYPTION_KEY` (64 hex chars)
  - `APP_BASE_URL=https://YOUR_DOMAIN`
  - `SLACK_BOT_SCOPES=commands,chat:write,im:write,users:read,team:read`
- Permission to install apps in the target Slack workspace (a workspace admin,
  or approval from one).

In production the four required `SLACK_*` credentials are mandatory — the API
process will not boot without them.

## 2. Slack portal toggles

The installer flow and in-Slack surfaces rely on these portal settings (full
detail in [slack.md](./slack.md)):

- **OAuth & Permissions → Redirect URLs:** add
  `https://YOUR_DOMAIN/slack/oauth_redirect`.
- **OAuth & Permissions → Bot Token Scopes:** match `SLACK_BOT_SCOPES` exactly so
  the consent screen reflects what the app requests.
- **Event Subscriptions → Request URL:** `https://YOUR_DOMAIN/slack/events`
  (Slack's one-time `url_verification` challenge is answered automatically).
- **Event Subscriptions → Subscribe to bot events:** `app_home_opened`.
- **App Home:** enable the **Home Tab**.
- **Interactivity & Shortcuts:** turn **Interactivity** on with Request URL
  `https://YOUR_DOMAIN/slack/events`; add a **message** shortcut named
  "Add to MyQueue".
- **Slash Commands:** create `/myqueue` pointing at the same Request URL.

## 3. Install into a workspace

1. A workspace admin visits **`https://YOUR_DOMAIN/slack/install`**.
2. MyQueue issues a single-use, short-lived OAuth `state` (stored server-side in
   Postgres) and redirects to Slack's consent screen.
3. The admin reviews the requested scopes and approves. Slack redirects back to
   `/slack/oauth_redirect` with a `code` and `state`.
4. MyQueue verifies and consumes the `state` once, exchanges the `code` for
   tokens, and persists the installation: a `Workspace`, an encrypted
   `SlackInstallation` (tokens are AES-256-GCM encrypted at rest), default queue
   settings, and the installer recorded as a workspace user. An `APP_INSTALLED`
   (or `APP_REINSTALLED`) audit event is written.

The workspace starts on the **Free** plan. See the
[admin guide](./admin-guide.md) for upgrading and configuring settings.

## 4. Verify the installation

- Open the MyQueue app in Slack and switch to the **Home** tab — the App Home
  dashboard should render an (empty) ranked queue.
- Run **`/myqueue`** from any channel; it should reply with your queue view.
- Run **`/myqueue help`**-style usage by sending `/myqueue` with no recognised
  view to see the command hint.
- Operationally, confirm the backend is healthy:
  - `GET https://YOUR_DOMAIN/health` → `{ "status": "ok" }`
  - `GET https://YOUR_DOMAIN/ready` → `{ "status": "ready", checks: { database, redis } }`
  - `GET https://YOUR_DOMAIN/version` → build/version info.

## 5. Reinstalling and updating scopes

Re-running `/slack/install` for an already-installed workspace re-runs OAuth and
writes an `APP_REINSTALLED` audit entry, refreshing the stored tokens. If you add
a new bot scope later, update both `SLACK_BOT_SCOPES` and the portal's Bot Token
Scopes, then have an admin reinstall so the new consent is granted.

## 6. Uninstalling

Removing MyQueue from a workspace (Slack → workspace settings → Manage apps)
causes Slack to send an `app_uninstalled` event. MyQueue revokes the stored
installation and marks the workspace uninstalled; tenant data remains scoped to
that `workspaceId` and is no longer reachable through Slack. For data deletion on
request, see the data-retention notes in the compliance documentation.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Install URL 404s | Slack creds missing at boot | Ensure all four `SLACK_*` values are set; the Slack surface only mounts when present. |
| "invalid state" on callback | State expired (>10 min) or reused | Restart the flow from `/slack/install`. |
| Consent screen scopes differ | Portal scopes ≠ `SLACK_BOT_SCOPES` | Align Bot Token Scopes with the env value. |
| App Home blank / no events | `app_home_opened` not subscribed, or bad Request URL | Re-check Event Subscriptions URL and bot-event subscription. |
| `/ready` returns `not_ready` | Postgres or Redis unreachable | Inspect the `checks` object; fix the failing dependency. |
