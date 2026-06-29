# MyQueue User Guide

How to use MyQueue from inside Slack. Everything here works without leaving
Slack; the underlying behaviour is described in [slack.md](./slack.md) and
[queue-engine.md](./queue-engine.md).

## What MyQueue is

MyQueue is your personal, prioritized work queue inside Slack. Items are ranked
automatically by priority and status, you act on them with one click, and MyQueue
sends you direct messages when something needs your attention.

## The App Home dashboard

Open the **MyQueue** app in Slack and select the **Home** tab. The dashboard
publishes your ranked queue and lets you switch between views. It re-renders in
place after every action, so it always reflects the current state.

**Priorities** are Red (urgent), Yellow (normal), and Green (low). **Statuses**
move through a lifecycle: New → Working → (Follow Up / Waiting / Snoozed) →
Done / Archived.

## The `/myqueue` command

Run `/myqueue` from any channel or DM to navigate your queue without opening the
Home tab. Subcommands:

| Command | What it shows |
| --- | --- |
| `/myqueue` | Your active queue. |
| `/myqueue red` / `yellow` / `green` | Items filtered by priority. |
| `/myqueue working` / `follow-up` / `waiting` / `snoozed` / `archive` | Items filtered by status. |
| `/myqueue token` | Mints a personal API bearer token (see below), shown only to you. |

Sending `/myqueue` with an unrecognised word shows the usage hint listing these
views.

## Adding work to your queue

Use the **Add to MyQueue** message shortcut: hover over any Slack message, open
the message's shortcut menu (the "more actions" ⋯), and choose **Add to
MyQueue**. MyQueue captures a privacy-safe reference to that message as a queue
item.

> **Your privacy is protected.** MyQueue never copies the message text. The item
> title is a generic label derived from the channel (e.g. `Slack message in
> #deploys`), and only a permalink plus channel/message/thread ids are stored.
> Clicking the item opens the original message in Slack, where Slack's own access
> controls still apply.

## Acting on items

Each item in the dashboard carries action buttons (and an overflow ⋯ menu). Only
the actions that are legal for the item's current state are shown:

| Action | Effect |
| --- | --- |
| **Start** | Move the item to Working. |
| **Follow Up** | Mark the item as needing follow-up. |
| **Waiting** | Park the item as Waiting (blocked on someone/something). |
| **Snooze** | Hide the item until a chosen time; it wakes back to your queue. |
| **Complete** | Mark the item Done. |
| **Archive** | Remove the item from active views. |
| **Refresh** | Re-publish the current view. |

After any action the source surface re-renders in place — the Home tab is
re-published, and an ephemeral slash-command reply is replaced.

## Notifications

MyQueue sends you direct messages so you don't have to poll the dashboard:

| Notification | When you get it |
| --- | --- |
| **Assignment** | An item is assigned to you (you're not notified for self-assignment). |
| **Snooze wake-up** | A snoozed item's snooze time arrives and it returns to your queue. |
| **Follow-up due** | A follow-up you set becomes due. |
| **Daily digest** | An optional once-a-day summary of your queue (off by default). |

Assignment, snooze wake-up, and follow-up notifications are on by default; the
daily digest is opt-in. These preferences are configured per workspace by an
admin — see the [admin guide](./admin-guide.md). Notifications are deduplicated,
so a retry never double-sends, and a Slack outage never loses your underlying
queue state.

## Using the API (optional)

Power users can drive their queue programmatically. Run **`/myqueue token`** to
mint a personal bearer token (HS256, anchored to your verified Slack identity).
Send it as `Authorization: Bearer <token>` to the `/api/v1/queue` endpoints; the
full surface is documented in the OpenAPI spec at `GET /openapi.json` (Swagger UI
is served at `/docs`). Keep the token private — it acts on your behalf within
your workspace. See [queue-engine.md](./queue-engine.md) for the queue API
reference.

## Tips

- Items are ranked for you — focus from the top down.
- Use **Snooze** for "not now" work so it resurfaces automatically instead of
  cluttering your active view.
- Use **Waiting** vs **Follow Up** to distinguish "blocked on others" from "I owe
  a nudge".
- Enable the **daily digest** (ask your admin) if you prefer a single morning
  summary over per-event DMs.
