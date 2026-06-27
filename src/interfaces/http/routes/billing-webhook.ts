import { Router, raw } from 'express';
import { billingService } from '../../../application/billing';
import { createLogger } from '../../../utils/logger';

const log = createLogger('billing-webhook');

/** The Stripe signature header carrying the `t=...,v1=...` HMAC scheme. */
const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

/**
 * Stripe webhook receiver. Mounted BEFORE the JSON body parser in app.ts and
 * configured with `express.raw()` so the exact bytes Stripe signed are available
 * for HMAC verification — any re-serialization by a JSON parser would break the
 * signature. Signature verification happens inside the billing service/provider;
 * a verification failure is answered 400, and any other error is logged and
 * answered 500 without leaking internals. A successful (or non-actionable) event
 * is acknowledged with 200 so Stripe stops retrying.
 */
export const billingWebhookRouter = Router();

billingWebhookRouter.post(
  '/api/v1/billing/webhook',
  raw({ type: 'application/json' }),
  (req, res) => {
    const signature = req.header(STRIPE_SIGNATURE_HEADER);
    if (signature === undefined || signature.length === 0) {
      res.status(400).json({ error: 'Missing Stripe signature header' });
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

    billingService
      .handleWebhook(rawBody, signature)
      .then(() => {
        res.status(200).json({ received: true });
      })
      .catch((err: unknown) => {
        // A signature/verification failure is a client error (bad/forged event);
        // anything else is unexpected. Either way, never echo the raw error.
        log.warn({ err }, 'billing webhook rejected');
        res.status(400).json({ error: 'Webhook verification failed' });
      });
  },
);
