import { QueueStatus } from '../../src/domain/queue/enums';
import { InvalidQueueStatusTransitionError } from '../../src/domain/queue/errors';
import {
  ALLOWED_TRANSITIONS,
  INITIAL_STATUS,
  allowedTransitionsFrom,
  assertTransition,
  canTransition,
  isTerminalStatus,
} from '../../src/domain/queue/status-transitions';

describe('queue status transitions', () => {
  it('starts new items in the New status', () => {
    expect(INITIAL_STATUS).toBe(QueueStatus.New);
  });

  it('permits representative valid transitions', () => {
    expect(canTransition(QueueStatus.New, QueueStatus.Working)).toBe(true);
    expect(canTransition(QueueStatus.Working, QueueStatus.Done)).toBe(true);
    expect(canTransition(QueueStatus.Waiting, QueueStatus.Working)).toBe(true);
    expect(canTransition(QueueStatus.Snoozed, QueueStatus.New)).toBe(true);
    expect(canTransition(QueueStatus.Done, QueueStatus.Working)).toBe(true);
    expect(canTransition(QueueStatus.Done, QueueStatus.Archived)).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition(QueueStatus.Archived, QueueStatus.New)).toBe(false);
    expect(canTransition(QueueStatus.Done, QueueStatus.Waiting)).toBe(false);
    expect(canTransition(QueueStatus.New, QueueStatus.New)).toBe(false);
  });

  it('never allows a no-op (same-status) transition', () => {
    for (const status of Object.values(QueueStatus)) {
      expect(canTransition(status, status)).toBe(false);
      expect(ALLOWED_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('treats Archived as terminal and Done as re-openable only', () => {
    expect(isTerminalStatus(QueueStatus.Archived)).toBe(true);
    expect(allowedTransitionsFrom(QueueStatus.Archived)).toHaveLength(0);
    expect(isTerminalStatus(QueueStatus.Done)).toBe(false);
    expect([...allowedTransitionsFrom(QueueStatus.Done)].sort()).toEqual(
      [QueueStatus.Archived, QueueStatus.Working].sort(),
    );
  });

  it('reports no other status as terminal', () => {
    for (const status of Object.values(QueueStatus)) {
      if (status !== QueueStatus.Archived) {
        expect(isTerminalStatus(status)).toBe(false);
      }
    }
  });

  it('assertTransition passes silently for valid moves', () => {
    expect(() => assertTransition(QueueStatus.New, QueueStatus.Snoozed)).not.toThrow();
  });

  it('assertTransition throws a 409 InvalidQueueStatusTransitionError for invalid moves', () => {
    let caught: unknown;
    try {
      assertTransition(QueueStatus.Archived, QueueStatus.New);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidQueueStatusTransitionError);
    const err = caught as InvalidQueueStatusTransitionError;
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('INVALID_STATUS_TRANSITION');
    expect(err.from).toBe(QueueStatus.Archived);
    expect(err.to).toBe(QueueStatus.New);
    expect(err.details).toEqual({ from: QueueStatus.Archived, to: QueueStatus.New });
  });
});
