# Slack App Setup (Phase 2)

MyQueue installs into Slack workspaces via OAuth v2. This guide covers the
Slack Developer Portal configuration and the environment variables that wire it
together. All Slack tokens are encrypted at rest (AES-256-GCM) and every record
is scoped to a workspace (tenant).

## 1. Create the Slack app

1. Go to https://api.slack.com/apps and click **Create New App** →
   **From scratch**.
2. Give it a name and pick your development workspace.

From **Basic Information**, copy these into your `.env`:

| Slack field     | Env variable           |
| --------------- | ---------------------- |
| Client ID       | `SLACK_CLIENT_ID`      |
| Client Secret   | `SLACK_CLIENT_SECRET`  |
| Signing Secret  | `SLACK_SIGNING_SECRET` |

Generate the OAuth state secret yourself:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store it as `SLACK_STATE_SECRET`.

## 2. Scopes

Scopes are requested at install time and configured via env (CSV), so they can
change without code edits. The Phase 2 defaults are the minimal,
Marketplace-friendly set:

```
SLACK_BOT_SCOPES=commands,chat:write,users:read,team:read
SLACK_USER_SCOPES=
```

Set the **same** bot scopes under **OAuth & Permissions → Scopes → Bot Token
Scopes** in the portal so the consent screen matches.

## 3. Endpoints

With `APP_BASE_URL` set to your public URL, the app mounts three routes (only
when all four required `SLACK_*` values are present):

| Method | Path                    | Purpose                                  |
| ------ | ----------------------- | ---------------------------------------- |
| GET    | `/slack/install`        | Starts OAuth; redirects to Slack.        |
| GET    | `/slack/oauth_redirect` | OAuth callback; persists the install.    |
| POST   | `/slack/events`         | Events, slash commands, interactivity.   |

Configure them in the portal:

- **OAuth & Permissions → Redirect URLs**: add
  `https://YOUR_DOMAIN/slack/oauth_redirect`.
- **Event Subscriptions → Request URL**: set
  `https://YOUR_DOMAIN/slack/events`. Slack sends a one-time `url_verification`
  challenge, which the receiver answers automatically.

> For local development, expose your machine with a tunnel (e.g. ngrok) and use
> the HTTPS tunnel URL as `APP_BASE_URL`.

## 4. Install flow

1. A workspace admin visits `https://YOUR_DOMAIN/slack/install`.
2. The app issues a single-use, short-lived OAuth `state` (stored in Postgres),
   then redirects to Slack's consent screen.
3. Slack redirects back to `/slack/oauth_redirect` with a `code` and `state`.
   The state is verified once and consumed; the code is exchanged for tokens.
4. The installation is persisted: a `Workspace` plus an encrypted
   `SlackInstallation`, with default settings and the installer recorded as a
   workspace user. An `APP_INSTALLED` / `APP_REINSTALLED` audit entry is written.

When the app is removed from a workspace, Slack sends an `app_uninstalled`
event; the installation is revoked and the workspace marked uninstalled.

## 5. Required environment variables

```
APP_BASE_URL=https://YOUR_DOMAIN
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
SLACK_STATE_SECRET=...           # 64 hex chars
SLACK_BOT_SCOPES=commands,chat:write,users:read,team:read
SLACK_USER_SCOPES=
ENCRYPTION_KEY=...               # 64 hex chars; encrypts tokens at rest
```

In production, the four required `SLACK_*` credentials are mandatory — the
process will not boot without them. In development/test they may be left blank,
in which case the Slack surface is simply not mounted.

## 6. Marketplace notes

- Tokens are never stored in plaintext; encryption is handled by the repository
  layer using `ENCRYPTION_KEY`.
- OAuth state is server-side, single-use, and expires after 10 minutes,
  protecting the callback against CSRF and replay.
- Keep requested scopes minimal; add scopes (and update the portal) only as new
  features need them.
