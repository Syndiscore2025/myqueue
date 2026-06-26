import { QueuePriority } from './enums';

/** Signals the classifier can reason about. Only `text` is required. */
export interface PriorityClassificationInput {
  /** Free text to scan (typically title + summary or the source message). */
  readonly text: string;
  /** The item's owner is directly @-mentioned. */
  readonly mentionsOwner?: boolean;
  /** The source reads as a question. */
  readonly isQuestion?: boolean;
  /** A deadline is known to be imminent. */
  readonly hasUpcomingDeadline?: boolean;
}

/** Deterministic, explainable result of automatic priority classification. */
export interface PriorityClassification {
  readonly priority: QueuePriority;
  readonly reason: string;
  readonly matchedSignals: readonly string[];
  readonly automatic: true;
}

/** Single-word tokens that mark an item as urgent (Red). */
const DEFAULT_RED_KEYWORDS: readonly string[] = [
  'urgent',
  'asap',
  'immediately',
  'critical',
  'blocker',
  'blocked',
  'outage',
  'down',
  'emergency',
  'p0',
  'sev0',
  'sev1',
  'escalate',
  'escalation',
  'breaking',
  'broken',
  'crash',
  'crashed',
];

/** Single-word tokens that mark an item as needing attention (Yellow). */
const DEFAULT_YELLOW_KEYWORDS: readonly string[] = [
  'soon',
  'today',
  'tomorrow',
  'important',
  'priority',
  'review',
  'reminder',
  'please',
  'deadline',
  'question',
  'pending',
  'waiting',
];

/**
 * Classifies a queue item's priority from textual and contextual signals.
 *
 * The rules are pure and deterministic: Red signals always win, then Yellow,
 * otherwise Green. Matching is token-based (case-insensitive, whole words) so
 * "down" never matches "download". The result explains itself via
 * `matchedSignals` and `reason` for auditability.
 */
export class PriorityClassificationService {
  private readonly redKeywords: readonly string[];
  private readonly yellowKeywords: readonly string[];

  constructor(
    redKeywords: readonly string[] = DEFAULT_RED_KEYWORDS,
    yellowKeywords: readonly string[] = DEFAULT_YELLOW_KEYWORDS,
  ) {
    this.redKeywords = redKeywords;
    this.yellowKeywords = yellowKeywords;
  }

  classify(input: PriorityClassificationInput): PriorityClassification {
    const tokens = tokenize(input.text);

    const redSignals = this.redKeywords.filter((keyword) => tokens.has(keyword));
    if (input.hasUpcomingDeadline) {
      redSignals.push('deadline-imminent');
    }
    if (redSignals.length > 0) {
      return {
        priority: QueuePriority.Red,
        reason: `Urgent signals detected: ${redSignals.join(', ')}`,
        matchedSignals: redSignals,
        automatic: true,
      };
    }

    const yellowSignals = this.yellowKeywords.filter((keyword) => tokens.has(keyword));
    if (input.isQuestion || input.text.includes('?')) {
      yellowSignals.push('question');
    }
    if (input.mentionsOwner) {
      yellowSignals.push('owner-mentioned');
    }
    if (yellowSignals.length > 0) {
      return {
        priority: QueuePriority.Yellow,
        reason: `Attention signals detected: ${dedupe(yellowSignals).join(', ')}`,
        matchedSignals: dedupe(yellowSignals),
        automatic: true,
      };
    }

    return {
      priority: QueuePriority.Green,
      reason: 'No priority signals detected; defaulted to Green',
      matchedSignals: [],
      automatic: true,
    };
  }
}

/** Lowercase and split into a set of alphanumeric word tokens. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}

/** Preserve order while removing duplicate signals. */
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Process-wide classifier using the default keyword sets. */
export const priorityClassificationService = new PriorityClassificationService();
