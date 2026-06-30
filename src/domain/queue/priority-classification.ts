import { QueuePriority } from './enums';

/** Product vocabulary edition used by the automatic priority classifier. */
export const PRIORITY_CLASSIFIER_EDITION = 'MCA edition';

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
  'stuck',
  'escalate',
  'escalation',
  'breaking',
  'broken',
  'crash',
  'crashed',
  // MCA edition: deal/funding blockers and high-risk account signals.
  'declined',
  'rejected',
  'nsf',
  'frozen',
  'fraud',
  'chargeback',
  'default',
  'bankruptcy',
];

/** Multi-word semantic signals that mark an item as urgent (Red). */
const DEFAULT_RED_PHRASES: readonly string[] = [
  'cannot proceed',
  'cant proceed',
  'can not proceed',
  'cannot move forward',
  'cant move forward',
  'can not move forward',
  'unable to proceed',
  'unable to move forward',
  'blocked on',
  'blocking launch',
  'blocking release',
  'customer blocked',
  // MCA edition: funding, underwriting, and closing blockers.
  'cant fund',
  'cannot fund',
  'can not fund',
  'unable to fund',
  'wont fund',
  'will not fund',
  'funding blocked',
  'funding paused',
  'funding held',
  'funding on hold',
  'funding is on hold',
  'funding is held',
  'wire rejected',
  'ach rejected',
  'ach was rejected',
  'bank account frozen',
  'account frozen',
  'account closed',
  'deal is dying',
  'deal will die',
  'merchant backed out',
  'merchant will walk',
  'contract void',
  'contract expired',
  'offer expired',
  'approval expired',
  'stip blocker',
  'file declined',
  'offer pulled',
  'approval pulled',
  'deal lost',
  'merchant disappeared',
  'merchant unresponsive',
  'missing ownership proof',
  'proof of ownership missing',
  'ownership proof missing',
  'do not fund',
  'stop funding',
  'negative days',
  'negative balance days',
  'account went negative',
  'tax lien filed',
  'judgment filed',
  'bankruptcy filed',
  'ucc issue',
  'stacking issue',
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
  'deadline',
  'question',
  'pending',
  'waiting',
  // MCA edition: core merchant-cash-advance / business-funding vocabulary.
  'mca',
  'merchant',
  'funder',
  'lender',
  'iso',
  'broker',
  'underwriting',
  'underwriter',
  'processor',
  'closer',
  'approval',
  'approved',
  'contract',
  'contracts',
  'docs',
  'documents',
  'stip',
  'stips',
  'statements',
  'statement',
  'deposits',
  'revenue',
  'ach',
  'wire',
  'funding',
  'renewal',
  'buyout',
  'payoff',
  'commission',
  'split',
  'remittance',
  'remit',
  'remits',
  'holdback',
  'factor',
  'payback',
  'rtr',
  'origination',
  'position',
  'balance',
  'fico',
  'ucc',
  'judgment',
  'lien',
  'ein',
  'ssn',
  'tin',
  'dba',
  'sos',
  'coi',
  'mid',
  'mids',
  'tib',
  'entity',
  'guarantor',
  'guaranty',
  'license',
  'ownership',
  'landlord',
  'lease',
  'plaid',
  'routing',
  'docusign',
];

/** Multi-word semantic signals that mark an item as needing attention (Yellow). */
const DEFAULT_YELLOW_PHRASES: readonly string[] = [
  'approval needed',
  'needs approval',
  'waiting on',
  'customer waiting',
  'client waiting',
  'asking for',
  'needs review',
  'follow up',
  // MCA edition: common funding, underwriting, and stipulation language.
  'bank statements',
  'bank statement',
  'merchant application',
  'funding application',
  'signed contract',
  'send contract',
  'contract signed',
  'contract out',
  'docs needed',
  'documents needed',
  'missing docs',
  'missing documents',
  'need docs',
  'need documents',
  'stips needed',
  'stip needed',
  'clear stips',
  'clear stip',
  'bank login',
  'plaid login',
  'routing number',
  'account number',
  'voided check',
  'drivers license',
  'driver license',
  'proof of ownership',
  'proof ownership',
  'ownership docs',
  'ownership document',
  'ein letter',
  'tax id',
  'sales volume',
  'monthly revenue',
  'average monthly revenue',
  'average daily balance',
  'beginning balance',
  'ending balance',
  'nsf count',
  'daily payment',
  'weekly payment',
  'daily remit',
  'weekly remit',
  'daily remits',
  'weekly remits',
  'payment frequency',
  'factor rate',
  'buy rate',
  'sell rate',
  'specified percentage',
  'purchased amount',
  'purchase price',
  'receivables purchased',
  'holdback percentage',
  'remittance rate',
  'payoff letter',
  'balance letter',
  'payback amount',
  'gross funding',
  'net funding',
  'origination fee',
  'closing fee',
  'wire fee',
  'renewal offer',
  'funding amount',
  'approval amount',
  'pre approval',
  'preapproval',
  'deal notes',
  'merchant interview',
  'landlord verification',
  'site inspection',
  'landlord contact',
  'tenant ledger',
  'processing statements',
  'credit pull',
  'soft pull',
  'hard pull',
  'background check',
  'ucc search',
  'lien search',
  'tax lien',
  'judgment search',
  'tax returns',
  'profit and loss',
  'business license',
  'secretary of state',
  'good standing',
  'articles of incorporation',
  'operating agreement',
  'ownership percentage',
  'beneficial owner',
  'kyc review',
  'ofac check',
  'business bank account',
  'login issue',
  'bank verification',
  'account verification',
  'same day funding',
  'funding call',
  'closing call',
  'welcome call',
  'underwriting review',
  'funder call',
  'lender call',
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
  private readonly redPhrases: readonly string[];
  private readonly yellowPhrases: readonly string[];

  constructor(
    redKeywords: readonly string[] = DEFAULT_RED_KEYWORDS,
    yellowKeywords: readonly string[] = DEFAULT_YELLOW_KEYWORDS,
    redPhrases: readonly string[] = DEFAULT_RED_PHRASES,
    yellowPhrases: readonly string[] = DEFAULT_YELLOW_PHRASES,
  ) {
    this.redKeywords = redKeywords;
    this.yellowKeywords = yellowKeywords;
    this.redPhrases = redPhrases;
    this.yellowPhrases = yellowPhrases;
  }

  classify(input: PriorityClassificationInput): PriorityClassification {
    const tokens = tokenize(input.text);
    const normalized = normalizeForPhraseMatching(input.text);

    const redSignals = [
      ...this.redKeywords.filter((keyword) => tokens.has(keyword)),
      ...this.redPhrases.filter((phrase) => normalized.includes(phrase)),
    ];
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

    const yellowSignals = [
      ...this.yellowKeywords.filter((keyword) => tokens.has(keyword)),
      ...this.yellowPhrases.filter((phrase) => normalized.includes(phrase)),
    ];
    if (input.isQuestion) {
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

/** Normalize only words/spacing for phrase matching; punctuation is not a signal. */
function normalizeForPhraseMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/can['’]?t/g, 'cant')
    .replace(/won['’]?t/g, 'wont')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +/g, ' ');
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
