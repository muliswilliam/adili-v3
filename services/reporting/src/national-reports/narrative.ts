import { z } from 'zod';

import { type DraftScope, NARRATIVE_SECTIONS, type NarrativeSection } from './schema.js';

/**
 * The national consolidated report's narrative (spec 09 NCR): sections Overview, Findings and
 * Recommendations, each stored as paragraphs. The console edits a section as text, paragraphs
 * separated by a blank line; saving maps the text back onto the stored paragraphs so each
 * unchanged paragraph keeps its id and labels (spec 09b's AI-draft flag, aggregate references,
 * pattern candidates) and an edited one loses its AI-draft flag.
 */

/**
 * reporting.yaml `Narrative`, each section as text; also `updateNationalReportNarrative`'s body,
 * paragraphs separated by a blank line.
 */
export const narrativeSchema = z.strictObject({
  overview: z.string().max(20_000),
  findings: z.string().max(40_000),
  recommendations: z.string().max(20_000),
});
export type Narrative = z.infer<typeof narrativeSchema>;

/** reporting.yaml `NarrativeParagraph`. */
export const paragraphSchema = z.object({
  id: z.uuid(),
  section: z.enum(NARRATIVE_SECTIONS),
  position: z.number().int().min(0),
  text: z.string(),
  aiDraft: z.boolean().meta({ description: 'True until the analyst edits the paragraph' }),
  aggregateRefs: z.array(z.string()).meta({
    description:
      'Aggregate keys the paragraph cites, in the ai-gateway scheme (`national.<name>`, `commission.<code>.<name>`, prefixed `fy<fy>.` for a prior year); empty for what an analyst types',
  }),
  candidateIds: z.array(z.string()),
});
export type Paragraph = z.infer<typeof paragraphSchema>;

/** The paragraphs of a section's text: split at blank lines, trimmed, empty ones dropped. */
export function paragraphsOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

/** Each section's text from its paragraphs, in position order, a blank line between them. */
export function narrativeOf(paragraphs: readonly Paragraph[]): Narrative {
  const narrative: Narrative = { overview: '', findings: '', recommendations: '' };
  for (const section of NARRATIVE_SECTIONS) {
    narrative[section] = paragraphs
      .filter((paragraph) => paragraph.section === section)
      .sort((a, b) => a.position - b.position)
      .map((paragraph) => paragraph.text)
      .join('\n\n');
  }
  return narrative;
}

/**
 * A section's paragraphs once `text` is saved over `existing` (that section's stored paragraphs):
 *
 * - a paragraph whose text is unchanged keeps its id and labels, wherever it moved;
 * - otherwise the stored paragraph at the same position, if still unmatched, takes the new text:
 *   an edit, which keeps its id and references and clears `aiDraft`;
 * - any other paragraph is new (`newId`), typed by the analyst; stored paragraphs left unmatched
 *   are gone.
 */
export function saveSection(
  section: NarrativeSection,
  existing: readonly Paragraph[],
  text: string,
  newId: () => string,
): Paragraph[] {
  const stored = existing
    .filter((paragraph) => paragraph.section === section)
    .sort((a, b) => a.position - b.position);
  const texts = paragraphsOf(text);
  const used = new Set<string>();
  const kept: (Paragraph | undefined)[] = texts.map((paragraphText) => {
    const same = stored.find(
      (paragraph) => !used.has(paragraph.id) && paragraph.text === paragraphText,
    );
    if (same) used.add(same.id);
    return same;
  });
  return texts.map((paragraphText, position) => {
    const same = kept[position];
    if (same) return { ...same, position };
    const atPosition = stored[position];
    if (atPosition && !used.has(atPosition.id)) {
      used.add(atPosition.id);
      return { ...atPosition, position, text: paragraphText, aiDraft: false };
    }
    return {
      id: newId(),
      section,
      position,
      text: paragraphText,
      aiDraft: false,
      aggregateRefs: [],
      candidateIds: [],
    };
  });
}

/** A paragraph as the ai-gateway's `narrate-compliance-report` task drafts it. */
export interface DraftedParagraph {
  section: NarrativeSection;
  text: string;
  aggregateRefs: string[];
  candidateIds: string[];
}

/** The sections a draft of `scope` writes. */
export function sectionsOf(scope: DraftScope): readonly NarrativeSection[] {
  return scope === 'all' ? NARRATIVE_SECTIONS : [scope];
}

/**
 * The narrative's paragraphs once `drafted` (spec 09b) is inserted into the sections of `scope`,
 * as AI drafts citing their aggregate keys and candidates. In each of those sections the drafted
 * paragraphs replace the paragraphs still marked as AI drafts, where the first of them stood (at
 * the end when there were none), and every paragraph the analyst edited or typed stays where it
 * was; with `replaceAll` they replace the whole section. Other sections, and drafted paragraphs
 * of sections outside `scope`, are left alone. Positions are renumbered from 0 per section.
 */
export function insertDraft(
  existing: readonly Paragraph[],
  drafted: readonly DraftedParagraph[],
  scope: DraftScope,
  replaceAll: boolean,
  newId: () => string,
): Paragraph[] {
  const sections = sectionsOf(scope);
  return NARRATIVE_SECTIONS.flatMap((section) => {
    const stored = existing
      .filter((paragraph) => paragraph.section === section)
      .sort((a, b) => a.position - b.position);
    if (!sections.includes(section)) return stored;
    const replaced = (paragraph: Paragraph) => replaceAll || paragraph.aiDraft;
    const kept = stored.filter((paragraph) => !replaced(paragraph));
    const firstReplaced = stored.findIndex(replaced);
    const at = firstReplaced === -1 ? kept.length : firstReplaced;
    const inserted = drafted
      .filter((paragraph) => paragraph.section === section)
      // One paragraph stays one: a blank line inside would split it at the next save.
      .map((paragraph) => ({ ...paragraph, text: paragraphsOf(paragraph.text).join('\n') }))
      .filter((paragraph) => paragraph.text !== '')
      .map((paragraph): Paragraph => ({
        id: newId(),
        section,
        position: 0,
        text: paragraph.text,
        aiDraft: true,
        aggregateRefs: [...paragraph.aggregateRefs],
        candidateIds: [...paragraph.candidateIds],
      }));
    return [...kept.slice(0, at), ...inserted, ...kept.slice(at)].map((paragraph, position) => ({
      ...paragraph,
      position,
    }));
  });
}
