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
change without code edits. The defaults support App Home, commands,
notifications, and automatic attention-pointer capture from Slack conversations
the app is allowed to observe:

```
SLACK_BOT_SCOPES=commands,chat:write,im:write,im:read,users:read,team:read,channels:read,channels:history,groups:read,groups:history,mpim:read,mpim:history,im:history
SLACK_USER_SCOPES=im:read,im:history
```

`im:write` lets the notifier open a DM channel (`conversations.open`) before
posting; `chat:write` covers the message itself. The `*:history` scopes let
Slack deliver Events API message notifications where the app or installing user
has conversation visibility. MyQueue uses those events to store only attention
metadata — sender/channel ids, timestamp, priority, and a Slack link — never the
message body.

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
- **Subscribe to bot events**: add `app_home_opened`, `message.channels`,
  `message.groups`, `message.mpim`, and `message.im`.

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
SLACK_BOT_SCOPES=commands,chat:write,im:write,users:read,team:read
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

### Product model: one personal command center

MyQueue is a private, per-user command center inside Slack. Users should be able
to keep the MyQueue App Home open all day and work from one ranked queue instead
of hunting through channels, DMs, threads, and reminders. MyQueue is not a shared
chat room: conversations stay in the original Slack DM/channel/thread, while
MyQueue tracks attention, priority, lifecycle state, and the next best item to
work.

Slack apps cannot decorate or reorder Slack's native left sidebar, add colored
queue indicators next to DM names, or inject controls into the message composer.
The Slack-compliant version of the experience is therefore:

- MyQueue App Home is the primary working surface.
- Proactive DMs/reminders bring the user back when important queue state changes.
- Slash commands, message shortcuts, reactions, and App Home buttons provide fast
  controls without turning MyQueue into a conversation channel.
- Every Slack-originated item links back to the original Slack place when the
  user needs to reply.
- Automatic Slack message capture creates attention pointers only: who/where,
  priority, status, timestamp, and Open chat. It does not copy message text.
- Repeated messages from the same sender in the same observable Slack
  conversation/thread within five minutes update one pointer's message count;
  they do not create multiple queue rows.

### Queue ordering and lifecycle behavior

Queue order is dynamic. If a user works an item out of order, MyQueue should mark
that item with the appropriate lifecycle state (`Working`, `Waiting`, `Follow
Up`, `Snoozed`, `Done`, etc.) and recompute the ranked queue so the next best
item moves into the highest available position. Slot #1 may represent the current
active conversation/call; priority overrides normally jump to the highest waiting
slot beneath that active item.

Priority and status are separate concepts:

- **Status** describes workflow state: new, working, waiting, follow-up,
  snoozed, done, archived.
- **Priority** describes attention level: urgent/red, important/yellow,
  normal/green, low/FYI.

Role-based priority overrides should be modeled as ranking rules, not as chat
behavior:

| Sender/context | Queue behavior |
| -------------- | -------------- |
| CEO or executive | Jump to the highest waiting slot, typically #2. |
| Sales manager | Jump to the highest waiting slot for users on their team. |
| Team lead | Jump above normal team items, but not above sales manager/executive items. |
| Normal direct message | Rank by normal priority/order rules. |
| Company-wide/lender/general channel message | Default to low/non-urgent unless directly assigned. |
| Direct `@user` mention in a broad channel | Elevate to yellow/important. |

### Marking urgency from normal Slack

MyQueue cannot add a native urgency dropdown to Slack's message composer. The
normal Slack composer stays unchanged, and MyQueue classifies urgency from the
message content it receives in the Events API. That text is used transiently for
priority classification only; MyQueue still stores only the metadata pointer and
the Slack permalink, never the message body. Punctuation alone is not a priority
signal, so adding `!` or `?` does not escalate an otherwise normal message.

The default classifier is the **MCA edition**. It understands common
merchant-cash-advance and business-funding language such as stips, underwriting,
bank statements, proof of ownership, voided checks, Plaid/login issues, funding
calls, contracts, renewals, buyouts, payoffs, ACH/wire problems, and funding
blockers. Red still means a true blocker; Yellow means attention or missing-info
language.

Supported Slack-native controls are limited to functionality that is implemented
and testable for Marketplace review:

- Automatic priority classification from observable Slack message events.
- Message shortcut **Add to MyQueue** for manual capture.
- Slash command `/myqueue` for queue navigation and `/myqueue token` for API token minting.
- App Home item actions: start, waiting, follow-up, snooze, complete, archive,
  quick follow-up scheduling, mark red/yellow/green, and open original.

The sender can continue using normal Slack. The recipient uses MyQueue as the
attention layer and jumps back to the real conversation only when needed.

### Opening the original chat from MyQueue

Every queue item created from Slack should expose an obvious **Open in Slack** /
**Open chat** action. The preferred target is the original message permalink so
the user lands in the exact DM/channel/thread that created the item. When a
message permalink is not available, render Slack-native identifiers that Slack
makes clickable, such as `<@USER_ID>` for a person or `<#CHANNEL_ID>` for a
channel, and use Slack app redirect/deep links where a channel or DM id is known.

The rule is: MyQueue shows the ranked work list, but replies happen in the
original Slack conversation.

Opening a Slack-sourced pointer is treated as handling that attention group: all
active pointers for the same owner/sender/channel/thread are marked done so they
leave the active queue. If the issue is resolved elsewhere (for example by a call
to a manager or CEO), the recipient can also use **Resolved** to remove the item
from their active queue without opening the chat.

Surfaces:

| Surface             | Trigger                          | What it does                                              |
| ------------------- | -------------------------------- | -------------------------------------------------------- |
| App Home dashboard  | `app_home_opened` event          | Publishes the user's ranked queue with priority/status filters. |
| `/myqueue` command  | Slash command                    | Navigates the queue/priority/status views from any channel.     |
| `/myqueue token`    | Slash command                    | Mints a personal HS256 API bearer token (Phase 7), shown ephemerally. |
| Automatic capture   | Slack message events             | Creates name-only attention pointers for observable messages and classifies priority from content without storing message text. |
| Add to MyQueue      | Message shortcut (`message_action`) | Captures a privacy-safe reference to the message as a `SLACK_MESSAGE` item. |
| Item actions        | Block Kit buttons / overflow     | Start, Follow Up, Waiting, Snooze, Complete, Archive, Refresh, and Mark Red/Yellow/Green. |

Per-item buttons are gated by the domain lifecycle state machine, so only legal
transitions render. Each action re-renders its source surface in place — the App
Home tab is re-published; an ephemeral slash-command reply is replaced — reading
the current view from the view's `private_metadata`.

**Idempotency.** Side-effecting interactions (e.g. creating an item from a
message) are guarded by a Redis-backed one-time claim keyed on the Slack payload
id (`trigger_id` / event id), so Slack retries never double-process. The guard
fails open: a transient cache outage degrades to "may run twice" rather than
"never runs".

**Privacy — no message content is stored.** The "Add to MyQueue" shortcut never
copies the message body into MyQueue. The item title is a generic label derived
from the channel name (e.g. `Slack message in #deploys`), and we persist only a
privacy-safe reference: the channel id, message timestamp, thread timestamp, and
a permalink back to the original. The permalink is built from the shortcut
payload metadata alone (`team.domain` + `channel.id` + `message_ts`) — no API
call and no message text is read. Clicking through opens the message in Slack,
where Slack's own access controls still apply.

### Portal configuration

The Phase 4 surfaces need no new scopes — `commands` and the Phase 2 set suffice
— but they require these portal toggles:

- **App Home → Home Tab**: enable it, and subscribe to the `app_home_opened` bot
  event under **Event Subscriptions → Subscribe to bot events**.
- **Interactivity & Shortcuts**: turn **Interactivity** on (Request URL
  `https://YOUR_DOMAIN/slack/events`) so buttons and shortcuts are delivered.
- **Shortcuts**: add a **message** shortcut named "Add to MyQueue".
- **Slash Commands**: create `/myqueue` pointing at the same Request URL.

## 7. Notifications (Phase 5)

Phase 5 adds proactive Slack DMs so owners hear about queue events without
polling the App Home tab. A `Notifier` port in the application layer keeps the
delivery mechanism behind an interface; the `SlackNotifier`
(`src/infrastructure/slack`) implements it by resolving the workspace's
encrypted bot token, opening a DM channel, and posting a Block Kit message.
`NotificationService` orchestrates each notification: it gates on the relevant
per-workspace preference, resolves the target user, sends, and records a
`NOTIFIED` audit event.

| Notification     | Source                                   | Preference            |
| ---------------- | ---------------------------------------- | --------------------- |
| Assignment       | `assign()` (skips self-assignment)       | `notifyOnAssignment`  |
| Snooze wake-up   | Activation sweep `onActivated` callback  | `notifyOnSnoozeWake`  |
| Follow-up due    | Follow-up reminder sweep                 | `notifyOnFollowUpDue` |
| Daily digest     | Hourly digest sweep                      | `dailyDigestEnabled`  |

The two background sweeps mirror the Phase 3C scheduler: an overlap-guarded
`tick`, bounded batches, idempotent start/stop. Each DM is deduped with a
Redis-backed idempotency key — per item + due-time for follow-ups, per
workspace + owner + UTC date for the digest — so a re-run within the same window
never double-sends. Every delivery path fails safe: a notification can never
break the use case or sweep that requested it.

Defaults: assignment, snooze-wake, and follow-up notifications are **on**; the
daily digest is **off** until a workspace enables it (`dailyDigestHourUtc`
defaults to `13`). See [`environment.md`](./environment.md) for the sweep
interval/batch env vars.

### Portal configuration

Phase 5 adds the `im:write` bot scope (see §2) so the notifier can open DM
channels. No other portal changes are required.

## 8. Marketplace notes

- Tokens are never stored in plaintext; encryption is handled by the repository
  layer using `ENCRYPTION_KEY`.
- OAuth state is server-side, single-use, and expires after 10 minutes,
  protecting the callback against CSRF and replay.
- Keep requested scopes minimal; add scopes (and update the portal) only as new
  features need them.
