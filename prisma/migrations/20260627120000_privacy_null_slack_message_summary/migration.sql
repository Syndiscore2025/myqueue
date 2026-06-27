-- Privacy backfill: legacy "Add to MyQueue" items captured before the
-- privacy refactor may still hold third-party message text in `summary`. The
-- shortcut now stores only privacy-safe references and never sets `summary`, so
-- null out any residual content for SLACK_MESSAGE-sourced rows. Idempotent and a
-- no-op on a fresh database (zero rows affected).
UPDATE "queue_items"
SET "summary" = NULL
WHERE "source_type" = 'SLACK_MESSAGE'
  AND "summary" IS NOT NULL;
