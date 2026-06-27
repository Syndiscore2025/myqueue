import {
  type PrismaClient,
  type Workspace,
  type WorkspacePlan,
  type WorkspacePlanStatus,
  type WorkspaceSettings,
  type WorkspaceUser,
  WorkspaceStatus,
} from '@prisma/client';
import { getPrisma } from '../database/prisma';

/** Identifying details of a Slack tenant (team or enterprise-grid org). */
export interface TenantQuery {
  teamId?: string | null;
  enterpriseId?: string | null;
  isEnterpriseInstall?: boolean;
}

/** Fields required to create or refresh a workspace from an installation. */
export interface WorkspaceUpsertInput {
  slackTeamId: string | null;
  slackTeamName: string | null;
  slackEnterpriseId: string | null;
  slackEnterpriseName: string | null;
  isEnterpriseInstall: boolean;
}

/** Per-workspace user details captured during installation. */
export interface WorkspaceUserInput {
  slackUserId: string;
  displayName?: string | null;
  isAdmin?: boolean;
  isInstaller?: boolean;
}

/**
 * Partial billing update for a workspace. Any omitted field is left unchanged
 * (Prisma treats `undefined` as a no-op); pass `null` to explicitly clear a
 * Stripe identifier. `planUpdatedAt` is stamped automatically whenever the plan
 * or its status changes.
 */
export interface WorkspaceBillingUpdate {
  plan?: WorkspacePlan;
  planStatus?: WorkspacePlanStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

/**
 * Persistence for tenant workspaces and their directly-owned settings/users.
 * Every method is scoped to a single workspace to enforce tenant isolation.
 */
export class WorkspaceRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  /** Create a workspace, or reactivate/refresh an existing one on reinstall. */
  async upsert(input: WorkspaceUpsertInput): Promise<Workspace> {
    const base = {
      slackTeamId: input.slackTeamId,
      slackTeamName: input.slackTeamName,
      slackEnterpriseId: input.slackEnterpriseId,
      slackEnterpriseName: input.slackEnterpriseName,
      isEnterpriseInstall: input.isEnterpriseInstall,
    };
    const reactivate = { status: WorkspaceStatus.ACTIVE, uninstalledAt: null };

    if (input.isEnterpriseInstall && input.slackEnterpriseId !== null) {
      return this.prisma.workspace.upsert({
        where: { slackEnterpriseId: input.slackEnterpriseId },
        create: base,
        update: { ...base, ...reactivate },
      });
    }
    if (input.slackTeamId !== null) {
      return this.prisma.workspace.upsert({
        where: { slackTeamId: input.slackTeamId },
        create: base,
        update: { ...base, ...reactivate },
      });
    }
    throw new Error('Cannot upsert a workspace without a team or enterprise id');
  }

  /** Resolve a workspace by its Slack tenant identity. */
  async findByTenant(query: TenantQuery): Promise<Workspace | null> {
    if (
      query.isEnterpriseInstall === true &&
      query.enterpriseId !== null &&
      query.enterpriseId !== undefined
    ) {
      return this.prisma.workspace.findUnique({
        where: { slackEnterpriseId: query.enterpriseId },
      });
    }
    if (query.teamId !== null && query.teamId !== undefined) {
      return this.prisma.workspace.findUnique({ where: { slackTeamId: query.teamId } });
    }
    return null;
  }

  async findById(workspaceId: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({ where: { id: workspaceId } });
  }

  /**
   * Resolve a workspace by its Stripe customer id. Used by webhook handling to
   * map a provider event back to the owning tenant. Returns null if no workspace
   * is linked to that customer.
   */
  async findByStripeCustomerId(stripeCustomerId: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({ where: { stripeCustomerId } });
  }

  /**
   * Apply a billing update to a single workspace. Tenant-scoped by id. Stamps
   * `planUpdatedAt` whenever the plan or its status changes so the last billing
   * transition is auditable on the row itself.
   */
  async updateBilling(workspaceId: string, update: WorkspaceBillingUpdate): Promise<Workspace> {
    const touchesPlan = update.plan !== undefined || update.planStatus !== undefined;
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...update,
        ...(touchesPlan ? { planUpdatedAt: new Date() } : {}),
      },
    });
  }

  /** Mark a workspace as uninstalled (soft delete preserving audit history). */
  async markUninstalled(workspaceId: string): Promise<Workspace> {
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: WorkspaceStatus.UNINSTALLED, uninstalledAt: new Date() },
    });
  }

  /** Ensure a settings row exists for the workspace, returning it. */
  async ensureSettings(workspaceId: string): Promise<WorkspaceSettings> {
    return this.prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: { workspaceId },
      update: {},
    });
  }

  /** Resolve a workspace user by its internal id, scoped to the workspace. */
  async findUserById(workspaceId: string, id: string): Promise<WorkspaceUser | null> {
    return this.prisma.workspaceUser.findFirst({ where: { id, workspaceId } });
  }

  /** Insert or update a workspace user, scoped to the workspace. */
  async upsertUser(workspaceId: string, input: WorkspaceUserInput): Promise<WorkspaceUser> {
    const fields = {
      displayName: input.displayName ?? null,
      isAdmin: input.isAdmin ?? false,
      isInstaller: input.isInstaller ?? false,
    };
    return this.prisma.workspaceUser.upsert({
      where: { workspaceId_slackUserId: { workspaceId, slackUserId: input.slackUserId } },
      create: { workspaceId, slackUserId: input.slackUserId, ...fields },
      update: fields,
    });
  }
}

/** Process-wide workspace repository bound to the shared Prisma client. */
export const workspaceRepository = new WorkspaceRepository();
