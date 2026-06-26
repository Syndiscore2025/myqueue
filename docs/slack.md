# Slack App Setup & Experience

MyQueue installs into Slack workspaces via OAuth v2 (Phase 2) and is fully
usable inside Slack (Phase 4). This guide covers the Slack Developer Portal
configuration, the environment variables that wire it together, and the in-Slack
surfaces. All Slack tokens are encrypted at rest (AES-256-GCM) and every record
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

## 6. In-Slack experience (Phase 4)

Phase 4 makes the queue fully usable inside Slack. The Slack handlers are thin
interface adapters (`src/interfaces/slack`) that resolve a verified Slack
identity to a tenant-scoped `QueueContext` and delegate to the existing queue
application services; no business logic lives in the Slack layer.

Surfaces:

| Surface             | Trigger                          | What it does                                              |
| ------------------- | -------------------------------- | -------------------------------------------------------- |
| App Home dashboard  | `app_home_opened` event          | Publishes the user's ranked queue with priority/status filters. |
| `/myqueue` command  | Slash command                    | Navigates the queue/priority/status views from any channel.     |
| Add to MyQueue      | Message shortcut (`message_action`) | Turns the selected message into a `SLACK_MESSAGE` item.       |
| Item actions        | Block Kit buttons / overflow     | Start, Follow Up, Waiting, Snooze, Complete, Archive, Refresh.  |

Per-item buttons are gated by the domain lifecycle state machine, so only legal
transitions render. Each action re-renders its source surface in place — the App
Home tab is re-published; an ephemeral slash-command reply is replaced — reading
the current view from the view's `private_metadata`.

**Idempotency.** Side-effecting interactions (e.g. creating an item from a
message) are guarded by a Redis-backed one-time claim keyed on the Slack payload
id (`trigger_id` / event id), so Slack retries never double-process. The guard
fails open: a transient cache outage degrades to "may run twice" rather than
"never runs".

### Portal configuration

The Phase 4 surfaces need no new scopes — `commands` and the Phase 2 set suffice
— but they require these portal toggles:

- **App Home → Home Tab**: enable it, and subscribe to the `app_home_opened` bot
  event under **Event Subscriptions → Subscribe to bot events**.
- **Interactivity & Shortcuts**: turn **Interactivity** on (Request URL
  `https://YOUR_DOMAIN/slack/events`) so buttons and shortcuts are delivered.
- **Shortcuts**: add a **message** shortcut named "Add to MyQueue".
- **Slash Commands**: create `/myqueue` pointing at the same Request URL.

## 7. Marketplace notes

- Tokens are never stored in plaintext; encryption is handled by the repository
  layer using `ENCRYPTION_KEY`.
- OAuth state is server-side, single-use, and expires after 10 minutes,
  protecting the callback against CSRF and replay.
- Keep requested scopes minimal; add scopes (and update the portal) only as new
  features need them.
