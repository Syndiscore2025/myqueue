import { AuditAction } from '@prisma/client';
import { env } from '../../config';
import {
  PURCHASABLE_PLANS,
  type BillingEvent,
  type BillingProvider,
  type WorkspacePlan,
} from '../../domain/billing';
import { NotFoundError, ValidationError } from '../../domain/errors';
import type {
  WorkspaceAuditLogRepository,
  WorkspaceRepository,
} from '../../infrastructure/repositories';
import {
  workspaceAuditLogRepository,
  workspaceRepository,
} from '../../infrastructure/repositories';
import { stripeBillingProvider } from '../../infrastructure/billing';
import { createLogger } from '../../utils/logger';

/** Collaborators the service orchestrates; injectable for testing. */
export interface BillingServiceDeps {
  workspaces?: WorkspaceRepository;
  audit?: WorkspaceAuditLogRepository;
  provider?: BillingProvider;
}

/**
 * Application service orchestrating subscription billing over the tenant-scoped
 * repositories and the {@link BillingProvider} port. It starts hosted checkout /
 * portal sessions for a workspace and applies verified provider webhook events
 * to the workspace's plan, recording a PLAN_CHANGED audit entry on every change.
 * Every method is scoped to a single workspace; webhook handling resolves the
 * tenant from the event (metadata) or by Stripe customer id.
 */
export class BillingService {
  private readonly workspaces: WorkspaceRepository;
  private readonly audit: WorkspaceAuditLogRepository;
  private readonly provider: BillingProvider;
  private readonly log = createLogger('billing-service');

  constructor(deps: BillingServiceDeps = {}) {
    this.workspaces = deps.workspaces ?? workspaceRepository;
    this.audit = deps.audit ?? workspaceAuditLogRepository;
    this.provider = deps.provider ?? stripeBillingProvider;
  }

  /**
   * Start a hosted checkout session for a workspace upgrading to `plan`. Rejects
   * non-purchasable plans (e.g. FREE) and unknown workspaces. Reuses the
   * workspace's existing Stripe customer id when present so the subscription
   * attaches to the same customer.
   */
  async startCheckout(workspaceId: string, plan: WorkspacePlan): Promise<{ url: string }> {
    if (!PURCHASABLE_PLANS.includes(plan)) {
      throw new ValidationError(`Plan "${plan}" cannot be purchased`);
    }
    const workspace = await this.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new NotFoundError('Workspace not found');
    }
    const session = await this.provider.createCheckoutSession({
      workspaceId,
      plan,
      stripeCustomerId: workspace.stripeCustomerId,
      successUrl: env.STRIPE_CHECKOUT_SUCCESS_URL,
      cancelUrl: env.STRIPE_CHECKOUT_CANCEL_URL,
    });
    return { url: session.url };
  }

  /**
   * Open the self-serve billing portal for a workspace with an active Stripe
   * customer, so admins can manage or cancel their subscription. Rejects
   * workspaces that have never started a paid subscription.
   */
  async startPortalSession(workspaceId: string): Promise<{ url: string }> {
    const workspace = await this.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new NotFoundError('Workspace not found');
    }
    if (workspace.stripeCustomerId === null) {
      throw new ValidationError('Workspace has no active billing customer');
    }
    const session = await this.provider.createPortalSession({
      stripeCustomerId: workspace.stripeCustomerId,
      returnUrl: env.STRIPE_PORTAL_RETURN_URL,
    });
    return { url: session.url };
  }

  /**
   * Verify and apply a raw provider webhook. Verification happens in the provider
   * (throws on a bad signature). Actionable subscription events update the
   * workspace's plan/status; non-actionable or unmappable events are acked and
   * ignored so the provider does not retry indefinitely.
   */
  async handleWebhook(rawBody: string, signatureHeader: string): Promise<void> {
    const event = this.provider.verifyAndParseEvent(rawBody, signatureHeader);
    await this.applyEvent(event);
  }

  /** Apply a verified, parsed billing event to the owning workspace. */
  private async applyEvent(event: BillingEvent): Promise<void> {
    const change = event.subscriptionChange;
    if (change === null) {
      this.log.debug({ eventId: event.id, type: event.type }, 'ignoring non-actionable event');
      return;
    }
    const workspaceId = await this.resolveWorkspaceId(change.workspaceId, change.stripeCustomerId);
    if (workspaceId === null) {
      this.log.warn({ eventId: event.id, type: event.type }, 'no workspace for billing event');
      return;
    }
    const before = await this.workspaces.findById(workspaceId);
    const updated = await this.workspaces.updateBilling(workspaceId, {
      plan: change.plan,
      planStatus: change.status,
      ...(change.stripeCustomerId !== null ? { stripeCustomerId: change.stripeCustomerId } : {}),
      ...(change.stripeSubscriptionId !== null
        ? { stripeSubscriptionId: change.stripeSubscriptionId }
        : {}),
    });
    await this.audit.record({
      workspaceId,
      action: AuditAction.PLAN_CHANGED,
      metadata: {
        eventId: event.id,
        eventType: event.type,
        fromPlan: before?.plan ?? null,
        toPlan: updated.plan,
        toStatus: updated.planStatus,
      },
    });
  }

  /** Resolve the owning workspace id from the event, falling back to customer id. */
  private async resolveWorkspaceId(
    workspaceId: string | null,
    stripeCustomerId: string | null,
  ): Promise<string | null> {
    if (workspaceId !== null) {
      return workspaceId;
    }
    if (stripeCustomerId !== null) {
      const workspace = await this.workspaces.findByStripeCustomerId(stripeCustomerId);
      return workspace?.id ?? null;
    }
    return null;
  }
}

/** Process-wide billing service bound to the shared repositories and Stripe provider. */
export const billingService = new BillingService();
