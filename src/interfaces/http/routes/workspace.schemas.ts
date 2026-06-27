import { z } from 'zod';
import { queueRankingModeSchema } from './queue.schemas';

/**
 * Partial update of a workspace's settings: queue ranking behavior plus the
 * Phase 5 notification preferences. Every field is optional so a client can
 * patch a single preference; at least one field must be present. This gives the
 * workspace settings surface the user-facing control over notifications that
 * Phase 5 read but never exposed.
 */
export const updateWorkspaceSettingsSchema = z
  .object({
    rankingMode: queueRankingModeSchema,
    includeWaitingInActive: z.boolean(),
    includeWorkingInActive: z.boolean(),
    notifyOnAssignment: z.boolean(),
    notifyOnSnoozeWake: z.boolean(),
    notifyOnFollowUpDue: z.boolean(),
    dailyDigestEnabled: z.boolean(),
    dailyDigestHourUtc: z.number().int().min(0).max(23),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one setting must be provided',
  });
