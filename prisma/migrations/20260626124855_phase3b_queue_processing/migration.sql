-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('ACTIVE', 'IDLE', 'DEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QueueEventType" ADD VALUE 'CLAIMED';
ALTER TYPE "QueueEventType" ADD VALUE 'RELEASED';
ALTER TYPE "QueueEventType" ADD VALUE 'RECOVERED';
ALTER TYPE "QueueEventType" ADD VALUE 'FAILED';
ALTER TYPE "QueueEventType" ADD VALUE 'RETRY_SCHEDULED';
ALTER TYPE "QueueEventType" ADD VALUE 'DEAD_LETTERED';
ALTER TYPE "QueueEventType" ADD VALUE 'REQUEUED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QueueStatus" ADD VALUE 'Processing';
ALTER TYPE "QueueStatus" ADD VALUE 'DeadLetter';

-- AlterTable
ALTER TABLE "queue_items" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "claimed_by_worker_id" TEXT,
ADD COLUMN     "dead_lettered_at" TIMESTAMP(3),
ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "heartbeat_at" TIMESTAMP(3),
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "last_error_stack" TEXT,
ADD COLUMN     "lock_expires_at" TIMESTAMP(3),
ADD COLUMN     "processing_completed_at" TIMESTAMP(3),
ADD COLUMN     "processing_started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "worker_registrations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "hostname" TEXT,
    "status" "WorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "processing_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worker_registrations_workspace_id_status_idx" ON "worker_registrations"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "worker_registrations_workspace_id_worker_id_key" ON "worker_registrations"("workspace_id", "worker_id");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_status_priority_ranking_timestamp_idx" ON "queue_items"("workspace_id", "status", "priority", "ranking_timestamp");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_status_lock_expires_at_idx" ON "queue_items"("workspace_id", "status", "lock_expires_at");

-- AddForeignKey
ALTER TABLE "worker_registrations" ADD CONSTRAINT "worker_registrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
