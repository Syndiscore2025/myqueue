-- AlterEnum
ALTER TYPE "QueueEventType" ADD VALUE 'NOTIFIED';

-- AlterTable
ALTER TABLE "workspace_queue_settings" ADD COLUMN     "notify_on_assignment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_on_snooze_wake" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_on_follow_up_due" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "daily_digest_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "daily_digest_hour_utc" INTEGER NOT NULL DEFAULT 13;
