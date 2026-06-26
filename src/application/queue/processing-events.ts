import { createLogger } from '../../utils/logger';

/**
 * Internal queue processing events.
 *
 * Phase 3B emits domain events through an {@link EventPublisher} abstraction so
 * the processing lifecycle is observable without coupling the services to any
 * external messaging system. The default {@link LoggingEventPublisher} simply
 * logs; later slices extend the {@link QueueProcessingEvent} union and may swap
 * in a real transport. Events are fire-and-forget side effects — publishing must
 * never change the outcome of the use case that emitted them.
 */

/** Fields shared by every queue processing event. */
interface ProcessingEventBase {
  readonly workspaceId: string;
  readonly occurredAt: Date;
}

/** Emitted when a worker atomically claims a queued item (New -> Processing). */
export interface QueueItemClaimedEvent extends ProcessingEventBase {
  readonly type: 'QueueItemClaimed';
  readonly queueItemId: string;
  readonly permanentQueueId: string;
  readonly workerId: string;
}

/**
 * Emitted when the recovery sweep reclaims an item whose lease expired
 * (Processing -> New), returning abandoned work to the queue.
 */
export interface QueueRecoveredEvent extends ProcessingEventBase {
  readonly type: 'QueueRecovered';
  readonly queueItemId: string;
  readonly permanentQueueId: string;
  readonly previousWorkerId: string | null;
  readonly attemptCount: number;
}

/** Discriminated union of all queue processing events (extended per slice). */
export type QueueProcessingEvent = QueueItemClaimedEvent | QueueRecoveredEvent;

/** Publishes internal queue processing events to interested observers. */
export interface EventPublisher {
  publish(event: QueueProcessingEvent): Promise<void>;
}

/**
 * Default publisher that records events to the application log. It never throws,
 * so a publishing failure cannot break the use case that emitted the event.
 */
export class LoggingEventPublisher implements EventPublisher {
  private readonly log = createLogger('queue-events');

  publish(event: QueueProcessingEvent): Promise<void> {
    const { type, occurredAt, ...rest } = event;
    this.log.info(
      { event: type, ...rest, occurredAt: occurredAt.toISOString() },
      'queue processing event',
    );
    return Promise.resolve();
  }
}

/** Process-wide event publisher. */
export const eventPublisher: EventPublisher = new LoggingEventPublisher();
