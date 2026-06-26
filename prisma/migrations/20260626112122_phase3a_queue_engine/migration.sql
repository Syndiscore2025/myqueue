-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('New', 'Working', 'Waiting', 'FollowUp', 'Snoozed', 'Done', 'Archived');

-- CreateEnum
CREATE TYPE "QueuePriority" AS ENUM ('Red', 'Yellow', 'Green');

-- CreateEnum
CREATE TYPE "QueueRankingMode" AS ENUM ('FIFO', 'PRIORITY');

-- CreateEnum
CREATE TYPE "QueueSourceType" AS ENUM ('SLACK_MESSAGE', 'SLACK_COMMAND', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "QueueEventType" AS ENUM ('CREATED', 'ASSIGNED', 'REASSIGNED', 'PRIORITY_CHANGED', 'STATUS_CHANGED', 'MOVED_TO_WAITING', 'MOVED_TO_FOLLOW_UP', 'SNOOZED', 'UNSNOOZED', 'COMPLETED', 'ARCHIVED', 'RECALCULATED');

-- CreateTable
CREATE TABLE "workspace_queue_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "ranking_mode" "QueueRankingMode" NOT NULL DEFAULT 'FIFO',
    "include_waiting_in_active" BOOLEAN NOT NULL DEFAULT false,
    "include_working_in_active" BOOLEAN NOT NULL DEFAULT true,
    "last_queue_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_queue_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "permanent_queue_id" TEXT NOT NULL,
    "owner_workspace_user_id" TEXT NOT NULL,
    "creator_workspace_user_id" TEXT,
    "source_type" "QueueSourceType" NOT NULL DEFAULT 'MANUAL',
    "source_slack_channel_id" TEXT,
    "source_slack_message_ts" TEXT,
    "source_slack_thread_ts" TEXT,
    "source_slack_permalink" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "QueueStatus" NOT NULL DEFAULT 'New',
    "priority" "QueuePriority" NOT NULL DEFAULT 'Green',
    "ranking_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozed_until" TIMESTAMP(3),
    "follow_up_due_at" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_status_history" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "queue_item_id" TEXT NOT NULL,
    "from_status" "QueueStatus",
    "to_status" "QueueStatus" NOT NULL,
    "actor_workspace_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_priority_history" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "queue_item_id" TEXT NOT NULL,
    "from_priority" "QueuePriority",
    "to_priority" "QueuePriority" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "actor_workspace_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_priority_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_assignments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "queue_item_id" TEXT NOT NULL,
    "previous_owner_workspace_user_id" TEXT,
    "owner_workspace_user_id" TEXT NOT NULL,
    "assigned_by_workspace_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_events" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "queue_item_id" TEXT,
    "actor_workspace_user_id" TEXT,
    "event_type" "QueueEventType" NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_position_snapshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "owner_workspace_user_id" TEXT NOT NULL,
    "queue_item_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "ranking_mode" "QueueRankingMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_position_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_queue_settings_workspace_id_key" ON "workspace_queue_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_owner_workspace_user_id_status_idx" ON "queue_items"("workspace_id", "owner_workspace_user_id", "status");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_owner_workspace_user_id_priority_r_idx" ON "queue_items"("workspace_id", "owner_workspace_user_id", "priority", "ranking_timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "queue_items_workspace_id_permanent_queue_id_key" ON "queue_items"("workspace_id", "permanent_queue_id");

-- CreateIndex
CREATE INDEX "queue_status_history_workspace_id_queue_item_id_created_at_idx" ON "queue_status_history"("workspace_id", "queue_item_id", "created_at");

-- CreateIndex
CREATE INDEX "queue_priority_history_workspace_id_queue_item_id_created_a_idx" ON "queue_priority_history"("workspace_id", "queue_item_id", "created_at");

-- CreateIndex
CREATE INDEX "queue_assignments_workspace_id_queue_item_id_created_at_idx" ON "queue_assignments"("workspace_id", "queue_item_id", "created_at");

-- CreateIndex
CREATE INDEX "queue_events_workspace_id_created_at_idx" ON "queue_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "queue_events_workspace_id_queue_item_id_created_at_idx" ON "queue_events"("workspace_id", "queue_item_id", "created_at");

-- CreateIndex
CREATE INDEX "queue_position_snapshots_workspace_id_owner_workspace_user__idx" ON "queue_position_snapshots"("workspace_id", "owner_workspace_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "workspace_queue_settings" ADD CONSTRAINT "workspace_queue_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_status_history" ADD CONSTRAINT "queue_status_history_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_priority_history" ADD CONSTRAINT "queue_priority_history_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_assignments" ADD CONSTRAINT "queue_assignments_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_position_snapshots" ADD CONSTRAINT "queue_position_snapshots_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
