# Accessibility Audit

Accessibility notes for MyQueue's user-facing surfaces. The product surface is
Slack (App Home, slash command, message shortcut, DMs) rendered with Block Kit,
plus a developer-facing Swagger UI docs page. Slack owns most of the rendering and
its own accessibility conformance; this audit covers what MyQueue controls.

## Scope

| Surface | Renderer | Who owns a11y |
| --- | --- | --- |
| App Home dashboard | Slack Block Kit | Slack renders; we choose blocks/copy. |
| `/myqueue` command replies | Slack Block Kit (ephemeral) | Slack renders; we choose blocks/copy. |
| "Add to MyQueue" shortcut | Slack message menu | Slack. |
| Notification DMs | Slack Block Kit | Slack renders; we choose blocks/copy. |
| Swagger UI (`/docs`) | swagger-ui-express | Upstream library. |

Because MyQueue does not ship its own web UI, the main accessibility levers are
**content** choices within Block Kit, which Slack then renders with its native
accessibility support (keyboard navigation, screen-reader labels, contrast).

## What MyQueue controls (findings)

### Text and labels

- Buttons use clear text labels (Start, Follow Up, Waiting, Snooze, Complete,
  Archive, Refresh) rather than icon-only controls — good for screen readers.
- **Recommendation:** ensure no action relies on emoji/color alone to convey
  meaning; always pair with a text label.

### Color / priority

- Priorities are Red/Yellow/Green. Color must not be the **only** signal.
  **Recommendation:** always include the priority as text (e.g. "Red — urgent")
  alongside any color cue so color-blind users are not disadvantaged.

### Structure & reading order

- Use Block Kit `section`/`header`/`context` blocks so content has a logical
  reading order and headings, rather than packing everything into one text blob.
  **Recommendation:** verify each view exposes a clear heading and grouped items.

### Message content

- Notification DMs should be self-describing in text (what happened, which item)
  so they are meaningful without relying on layout. **Recommendation:** review
  each notification's text for standalone clarity.

### Plain language

- Keep command hints and labels concise and jargon-free (the `/myqueue` help text
  already lists views plainly). **Recommendation:** maintain plain-language copy.

## What Slack controls

Keyboard navigation, focus management, screen-reader semantics, and contrast of
the Block Kit chrome are provided by Slack's clients. We rely on Slack's own
accessibility conformance for these and cannot override them.

## Swagger UI (`/docs`)

The API docs page is rendered by `swagger-ui-express`. Its accessibility is
upstream. **Recommendation:** treat `/docs` as a developer tool (not an end-user
surface) and keep the public product experience in Slack.

## Recommendations summary

- [ ] Never convey meaning by color or emoji alone — always include text.
- [ ] Pair priority colors with explicit priority text.
- [ ] Use headed, grouped Block Kit structure for logical reading order.
- [ ] Keep notification DMs self-describing in text.
- [ ] Maintain concise, plain-language labels and hints.
- [ ] **[BUSINESS]** If a marketing website or web dashboard is added later,
      audit it against WCAG 2.1 AA directly (it will not inherit Slack's a11y).

## See also

- [user-guide.md](./user-guide.md) — the surfaces reviewed here.
- [slack.md](./slack.md) — the Block Kit presenters and views.
