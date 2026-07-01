# Slack App Setup Guide

Two phases: **Phase 1** gets the Slack credentials and generated app secrets into
Render. **Phase 2** wires Slack's portal URLs to the live production domain. You
need the domain before Slack can verify event/interactivity URLs, so we do it in
this order on purpose.

> **Note:** A complete Slack app manifest with all Phase 1–8 features is maintained
> at `slack-app-manifest.yaml` in the repository root. You can use this manifest to
> create a new app or update an existing one via the Slack Developer Portal.

---

## Phase 1 — Do this before deploy

### 1. Create the Slack app

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and click
   **Create New App**.
2. Choose **From scratch**.
3. **App Name:** `MyQueue`
4. **Pick a workspace:** choose your production Slack workspace.
5. Click **Create App**.

---

### 2. Copy your three credentials

Go to **Basic Information** in the left sidebar. Scroll to **App Credentials**.

| What you see in Slack | Env var I need |
| --------------------- | -------------- |
| **App ID** | (for your reference only — not needed) |
| **Client ID** | `SLACK_CLIENT_ID` |
| **Client Secret** (click Show) | `SLACK_CLIENT_SECRET` |
| **Signing Secret** (click Show) | `SLACK_SIGNING_SECRET` |

Copy all three. **Do not share them in chat** — enter them directly into Render
as secret environment variables on the `myqueue-api` service.

---

### 3. Set the bot token scopes (no domain needed yet)

Go to **OAuth & Permissions** in the left sidebar. Scroll to
**Scopes → Bot Token Scopes**. Add these scopes exactly:

| Scope | Why |
| ------------ | -------------------------------------------- |
| `commands` | Slash command `/myqueue` |
| `chat:write` | Post messages and DMs |
| `im:write` | Open DM channels for notifications |
| `im:read` | Resolve 1:1 DM membership metadata |
| `users:read` | Look up user info |
| `team:read` | Read workspace info |
| `channels:read` | Resolve public channel names/info |
| `channels:history` | Receive public-channel message events |
| `groups:read` | Resolve private channel names/info where invited |
| `groups:history` | Receive private-channel events where invited |
| `mpim:read` | Resolve group-DM info where allowed |
| `mpim:history` | Receive group-DM events where allowed |
| `im:history` | Receive app/bot DM events |

Under **OAuth & Permissions → Scopes → User Token Scopes**, add:

| Scope | Why |
| ------------ | -------------------------------------------- |
| `im:read` | Resolve personal DM membership metadata |
| `im:history` | Receive authorized personal DM message events |

Do **not** add message-content scopes beyond these without a specific product
reason. MyQueue stores attention pointers only — sender/channel ids, priority,
timestamp, and Slack links — not message bodies.

---

### 4. Generate your own secrets (not from Slack)

These are random — you generate them yourself. Run each command **once** in your
terminal and save the outputs somewhere safe (password manager):

```bash
# SLACK_STATE_SECRET — protects OAuth state
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ENCRYPTION_KEY — encrypts Slack tokens at rest; permanent after installs exist
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# AUTH_TOKEN_SECRET — signs personal API bearer tokens
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Keep these values — you'll paste them into Render alongside the three Slack
credentials. Back up `ENCRYPTION_KEY`; changing it after installs exist makes
stored Slack tokens undecryptable.

---

## ✋ Stop here — enter the values in Render

Once you have the three Slack credentials from Basic Information and the three
generated secrets, enter them directly into Render. Do not paste secrets in chat
or screenshots.

---

## Phase 2 — Do this after the app is live on Render

Production URL: `https://app.myqueue.syndiscore.com`.

### 5. OAuth redirect URL

**OAuth & Permissions → Redirect URLs → Add:**

```
https://app.myqueue.syndiscore.com/slack/oauth_redirect
```

### 6. Slash command

**Slash Commands → Create New Command:**

| Field | Value |
| ------------------- | ---------------------------------- |
| Command | `/myqueue` |
| Request URL | `https://app.myqueue.syndiscore.com/slack/events` |
| Short Description | `Manage your MyQueue` |
| Usage Hint | `[view\|add\|help]` |

### 7. Interactivity & Shortcuts

**Interactivity & Shortcuts → turn Interactivity ON:**

- **Request URL:** `https://app.myqueue.syndiscore.com/slack/events`

Then under **Shortcuts → Create New Shortcut → On messages:**

This shortcut is a fallback/manual override. The primary workflow is automatic
attention-pointer capture from observable message events.

| Field | Value |
| ----------- | ----------------------- |
| Name | `Add to MyQueue` |
| Short Description | `Save this message to your queue` |
| Callback ID | `myqueue_add_message` |

### 8. Event Subscriptions

**Event Subscriptions → turn Events ON:**

- **Request URL:** `https://app.myqueue.syndiscore.com/slack/events`
  (Slack sends a one-time challenge — the app answers it automatically ✓)

Under **Subscribe to bot events → Add Bot User Event:**

| Event | Why |
| ----------------- | ----------------------------- |
| `app_home_opened` | Renders the App Home dashboard |
| `message.channels` | Auto-captures observable public-channel attention pointers |
| `message.groups` | Auto-captures observable private-channel attention pointers |
| `message.mpim` | Auto-captures observable group-DM attention pointers |
| `message.im` | Auto-captures app/bot DM attention pointers |

Under **Subscribe to events on behalf of users → Add Workspace Event:**

| Event | Why |
| ----------------- | ----------------------------- |
| `message.im` | Auto-captures authorized personal 1:1 DM attention pointers |

### 9. App Home

**App Home → Home Tab → turn ON.**
Leave Messages Tab off.

### 10. Install the app

Go to **OAuth & Permissions → Install to Workspace** (or direct your users to
`https://app.myqueue.syndiscore.com/slack/install`). This is what persists the
bot token into your database — it must be done once per workspace.

---

## Summary of production secrets

| Value | Where you get it | When |
| --------------------- | ------------------------------- | ------- |
| `SLACK_CLIENT_ID` | Basic Information → App Credentials | Phase 1 |
| `SLACK_CLIENT_SECRET` | Basic Information → App Credentials | Phase 1 |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials | Phase 1 |
| `SLACK_STATE_SECRET` | You generate with `node -e` above | Phase 1 |
| `ENCRYPTION_KEY` | You generate with `node -e` above | Phase 1 |
| `AUTH_TOKEN_SECRET` | You generate with `node -e` above | Phase 1 |

Enter each as a secret env var in Render on `myqueue-api` → **Environment**.
Never paste secret values in chat.
