import { accessNilLetterV1 } from './access-nil-letter.v1.js';
import { accessPackageV1 } from './access-package.v1.js';
import { acknowledgementSlipV1 } from './acknowledgement-slip.v1.js';
import { certifiedCopyV1 } from './certified-copy.v1.js';
import { clarificationLetterV1 } from './clarification-letter.v1.js';
import type { DocumentTemplate } from './template.js';

/** Every template issuance can render, by document type and template version. */
const TEMPLATES: readonly DocumentTemplate[] = [
  acknowledgementSlipV1,
  clarificationLetterV1,
  accessPackageV1,
  accessNilLetterV1,
  certifiedCopyV1,
];

/** The template for `type` at `version`, or undefined when there is none. */
export function templateOf(type: string, version: number): DocumentTemplate | undefined {
  return TEMPLATES.find((template) => template.type === type && template.version === version);
}
