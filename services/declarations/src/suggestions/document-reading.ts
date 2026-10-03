import type { ExtractionReading } from '../ai-gateway/ai-gateway-client.js';

/**
 * A document's reading (the ai-gateway's `extract-document` output) as a suggestion holds it
 * (spec 05b S6), pure. Its fields keep the gateway's names, declaration.v1 paths within the item
 * (`details.registration`, `outstanding.kesCents`), with their typed values; what each was read
 * with, its confidence and page, goes in `sourceRef` beside the kind the reading took the
 * document for, its warnings and the attachment. The suggestion's confidence is its least sure
 * field's: one low field makes the reading one to check.
 */
export interface ReadingContents {
  fields: Record<string, string | number | boolean>;
  sourceRef: {
    attachmentId: string | null;
    documentKind: ExtractionReading['detectedKind'];
    fields: { name: string; confidence: number; page: number | null }[];
    warnings: string[];
  };
  confidence: number | null;
}

export function readingContents(
  output: ExtractionReading,
  attachmentId: string | null,
): ReadingContents {
  return {
    fields: Object.fromEntries(output.fields.map(({ name, value }) => [name, value])),
    sourceRef: {
      attachmentId,
      documentKind: output.detectedKind,
      fields: output.fields.map(({ name, confidence, page }) => ({ name, confidence, page })),
      warnings: output.warnings,
    },
    confidence:
      output.fields.length === 0
        ? null
        : Math.min(...output.fields.map(({ confidence }) => confidence)),
  };
}
