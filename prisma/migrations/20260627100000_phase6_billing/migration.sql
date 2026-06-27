-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PLAN_CHANGED';

-- CreateEnum
CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- CreateEnum
CREATE TYPE "WorkspacePlanStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "plan" "WorkspacePlan" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "plan_status" "WorkspacePlanStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT,
ADD COLUMN     "plan_updated_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_stripe_customer_id_key" ON "workspaces"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_stripe_subscription_id_key" ON "workspaces"("stripe_subscription_id");
