-- AlterTable
ALTER TABLE "queue_recurrence_rules" ADD COLUMN     "created_by_workspace_user_id" TEXT,
ADD COLUMN     "owner_workspace_user_id" TEXT;
