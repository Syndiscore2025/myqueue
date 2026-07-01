-- Track burst counts for Slack attention pointers without storing message bodies.
ALTER TABLE "queue_items"
ADD COLUMN "source_slack_message_count" INTEGER NOT NULL DEFAULT 1;