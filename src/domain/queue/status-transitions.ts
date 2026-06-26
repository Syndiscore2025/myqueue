import { QueueStatus } from './enums';
import { InvalidQueueStatusTransitionError } from './errors';

/** Status every newly created queue item starts in. */
export const INITIAL_STATUS: QueueStatus = QueueStatus.New;

/**
 * The queue lifecycle state machine.
 *
 * Maps each status to the set of statuses it may transition to. The machine is
 * strict: any move not listed here is rejected. A no-op (from === to) is never
 * allowed and is not listed. `Archived` is terminal and has no outgoing edges;
 * `Done` may be re-opened to `Working` or archived.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<QueueStatus, readonly QueueStatus[]>> = {
  [QueueStatus.New]: [
    QueueStatus.Working,
    QueueStatus.Waiting,
    QueueStatus.FollowUp,
    QueueStatus.Snoozed,
    QueueStatus.Done,
    QueueStatus.Archived,
  ],
  [QueueStatus.Working]: [
    QueueStatus.Waiting,
    QueueStatus.FollowUp,
    QueueStatus.Snoozed,
    QueueStatus.Done,
    QueueStatus.Archived,
  ],
  [QueueStatus.Waiting]: [
    QueueStatus.Working,
    QueueStatus.FollowUp,
    QueueStatus.Snoozed,
    QueueStatus.Done,
    QueueStatus.Archived,
  ],
  [QueueStatus.FollowUp]: [
    QueueStatus.Working,
    QueueStatus.Waiting,
    QueueStatus.Snoozed,
    QueueStatus.Done,
    QueueStatus.Archived,
  ],
  [QueueStatus.Snoozed]: [
    QueueStatus.New,
    QueueStatus.Working,
    QueueStatus.Waiting,
    QueueStatus.FollowUp,
    QueueStatus.Done,
    QueueStatus.Archived,
  ],
  [QueueStatus.Done]: [QueueStatus.Working, QueueStatus.Archived],
  [QueueStatus.Archived]: [],
};

/** The statuses an item in `from` may legally move to. */
export function allowedTransitionsFrom(from: QueueStatus): readonly QueueStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/** True when moving `from` -> `to` is permitted by the state machine. */
export function canTransition(from: QueueStatus, to: QueueStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** True when a status is terminal (no further transitions are possible). */
export function isTerminalStatus(status: QueueStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * Assert that a transition is legal, throwing
 * {@link InvalidQueueStatusTransitionError} otherwise.
 */
export function assertTransition(from: QueueStatus, to: QueueStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidQueueStatusTransitionError(from, to);
  }
}
