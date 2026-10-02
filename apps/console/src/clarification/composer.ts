import type { AiLabelDetails } from '@adili/ui';

import type { Requirement } from '../server/review/types';
import { DEFAULT_DRAFT_LANGUAGE, type DraftLanguage } from './draft-selection';
import { type ClarificationTarget, targetOf, type TargetRef } from './targets';

/**
 * The clarification composer's state (spec 07a FE-4, S19): the items being written, each with
 * what it is about, what Act s.35(4) requires and the text, and the checks before saving or
 * issuing. Pure, so the composer drawer and Draft with AI (spec 07c FE-3) share one reducer:
 * drafted items arrive through `insert` and are ordinary items from then on, labelled until the
 * reviewer changes them.
 */

/** review.yaml `ClarificationItemInput.text` limit. */
export const ITEM_TEXT_MAX = 1000;

/** review.yaml `ClarificationInput.opening` limit. */
export const OPENING_TEXT_MAX = 800;

export interface ComposerItem {
  /** Stable while the composer is open, for React keys and field ids. */
  key: string;
  target: ClarificationTarget | null;
  requirement: Requirement | null;
  text: string;
  /** The AI label of an item Draft with AI inserted in this sitting; null otherwise. */
  ai: AiLabelDetails | null;
  /**
   * The Draft with AI job that drafted the item, saved and issued with it (review.yaml
   * `ClarificationItemInput.aiJobId`) so it stays labelled AI-assisted (ADR-007), also once
   * edited and in a saved draft, whose label details are not kept. Null for the reviewer's own.
   */
  aiJobId: string | null;
  /** An inserted item the reviewer has changed since ("AI draft, edited"). */
  edited: boolean;
  /** The language Draft with AI drafted it in, in this sitting; null when not known. */
  language: DraftLanguage | null;
}

/**
 * The letter's opening paragraph, printed before the items: proposed by Draft with AI, or saved
 * with a draft. Saved and issued with the items (review.yaml `ClarificationInput.opening`).
 */
export interface ComposerOpening {
  text: string;
  ai: AiLabelDetails | null;
  /** The Draft with AI job that drafted it (review.yaml `ClarificationInput.openingAiJobId`). */
  aiJobId: string | null;
  edited: boolean;
  /** The language Draft with AI drafted it in, in this sitting; null when not known. */
  language: DraftLanguage | null;
}

export interface ComposerState {
  items: ComposerItem[];
  opening: ComposerOpening | null;
  /**
   * The letter's language (review.yaml `LetterLanguage`): its own text (heading, introduction,
   * labels, how to respond) is in it, and Draft with AI drafts in it. English to start with.
   */
  language: DraftLanguage;
  /** The next item key's number. */
  next: number;
}

/** An item to put in the composer: a saved one, a drafted one, or one picked from the case. */
export interface ComposerSeed extends Partial<TargetRef> {
  requirement: Requirement | null;
  text: string;
  label?: string | null;
  /** A saved item's drafting job; a drafted one's comes from `ComposerDraft.jobId`. */
  aiJobId?: string | null;
}

/** What Draft with AI returns (review.yaml `CopilotDraft`), or seeds from elsewhere. */
export interface ComposerDraft {
  /** The AI label of the draft; null for items the reviewer seeds without AI. */
  label: AiLabelDetails | null;
  /** The Draft with AI job (`CopilotDraft.jobId`); null for items seeded without AI. */
  jobId: string | null;
  /** The language it was drafted in; null (or left out) for items seeded without AI. */
  language?: DraftLanguage | null;
  opening: string | null;
  items: ComposerSeed[];
}

export type ComposerAction =
  | { type: 'add' }
  | { type: 'remove'; key: string }
  | { type: 'target'; key: string; target: ClarificationTarget | null }
  | { type: 'requirement'; key: string; requirement: Requirement | null }
  | { type: 'text'; key: string; text: string }
  | { type: 'insert'; draft: ComposerDraft; targets: readonly ClarificationTarget[] }
  | { type: 'opening'; text: string }
  | { type: 'discard-opening' }
  | { type: 'language'; language: DraftLanguage };

function blank(key: string): ComposerItem {
  return {
    key,
    target: null,
    requirement: null,
    text: '',
    ai: null,
    aiJobId: null,
    edited: false,
    language: null,
  };
}

const isBlank = (item: ComposerItem) =>
  item.target === null && item.requirement === null && item.text.trim() === '';

function seeded(
  state: ComposerState,
  seeds: readonly ComposerSeed[],
  targets: readonly ClarificationTarget[],
  ai: AiLabelDetails | null,
  jobId: string | null,
  language: DraftLanguage | null,
): ComposerState {
  let next = state.next;
  const items = seeds.map((seed) => ({
    key: `item-${String(next++)}`,
    target: targetOf(
      {
        sectionKey: seed.sectionKey ?? null,
        personKey: seed.personKey ?? null,
        itemId: seed.itemId ?? null,
        label: seed.label ?? null,
      },
      targets,
    ),
    requirement: seed.requirement,
    text: seed.text,
    ai,
    aiJobId: seed.aiJobId ?? jobId,
    edited: false,
    language,
  }));
  return { ...state, items: [...state.items, ...items], next };
}

/** A new clarification: one blank item to start from, in English. */
export function emptyComposer(): ComposerState {
  return { items: [blank('item-1')], opening: null, language: DEFAULT_DRAFT_LANGUAGE, next: 2 };
}

/** A saved draft (or a follow-up's pre-filled draft), its items on their targets. */
export function draftComposer(
  {
    items,
    opening,
    openingAiJobId = null,
    language = DEFAULT_DRAFT_LANGUAGE,
  }: {
    items: readonly ComposerSeed[];
    opening: string | null;
    openingAiJobId?: string | null;
    language?: DraftLanguage;
  },
  targets: readonly ClarificationTarget[],
): ComposerState {
  return seeded(
    {
      items: [],
      opening: opening
        ? { text: opening, ai: null, aiJobId: openingAiJobId, edited: false, language: null }
        : null,
      language,
      next: 1,
    },
    items,
    targets,
    null,
    null,
    null,
  );
}

function update(
  state: ComposerState,
  key: string,
  change: (item: ComposerItem) => Partial<ComposerItem>,
): ComposerState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.key === key ? { ...item, ...change(item), edited: item.ai !== null } : item,
    ),
  };
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'add':
      return {
        ...state,
        items: [...state.items, blank(`item-${String(state.next)}`)],
        next: state.next + 1,
      };
    case 'remove':
      return { ...state, items: state.items.filter((item) => item.key !== action.key) };
    case 'target':
      return update(state, action.key, () => ({ target: action.target }));
    case 'requirement':
      return update(state, action.key, () => ({ requirement: action.requirement }));
    case 'text':
      return update(state, action.key, () => ({ text: action.text }));
    case 'insert': {
      const { draft, targets } = action;
      // A lone blank item is the composer's starting point, not the reviewer's work.
      const kept =
        state.items.length === 1 && state.items[0] && isBlank(state.items[0]) ? [] : state.items;
      const inserted = seeded(
        { ...state, items: kept },
        draft.items,
        targets,
        draft.label,
        draft.jobId,
        draft.language ?? null,
      );
      // A new draft's opening replaces an earlier one only while nobody has written in it.
      const replaceable =
        state.opening === null || (state.opening.ai !== null && !state.opening.edited);
      return draft.opening && replaceable
        ? {
            ...inserted,
            opening: {
              text: draft.opening,
              ai: draft.label,
              aiJobId: draft.jobId,
              edited: false,
              language: draft.language ?? null,
            },
          }
        : inserted;
    }
    case 'opening':
      return {
        ...state,
        opening: {
          ai: state.opening?.ai ?? null,
          aiJobId: state.opening?.aiJobId ?? null,
          text: action.text,
          edited: state.opening?.ai != null,
          language: state.opening?.language ?? null,
        },
      };
    case 'discard-opening':
      return { ...state, opening: null };
    case 'language':
      return { ...state, language: action.language };
  }
}

/**
 * The language a drafted part (an item or the opening) is in when it is not the letter's, so
 * the composer can say so; null when it matches or is not known.
 */
export const foreignLanguageOf = (
  part: { language: DraftLanguage | null },
  letter: DraftLanguage,
): DraftLanguage | null =>
  part.language !== null && part.language !== letter ? part.language : null;

export type ItemProblem = 'required' | 'too-long';

export interface ComposerProblems {
  /** Issuing needs at least one item. */
  none: boolean;
  /** The opening paragraph is over 800 characters. */
  opening: 'too-long' | null;
  /** By item key; only items with a problem. */
  items: Record<string, { target?: ItemProblem; requirement?: ItemProblem; text?: ItemProblem }>;
  any: boolean;
}

/**
 * What stops saving or issuing. Issuing needs at least one item, and every item needs what it is
 * about, a requirement and its text (up to 1,000 characters). A draft may have no items; blank
 * ones are left out of it, the started ones need the same as for issuing.
 */
export function composerProblems(state: ComposerState, intent: 'save' | 'issue'): ComposerProblems {
  const items: ComposerProblems['items'] = {};
  const checked = intent === 'save' ? state.items.filter((item) => !isBlank(item)) : state.items;
  for (const item of checked) {
    const problems: ComposerProblems['items'][string] = {};
    if (!item.target) problems.target = 'required';
    if (!item.requirement) problems.requirement = 'required';
    if (!item.text.trim()) problems.text = 'required';
    else if (item.text.length > ITEM_TEXT_MAX) problems.text = 'too-long';
    if (Object.keys(problems).length > 0) items[item.key] = problems;
  }
  const none = intent === 'issue' && state.items.length === 0;
  const opening = (state.opening?.text.trim().length ?? 0) > OPENING_TEXT_MAX ? 'too-long' : null;
  return { none, opening, items, any: none || opening !== null || Object.keys(items).length > 0 };
}

/**
 * review.yaml `ClarificationInput`, blank items left out and a blank opening paragraph as none.
 * Check `composerProblems` first.
 */
export function composerToInput(state: ComposerState): {
  items: (TargetRef & { requirement: Requirement; text: string; aiJobId: string | null })[];
  opening: string | null;
  openingAiJobId: string | null;
  language: DraftLanguage;
} {
  const opening = state.opening?.text.trim() ? state.opening : null;
  return {
    opening: opening ? opening.text.trim() : null,
    openingAiJobId: opening?.aiJobId ?? null,
    language: state.language,
    items: state.items.flatMap((item) =>
      isBlank(item) || !item.requirement
        ? []
        : [
            {
              sectionKey: item.target?.ref.sectionKey ?? null,
              personKey: item.target?.ref.personKey ?? null,
              itemId: item.target?.ref.itemId ?? null,
              requirement: item.requirement,
              text: item.text.trim(),
              aiJobId: item.aiJobId,
            },
          ],
    ),
  };
}
