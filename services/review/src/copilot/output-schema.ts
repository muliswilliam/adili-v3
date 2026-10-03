import { z } from 'zod';

/**
 * The shapes of the copilot's task outputs (ai-gateway.yaml `SummarizeDeclarationOutput` and
 * `ExplainFlagsOutput`), checked before an output is stored: the gateway validates them too, but
 * an output outside the contract must fail the copilot (`validation`), never reach the panel.
 * Loose objects: fields the contract adds later are kept, not refused.
 */
const sourceRef = z.looseObject({
  sectionKey: z.string().nullable(),
  personKey: z.string().nullable(),
  itemId: z.string().nullable(),
});

const label = z.looseObject({ aiAssisted: z.literal(true) });

const summaryOutput = z.looseObject({
  label,
  overview: z.string(),
  changesSincePrevious: z.array(z.looseObject({ text: z.string(), refs: z.array(sourceRef) })),
  sections: z.array(
    z.looseObject({ sectionKey: z.string(), text: z.string(), refs: z.array(sourceRef) }),
  ),
  worthAttention: z.array(z.looseObject({ text: z.string(), flagIds: z.array(z.string()) })),
});

const explanationsOutput = z.looseObject({
  label,
  explanations: z.array(
    z.looseObject({
      flagId: z.string(),
      meaning: z.string(),
      whatToCheck: z.array(z.string()),
      typicalResolution: z.string(),
      refs: z.array(sourceRef),
    }),
  ),
});

/** Whether `output` is a summary (or explanations) as the contract gives it. */
export function isCopilotOutput(
  kind: 'summary' | 'explanations',
  output: Record<string, unknown> | null,
): output is Record<string, unknown> {
  return (kind === 'summary' ? summaryOutput : explanationsOutput).safeParse(output).success;
}
