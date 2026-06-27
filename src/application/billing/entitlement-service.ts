import {
  PLAN_ENTITLEMENTS,
  WorkspacePlan,
  WorkspacePlanStatus,
  effectiveEntitlements,
  hasHeadroom,
  type PlanEntitlements,
} from '../../domain/billing';
import { PaymentRequiredError } from '../../domain/errors';
import type { QueueItemRepository, WorkspaceRepository } from '../../infrastructure/repositories';
import { queueItemRepository, workspaceRepository } from '../../infrastructure/repositories';

/** A workspace's plan together with the entitlements currently in force. */
export interface WorkspaceEntitlements {
  plan: WorkspacePlan;
  status: WorkspacePlanStatus;
  entitlements: PlanEntitlements;
}

/** Collaborators the service reads from; injectable for testing. */
export interface EntitlementServiceDeps {
  workspaces?: WorkspaceRepository;
  items?: QueueItemRepository;
}

/**
 * Application service that answers "what is this workspace allowed to do, and is
 * it within that allowance right now?". It bridges the pure plan rules in the
 * domain with live tenant-scoped usage from the repositories. Every method is
 * scoped to a single workspace; a missing workspace falls back to the Free tier
 * so enforcement fails safe rather than granting unlimited access.
 */
export class EntitlementService {
  private readonly workspaces: WorkspaceRepository;
  private readonly items: QueueItemRepository;

  constructor(deps: EntitlementServiceDeps = {}) {
    this.workspaces = deps.workspaces ?? workspaceRepository;
    this.items = deps.items ?? queueItemRepository;
  }

  /** Resolve a workspace's plan, billing status, and the entitlements in force. */
  async getEntitlements(workspaceId: string): Promise<WorkspaceEntitlements> {
    const workspace = await this.workspaces.findById(workspaceId);
    if (workspace === null) {
      return {
        plan: WorkspacePlan.FREE,
        status: WorkspacePlanStatus.ACTIVE,
        entitlements: PLAN_ENTITLEMENTS[WorkspacePlan.FREE],
      };
    }
    const plan = workspace.plan;
    const status = workspace.planStatus;
    return { plan, status, entitlements: effectiveEntitlements(plan, status) };
  }

  /**
   * Whether the workspace may create one more active item under its plan's
   * active-item cap. A `null` cap (Business tier) is always allowed.
   */
  async canCreateItem(workspaceId: string): Promise<boolean> {
    const { entitlements } = await this.getEntitlements(workspaceId);
    if (entitlements.maxActiveItems === null) {
      return true;
    }
    const active = await this.items.countActive(workspaceId);
    return hasHeadroom(entitlements.maxActiveItems, active);
  }

  /**
   * Enforce the active-item cap before a create, throwing
   * {@link PaymentRequiredError} (HTTP 402) when the workspace is at its limit so
   * callers surface a billing/upgrade condition rather than a generic failure.
   */
  async assertCanCreateItem(workspaceId: string): Promise<void> {
    const { plan, entitlements } = await this.getEntitlements(workspaceId);
    if (entitlements.maxActiveItems === null) {
      return;
    }
    const active = await this.items.countActive(workspaceId);
    if (!hasHeadroom(entitlements.maxActiveItems, active)) {
      throw new PaymentRequiredError(
        `Active item limit reached for the ${plan} plan ` +
          `(${active}/${entitlements.maxActiveItems}). Upgrade to add more.`,
      );
    }
  }
}

/** Process-wide entitlement service bound to the shared repository singletons. */
export const entitlementService = new EntitlementService();
