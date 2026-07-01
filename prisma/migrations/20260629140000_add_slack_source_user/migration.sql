-- Add optional original Slack sender id for clickable @user references in MyQueue.
ALTER TABLE "queue_items"
ADD COLUMN "source_slack_user_id" TEXT;