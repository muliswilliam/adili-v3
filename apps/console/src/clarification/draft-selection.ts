import type { CopilotDraftInput, Flag } from '../server/review/types';
import type { ClarificationTarget } from './targets';

/**
 * What Draft with AI drafts from (spec 07c FE-3, S12): the flags and declaration items the
 * reviewer picked, on the copilot's Flags tab ("Add to clarification") or in the composer, and
 * the language of the letter. Pure, so the copilot panel and the composer share one selection.
 */

/** What Draft with AI reads of a flag (review.yaml `Flag`). */
export type DraftFlag = Pick<Flag, 'id' | 'title' | 'severity' | 'reviewed' | 'closedReason'>;

export interface DraftSelection {
  flagIds: readonly string[];
  /** Item ids of the case's current version (targets of kind `item`). */
  itemIds: readonly string[];
}

export const NO_SELECTION: DraftSelection = { flagIds: [], itemIds: [] };

/** The letter's language: a task input, not the console's locale. */
export type DraftLanguage = CopilotDraftInput['language'];

export const DRAFT_LANGUAGES: readonly DraftLanguage[] = ['en', 'sw'];

/** The letter language when the declarant has chosen none (`CaseDetail.declarantLanguage`). */
export const DEFAULT_DRAFT_LANGUAGE: DraftLanguage = 'en';

export const selectionSize = (selection: DraftSelection): number =>
  selection.flagIds.length + selection.itemIds.length;

/** A pick in the composer's add list: `flag:{id}` or `item:{id}`. */
export type DraftPick = `flag:${string}` | `item:${string}`;

export function addPick(selection: DraftSelection, pick: DraftPick): DraftSelection {
  const [kind, id] = pick.split(/:(.*)/s) as ['flag' | 'item', string];
  const key = kind === 'flag' ? 'flagIds' : 'itemIds';
  if (selection[key].includes(id)) return selection;
  return { ...selection, [key]: [...selection[key], id] };
}

export function removePick(selection: DraftSelection, pick: DraftPick): DraftSelection {
  const [kind, id] = pick.split(/:(.*)/s) as ['flag' | 'item', string];
  const key = kind === 'flag' ? 'flagIds' : 'itemIds';
  return { ...selection, [key]: selection[key].filter((each) => each !== id) };
}

export function toggleFlag(selection: DraftSelection, flagId: string): DraftSelection {
  return selection.flagIds.includes(flagId)
    ? removePick(selection, `flag:${flagId}`)
    : addPick(selection, `flag:${flagId}`);
}

/** A flag still to act on: neither reviewed nor closed. */
const isOpen = (flag: DraftFlag) => flag.reviewed === null && flag.closedReason === null;

/** The picked flags and items, in the order picked; ids the case no longer has are left out. */
export function pickedOf(
  selection: DraftSelection,
  flags: readonly DraftFlag[],
  targets: readonly ClarificationTarget[],
): { flags: DraftFlag[]; items: ClarificationTarget[] } {
  return {
    flags: selection.flagIds.flatMap((id) => flags.find((flag) => flag.id === id) ?? []),
    items: selection.itemIds.flatMap(
      (id) => targets.find((target) => target.kind === 'item' && target.ref.itemId === id) ?? [],
    ),
  };
}

/** What can still be added: the open flags and the items not picked yet. */
export function pickable(
  selection: DraftSelection,
  flags: readonly DraftFlag[],
  targets: readonly ClarificationTarget[],
): { flags: DraftFlag[]; items: ClarificationTarget[] } {
  return {
    flags: flags.filter((flag) => isOpen(flag) && !selection.flagIds.includes(flag.id)),
    items: targets.filter(
      (target) =>
        target.kind === 'item' &&
        target.ref.itemId !== null &&
        !selection.itemIds.includes(target.ref.itemId),
    ),
  };
}

/**
 * review.yaml `CopilotDraftInput` for the selection: the flags, and each item by its refs with no
 * requirement (the draft proposes one). Picks the case no longer has are left out.
 */
export function draftInput(
  selection: DraftSelection,
  flags: readonly DraftFlag[],
  targets: readonly ClarificationTarget[],
  language: DraftLanguage,
): CopilotDraftInput {
  const picked = pickedOf(selection, flags, targets);
  return {
    flagIds: picked.flags.map((flag) => flag.id),
    itemRefs: picked.items.map(({ ref }) => ({ ...ref, requirement: null })),
    language,
  };
}
