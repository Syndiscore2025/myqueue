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

/**
 * Raised when adding a dependency edge would introduce a cycle in the
 * depends-on graph (including a self-dependency). Modeled as a 409 conflict
 * because the request conflicts with the graph's acyclic invariant rather than
 * being malformed.
 */
export class DependencyCycleError extends ApplicationError {
  readonly statusCode = 409;
  readonly code = 'DEPENDENCY_CYCLE';
  readonly permanentQueueId: string;
  readonly dependsOnPermanentQueueId: string;

  constructor(
    permanentQueueId: string,
    dependsOnPermanentQueueId: string,
    options: ApplicationErrorOptions = {},
  ) {
    super(
      `Adding a dependency from "${permanentQueueId}" on "${dependsOnPermanentQueueId}" would create a cycle`,
      {
        ...options,
        details: options.details ?? { permanentQueueId, dependsOnPermanentQueueId },
      },
    );
    this.permanentQueueId = permanentQueueId;
    this.dependsOnPermanentQueueId = dependsOnPermanentQueueId;
  }
}
