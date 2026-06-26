-- CreateEnum
CREATE TYPE "QueueActivationReason" AS ENUM ('SCHEDULED', 'DELAYED', 'SNOOZED', 'DEPENDENCY_RESOLVED', 'RATE_LIMIT_CLEARED', 'MANUAL');

-- CreateEnum
CREATE TYPE "QueueDependencyType" AS ENUM ('COMPLETE_REQUIRED', 'FAIL_IF_DEPENDENCY_FAILS', 'CONTINUE_IF_DEPENDENCY_FAILS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QueueEventType" ADD VALUE 'DELAYED';
ALTER TYPE "QueueEventType" ADD VALUE 'SCHEDULED';
ALTER TYPE "QueueEventType" ADD VALUE 'ACTIVATED';
ALTER TYPE "QueueEventType" ADD VALUE 'RECURRENCE_CREATED';
ALTER TYPE "QueueEventType" ADD VALUE 'RECURRENCE_PAUSED';
ALTER TYPE "QueueEventType" ADD VALUE 'RECURRENCE_RESUMED';
ALTER TYPE "QueueEventType" ADD VALUE 'RECURRENCE_DISABLED';
ALTER TYPE "QueueEventType" ADD VALUE 'RECURRING_ITEM_CREATED';
ALTER TYPE "QueueEventType" ADD VALUE 'RATE_LIMITED';
ALTER TYPE "QueueEventType" ADD VALUE 'DEPENDENCY_BLOCKED';
ALTER TYPE "QueueEventType" ADD VALUE 'DEPENDENCY_UNBLOCKED';

-- AlterTable
ALTER TABLE "queue_items" ADD COLUMN     "activation_reason" "QueueActivationReason",
ADD COLUMN     "available_at" TIMESTAMP(3),
ADD COLUMN     "blocked_until" TIMESTAMP(3),
ADD COLUMN     "delay_until" TIMESTAMP(3),
ADD COLUMN     "dependency_group_id" TEXT,
ADD COLUMN     "parent_recurring_item_id" TEXT,
ADD COLUMN     "partition_key" TEXT,
ADD COLUMN     "rate_limit_key" TEXT,
ADD COLUMN     "recurrence_rule_id" TEXT,
ADD COLUMN     "scheduled_for" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "queue_recurrence_rules" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cron_expression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "max_runs" INTEGER,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "payload_template" JSONB,
    "priority" "QueuePriority" NOT NULL DEFAULT 'Green',
    "partition_key" TEXT,
    "rate_limit_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_dependencies" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "queue_item_id" TEXT NOT NULL,
    "depends_on_queue_item_id" TEXT NOT NULL,
    "dependency_type" "QueueDependencyType" NOT NULL DEFAULT 'COMPLETE_REQUIRED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "rate_limit_key" TEXT NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "max_items" INTEGER NOT NULL,
    "current_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queue_recurrence_rules_workspace_id_is_enabled_next_run_at_idx" ON "queue_recurrence_rules"("workspace_id", "is_enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "queue_recurrence_rules_workspace_id_idx" ON "queue_recurrence_rules"("workspace_id");

-- CreateIndex
CREATE INDEX "queue_dependencies_workspace_id_queue_item_id_idx" ON "queue_dependencies"("workspace_id", "queue_item_id");

-- CreateIndex
CREATE INDEX "queue_dependencies_workspace_id_depends_on_queue_item_id_idx" ON "queue_dependencies"("workspace_id", "depends_on_queue_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_dependencies_queue_item_id_depends_on_queue_item_id_key" ON "queue_dependencies"("queue_item_id", "depends_on_queue_item_id");

-- CreateIndex
CREATE INDEX "queue_rate_limit_buckets_workspace_id_rate_limit_key_idx" ON "queue_rate_limit_buckets"("workspace_id", "rate_limit_key");

-- CreateIndex
CREATE UNIQUE INDEX "queue_rate_limit_buckets_workspace_id_rate_limit_key_key" ON "queue_rate_limit_buckets"("workspace_id", "rate_limit_key");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_available_at_idx" ON "queue_items"("workspace_id", "available_at");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_scheduled_for_idx" ON "queue_items"("workspace_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_delay_until_idx" ON "queue_items"("workspace_id", "delay_until");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_partition_key_status_priority_rank_idx" ON "queue_items"("workspace_id", "partition_key", "status", "priority", "ranking_timestamp");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_rate_limit_key_idx" ON "queue_items"("workspace_id", "rate_limit_key");

-- CreateIndex
CREATE INDEX "queue_items_workspace_id_dependency_group_id_idx" ON "queue_items"("workspace_id", "dependency_group_id");

-- CreateIndex
CREATE INDEX "queue_items_recurrence_rule_id_idx" ON "queue_items"("recurrence_rule_id");

-- AddForeignKey
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_recurrence_rule_id_fkey" FOREIGN KEY ("recurrence_rule_id") REFERENCES "queue_recurrence_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_dependencies" ADD CONSTRAINT "queue_dependencies_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_dependencies" ADD CONSTRAINT "queue_dependencies_depends_on_queue_item_id_fkey" FOREIGN KEY ("depends_on_queue_item_id") REFERENCES "queue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
