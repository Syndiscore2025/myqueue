# Slack App Setup Guide

Two phases: **Phase 1** gets you the credentials you hand to me (do this now).
**Phase 2** is done after the app is live on DigitalOcean (you'll have a real domain
by then). You need the domain before you can verify URLs in Slack's portal, so we
do it in this order on purpose.

---

## Phase 1 — Do this now (before deploy)

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

Copy all three. **Do not share them here in chat** — you'll enter them directly
into the DigitalOcean console as secret env vars.

---

### 3. Set the bot token scopes (no domain needed yet)

Go to **OAuth & Permissions** in the left sidebar. Scroll to
**Scopes → Bot Token Scopes**. Add these five scopes exactly:

| Scope | Why |
| ------------ | -------------------------------------------- |
| `commands` | Slash command `/myqueue` |
| `chat:write` | Post messages and DMs |
| `im:write` | Open DM channels for notifications |
| `users:read` | Look up user info |
| `team:read` | Read workspace info |

Do **not** add anything else — extra scopes change the consent screen and may
require Slack review.

---

### 4. Generate your own secret (not from Slack)

This one is random — you generate it yourself. Run this command **once** in your
terminal and save the output somewhere safe (password manager):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This is your `SLACK_STATE_SECRET`. Keep it — you'll paste it into DO alongside
the three Slack credentials.

---

## ✋ Stop here — give me the four values

Once you have the three Slack credentials from Basic Information and your generated
`SLACK_STATE_SECRET`, tell me and I'll continue provisioning the DigitalOcean
infrastructure. **Enter them directly into the DO console** (not here).

---

## Phase 2 — Do this after the app is live on DigitalOcean

You will have a public URL by this point (e.g. `https://app.yourdomain.com` or
`https://myqueue-xxxxx.ondigitalocean.app`). Replace `YOUR_DOMAIN` below with it.

### 5. OAuth redirect URL

**OAuth & Permissions → Redirect URLs → Add:**

```
https://YOUR_DOMAIN/slack/oauth_redirect
```

### 6. Slash command

**Slash Commands → Create New Command:**

| Field | Value |
| ------------------- | ---------------------------------- |
| Command | `/myqueue` |
| Request URL | `https://YOUR_DOMAIN/slack/events` |
| Short Description | `Manage your MyQueue` |
| Usage Hint | `[view\|add\|help]` |

### 7. Interactivity & Shortcuts

**Interactivity & Shortcuts → turn Interactivity ON:**

- **Request URL:** `https://YOUR_DOMAIN/slack/events`

Then under **Shortcuts → Create New Shortcut → On messages:**

| Field | Value |
| ----------- | ----------------------- |
| Name | `Add to MyQueue` |
| Short Description | `Save this message to your queue` |
| Callback ID | `myqueue_add_message` |

### 8. Event Subscriptions

**Event Subscriptions → turn Events ON:**

- **Request URL:** `https://YOUR_DOMAIN/slack/events`
  (Slack sends a one-time challenge — the app answers it automatically ✓)

Under **Subscribe to bot events → Add Bot User Event:**

| Event | Why |
| ----------------- | ----------------------------- |
| `app_home_opened` | Renders the App Home dashboard |

### 9. App Home

**App Home → Home Tab → turn ON.**
Leave Messages Tab off.

### 10. Install the app

Go to **OAuth & Permissions → Install to Workspace** (or direct your users to
`https://YOUR_DOMAIN/slack/install`). This is what persists the bot token into
your database — it must be done once per workspace.

---

## Summary of what I need from you

| Value | Where you get it | When |
| --------------------- | ------------------------------- | ------- |
| `SLACK_CLIENT_ID` | Basic Information → App Credentials | Phase 1 |
| `SLACK_CLIENT_SECRET` | Basic Information → App Credentials | Phase 1 |
| `SLACK_SIGNING_SECRET` | Basic Information → App Credentials | Phase 1 |
| `SLACK_STATE_SECRET` | You generate with `node -e` above | Phase 1 |

Enter each as a **Secret** env var in the DigitalOcean App Platform console
(Settings → App-level env vars). Never paste them here.
