import type { AnswerOutput } from '../ai-gateway/ai-gateway-client.js';
import { SECTION_KEY } from '../drafts/sections.js';
import { FIELD_PATH } from './context.js';
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

/**
 * The id the ai-gateway and the model cite a passage by: its place in the passages sent (`p1`,
 * `p2`, ...), never the passage's own id. Corpus ids are uuidv7s minted in one import, alike but
 * for a few hex digits, and a model copying them writes one that is off by a digit
 * (`...-ad89-...` as `...-ad90-...`): a grounded answer then fails the check and is declined
 * (#622). A short key is copied right.
 */
export function citeKey(index: number): string {
  return `p${String(index + 1)}`;
}

/**
 * The gateway's answer with each cite key put back as the id of the passage it stands for, by
 * its place in `passageIds` (the passages as sent). A key that stands for no passage is kept as
 * it is, so the check below declines the answer.
 */
export function resolveCiteKeys(output: AnswerOutput, passageIds: readonly string[]): AnswerOutput {
  const byKey = new Map(passageIds.map((id, index) => [citeKey(index), id]));
  return {
    ...output,
    blocks: output.blocks.map((block) => ({
      ...block,
      passageIds: block.passageIds.map((key) => byKey.get(key) ?? key),
    })),
  };
}

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
