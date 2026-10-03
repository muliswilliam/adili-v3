import { parseSectionKey } from '../declaration/section-key';
import type { AssistantMessage, DeclarationSection } from '../server/declarations/types';
import { ASK_COPY, type AskLanguage } from './copy';

type SectionLink = NonNullable<AssistantMessage['sectionLink']>;

/** Where an answer's button opens: the workspace step, the field in it, and what it says. */
export interface Place {
  step: string;
  /** JSON pointer within the section, as the section screens read it from `?field=`. */
  field: string | null;
  label: string;
}

const CATEGORIES = ['income', 'assets', 'liabilities'] as const;

/** Field names in the button, in both languages; a field not here is left out of the label. */
const FIELD_NAMES: Record<string, Record<AskLanguage, string>> = {
  value: { en: 'value', sw: 'thamani' },
  description: { en: 'description', sw: 'maelezo' },
  type: { en: 'type', sw: 'aina' },
  location: { en: 'location', sw: 'mahali' },
  joint: { en: 'jointly held', sw: 'inamilikiwa kwa pamoja' },
  sharePercent: { en: 'share', sw: 'sehemu' },
  change: { en: 'change', sw: 'mabadiliko' },
  explanation: { en: 'explanation', sw: 'maelezo' },
  nature: { en: 'nature of employment', sw: 'aina ya ajira' },
  natureOther: { en: 'nature of employment', sw: 'aina ya ajira' },
  date: { en: 'date of birth', sw: 'tarehe ya kuzaliwa' },
  place: { en: 'place of birth', sw: 'mahali pa kuzaliwa' },
  postal: { en: 'postal address', sw: 'anwani ya posta' },
  physical: { en: 'physical address', sw: 'anwani ya makazi' },
  maritalStatus: { en: 'marital status', sw: 'hali ya ndoa' },
};

/** Pointer parts that hold a field's value rather than name it (`/value/kesCents`). */
const VALUE_PARTS = new Set(['kesCents', 'amount', 'currency']);

function fieldName(pointer: string, language: AskLanguage): string | null {
  const parts = pointer
    .split('/')
    .slice(1)
    .filter((part) => !/^\d+$/.test(part) && !VALUE_PARTS.has(part));
  const last = parts.at(-1);
  return last ? (FIELD_NAMES[last]?.[language] ?? null) : null;
}

/**
 * The button an answer's section link becomes, or null when the link names a section the draft
 * does not have (a spouse since removed). A statement link opens the person's tab: "Open Assets
 * → value" for the officer, "Open Mary's income" for a spouse.
 */
/** The statement item a pointer is inside (`/assets/1/value` is assets item 1), or null. */
export function linkedItem(
  link: SectionLink,
): { category: (typeof CATEGORIES)[number]; index: number } | null {
  if (!link.sectionKey.startsWith('statement:') || !link.fieldPath) return null;
  const [, category, index] = link.fieldPath.split('/');
  const found = CATEGORIES.find((name) => name === category);
  return found && index !== undefined && /^\d+$/.test(index)
    ? { category: found, index: Number(index) }
    : null;
}

export function linkPlace(
  link: SectionLink,
  sections: readonly DeclarationSection[],
  language: AskLanguage,
  /** The linked item's type as the statement names it ("Vehicle"), once read; English only. */
  itemName?: string,
): Place | null {
  const copy = ASK_COPY[language];
  const parsed = parseSectionKey(link.sectionKey);
  if (!parsed) return null;
  const field = link.fieldPath?.startsWith('/') ? link.fieldPath : null;

  let place: string;
  if (parsed.kind === 'statement') {
    const section = sections.find(
      (candidate) => candidate.key === link.sectionKey && candidate.completeness !== 'archived',
    );
    if (!section) return null;
    const category = CATEGORIES.find((name) => field?.split('/')[1] === name);
    const firstName = section.personName?.trim().split(/\s+/)[0] ?? '';
    const officer = parsed.personKey === 'officer';
    if (category) {
      // The item's type names it best ("Open Vehicle → value"); the screens name types in English.
      const categoryName = itemName && language === 'en' ? itemName : copy.sectionNames[category];
      place =
        officer || !firstName
          ? categoryName
          : copy.personCategory(firstName, itemName && language === 'en' ? itemName : categoryName);
    } else {
      place = officer || !firstName ? copy.sectionNames.statement : copy.personStatement(firstName);
    }
  } else {
    place = copy.sectionNames[parsed.kind];
  }

  const name = field ? fieldName(field, language) : null;
  return {
    step: link.sectionKey,
    field,
    label: copy.openPlace(name ? `${place} → ${name}` : place),
  };
}
