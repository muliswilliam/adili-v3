import { acknowledgementSlipV1 } from './acknowledgement-slip.v1.js';
import type { DocumentTemplate } from './template.js';

/** Every template issuance can render, by document type and template version. */
const TEMPLATES: readonly DocumentTemplate[] = [acknowledgementSlipV1];

/** Document types that have a template; later specs add theirs with their templates. */
export const DOCUMENT_TYPES = ['acknowledgement-slip'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** The template for `type` at `version`, or undefined when there is none. */
export function templateOf(type: string, version: number): DocumentTemplate | undefined {
  return TEMPLATES.find((template) => template.type === type && template.version === version);
}
