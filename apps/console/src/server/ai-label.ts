import type { AiLabelDetails } from '@adili/ui';
import { z } from 'zod';

/**
 * An ai-gateway output's `AiLabel` (ADR-007), read into the `AiLabel` badge's details: the
 * contract types it loosely wherever review passes it on. Other fields (`aiAssisted`) are dropped;
 * the disclaimer is kept, as the badge's description ends with it.
 */
export const aiLabelSchema = z.object({
  task: z.string(),
  promptVersion: z.number(),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  disclaimer: z.string(),
}) satisfies z.ZodType<AiLabelDetails>;

export type AiLabel = z.infer<typeof aiLabelSchema>;
