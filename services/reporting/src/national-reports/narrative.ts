import { NARRATIVE_SECTIONS, type NarrativeSection } from './schema.js';

/**
 * The national consolidated report's narrative (spec 09 NCR): sections Overview, Findings and
 * Recommendations, each stored as paragraphs. The console edits a section as text, paragraphs
 * separated by a blank line; saving maps the text back onto the stored paragraphs so each
 * unchanged paragraph keeps its id and labels (spec 09b's AI-draft flag, aggregate references,
 * pattern candidates) and an edited one loses its AI-draft flag.
 */

/** reporting.yaml `Narrative`: each section as text. */
export type Narrative = Record<NarrativeSection, string>;

/** reporting.yaml `NarrativeParagraph`. */
export interface Paragraph {
  id: string;
  section: NarrativeSection;
  position: number;
  text: string;
  aiDraft: boolean;
  aggregateRefs: string[];
  candidateIds: string[];
}

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
