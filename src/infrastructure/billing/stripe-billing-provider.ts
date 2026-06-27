import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config';
import {
  WorkspacePlan,
  WorkspacePlanStatus,
  type BillingEvent,
  type BillingProvider,
  type CheckoutSession,
  type CheckoutSessionRequest,
  type PortalSession,
  type PortalSessionRequest,
  type SubscriptionChange,
} from '../../domain/billing';
import { createLogger } from '../../utils/logger';
import {
  mapStripeStatus,
  parseStripeEvent,
  planForPriceId,
  priceIdForPlan,
  type StripeProviderConfig,
} from './stripe-mappers';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
/** Max age (seconds) of a webhook timestamp before it is rejected as stale. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/** The minimal Stripe configuration the adapter reads; injectable for testing. */
export interface StripeBillingProviderDeps {
  config?: StripeProviderConfig;
  /** Injectable fetch + clock so the adapter is unit-testable without network. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function configFromEnv(): StripeProviderConfig {
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceProId: env.STRIPE_PRICE_PRO,
    priceBusinessId: env.STRIPE_PRICE_BUSINESS,
  };
}

/**
 * Stripe-backed {@link BillingProvider} implemented with native `fetch` and the
 * Node `crypto` module — no Stripe SDK dependency. Checkout/portal sessions are
 * created via form-encoded calls to the Stripe REST API; webhook events are
 * verified with the documented `t=...,v1=...` HMAC-SHA256 scheme before parsing.
 */
export class StripeBillingProvider implements BillingProvider {
  private readonly config: StripeProviderConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log = createLogger('stripe-billing');

  constructor(deps: StripeBillingProviderDeps = {}) {
    this.config = deps.config ?? configFromEnv();
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => Date.now());
  }

  async createCheckoutSession(request: CheckoutSessionRequest): Promise<CheckoutSession> {
    const priceId = priceIdForPlan(this.config, request.plan);
    if (priceId.length === 0) {
      throw new Error(`No Stripe price configured for plan "${request.plan}"`);
    }
    const form: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.workspaceId,
      'metadata[workspaceId]': request.workspaceId,
      'subscription_data[metadata][workspaceId]': request.workspaceId,
    };
    if (typeof request.stripeCustomerId === 'string' && request.stripeCustomerId.length > 0) {
      form.customer = request.stripeCustomerId;
    }
    const session = await this.post('/checkout/sessions', form);
    const url = session.url;
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('Stripe checkout session response missing url');
    }
    return { url };
  }

  async createPortalSession(request: PortalSessionRequest): Promise<PortalSession> {
    const session = await this.post('/billing_portal/sessions', {
      customer: request.stripeCustomerId,
      return_url: request.returnUrl,
    });
    const url = session.url;
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('Stripe portal session response missing url');
    }
    return { url };
  }

  verifyAndParseEvent(rawBody: string, signatureHeader: string): BillingEvent {
    this.verifySignature(rawBody, signatureHeader);
    return parseStripeEvent(this.config, JSON.parse(rawBody) as Record<string, unknown>);
  }

  /** POST a form-encoded request to the Stripe REST API and parse the JSON body. */
  private async post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      this.log.error({ status: response.status, path }, 'Stripe API request failed');
      throw new Error(`Stripe API error (${response.status}) on ${path}`);
    }
    return body;
  }

  /**
   * Verify a Stripe webhook signature header (`t=<ts>,v1=<sig>,...`). Recomputes
   * the HMAC-SHA256 of `<ts>.<body>` with the webhook secret and compares it in
   * constant time, rejecting missing parts, stale timestamps, and mismatches.
   */
  private verifySignature(rawBody: string, signatureHeader: string): void {
    const parts = new Map(
      signatureHeader.split(',').map((kv) => {
        const idx = kv.indexOf('=');
        return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()] as [string, string];
      }),
    );
    const timestamp = parts.get('t');
    const signature = parts.get('v1');
    if (timestamp === undefined || signature === undefined) {
      throw new Error('Stripe signature header missing timestamp or v1 signature');
    }
    const ageSeconds = Math.floor(this.now() / 1000) - Number(timestamp);
    if (!Number.isFinite(ageSeconds) || Math.abs(ageSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
      throw new Error('Stripe signature timestamp outside tolerance');
    }
    const expected = createHmac('sha256', this.config.webhookSecret)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Stripe signature verification failed');
    }
  }
}

/** Process-wide Stripe billing provider bound to the validated env config. */
export const stripeBillingProvider = new StripeBillingProvider();

export { mapStripeStatus, planForPriceId, WorkspacePlan, WorkspacePlanStatus };
export type { SubscriptionChange };
