-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('APP_INSTALLED', 'APP_REINSTALLED', 'APP_UNINSTALLED', 'TOKENS_REVOKED', 'SETTINGS_UPDATED');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT,
    "slack_team_name" TEXT,
    "slack_enterprise_id" TEXT,
    "slack_enterprise_name" TEXT,
    "is_enterprise_install" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_installations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "app_id" TEXT,
    "auth_version" TEXT NOT NULL DEFAULT 'v2',
    "token_type" TEXT,
    "is_enterprise_install" BOOLEAN NOT NULL DEFAULT false,
    "enterprise_url" TEXT,
    "bot_id" TEXT,
    "bot_user_id" TEXT,
    "bot_scopes" TEXT[],
    "bot_token_ciphertext" TEXT,
    "bot_refresh_token_ciphertext" TEXT,
    "bot_token_expires_at" TIMESTAMP(3),
    "installer_user_id" TEXT,
    "user_scopes" TEXT[],
    "user_token_ciphertext" TEXT,
    "user_refresh_token_ciphertext" TEXT,
    "user_token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "slack_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "default_channel_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_users" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_installer" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actor_slack_user_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slack_team_id_key" ON "workspaces"("slack_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slack_enterprise_id_key" ON "workspaces"("slack_enterprise_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_installations_workspace_id_key" ON "slack_installations"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_settings_workspace_id_key" ON "workspace_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_users_workspace_id_idx" ON "workspace_users"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_users_workspace_id_slack_user_id_key" ON "workspace_users"("workspace_id", "slack_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");

-- CreateIndex
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "workspace_audit_logs_workspace_id_created_at_idx" ON "workspace_audit_logs"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_users" ADD CONSTRAINT "workspace_users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_audit_logs" ADD CONSTRAINT "workspace_audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
