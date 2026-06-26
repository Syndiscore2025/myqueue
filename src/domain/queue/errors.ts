import { ApplicationError, type ApplicationErrorOptions } from '../errors';
import type { QueueStatus } from './enums';

/**
 * Raised when a queue item is asked to move between two statuses that the
 * lifecycle state machine does not permit. Modeled as a 409 conflict because the
 * request conflicts with the item's current state rather than being malformed.
 */
export class InvalidQueueStatusTransitionError extends ApplicationError {
  readonly statusCode = 409;
  readonly code = 'INVALID_STATUS_TRANSITION';
  readonly from: QueueStatus;
  readonly to: QueueStatus;

  constructor(from: QueueStatus, to: QueueStatus, options: ApplicationErrorOptions = {}) {
    super(`Cannot transition queue item from "${from}" to "${to}"`, {
      ...options,
      details: options.details ?? { from, to },
    });
    this.from = from;
    this.to = to;
  }
}
