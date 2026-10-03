import type { AnswerOutput } from '../ai-gateway/ai-gateway-client.js';
import { SECTION_KEY } from '../drafts/sections.js';
import type { AssistantLanguage, StoredSectionLink } from './schema.js';

/**
 * Grounded or silent (spec 11 S3), pure: the ai-gateway's answer is kept only when every block
 * rests on passages retrieved for this question; otherwise, or when the gateway declined, the
 * declarant gets the decline and the reporting officer's contact. The gateway checks the same
 * (ADR-019); this is the service's own check of what it stores, against what it retrieved.
 */

/** What the declarant reads when the corpus does not support an answer, without the contact. */
export const DECLINE_TEXT: Record<AssistantLanguage, string> = {
  en: 'I could not find this in the Act or Regulations. Ask your reporting officer.',
  sw: 'Sikupata jambo hili katika Sheria wala Kanuni. Muulize afisa wako wa kuripoti.',
};

/** ai-gateway.yaml residual `fieldPath`: what a link may point at within a section. */
const FIELD_PATH = /^(\/([a-z][A-Za-z0-9]*|0|[1-9][0-9]*))*$/;

export type CheckedAnswer =
  | { declined: true }
  | {
      declined: false;
      /** The blocks' text, one paragraph each. */
      text: string;
      /** The passages cited, each once, in the order first cited. */
      passageIds: string[];
      sectionLink: StoredSectionLink | null;
    };

/**
 * The answer as it may be stored. `retrieved` are the passage ids sent with the question;
 * `sections` the draft's live sections, which a link must name (none outside a draft). A link
 * that names no live section, or a field path that is not a pointer, is left out: it says
 * nothing about whether the cited answer is right.
 */
export function checkAnswer(
  output: AnswerOutput,
  retrieved: ReadonlySet<string>,
  sections: ReadonlySet<string>,
): CheckedAnswer {
  if (output.declined || output.blocks.length === 0) return { declined: true };
  const grounded = output.blocks.every(
    (block) =>
      block.text.trim().length > 0 &&
      block.passageIds.length > 0 &&
      block.passageIds.every((id) => retrieved.has(id)),
  );
  if (!grounded) return { declined: true };
  const passageIds = [...new Set(output.blocks.flatMap((block) => block.passageIds))];
  const link = output.blocks
    .map((block) => block.sectionLink)
    .find(
      (each): each is NonNullable<typeof each> =>
        each !== null &&
        SECTION_KEY.test(each.sectionKey) &&
        sections.has(each.sectionKey) &&
        (each.fieldPath === null || FIELD_PATH.test(each.fieldPath)),
    );
  return {
    declined: false,
    text: output.blocks.map((block) => block.text.trim()).join('\n\n'),
    passageIds,
    sectionLink: link ? { sectionKey: link.sectionKey, fieldPath: link.fieldPath } : null,
  };
}
