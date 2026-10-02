import { type DeclarationV1, sectionContents } from '@adili/forms';
import { z } from 'zod';

import type {
  DraftClarificationInput,
  DraftClarificationOutput,
  FlagInput,
  SourceRef,
} from '../ai-gateway/ai-gateway-client.js';
import { REQUIREMENTS, type reviewFlags } from '../cases/schema.js';
import { letterLanguageSchema, requirementSchema } from '../clarifications/representation.js';
import { type PlacedItem, placedItems, statementSectionKey } from '../rules/match.js';
import { flagInput, itemRef, placedItemContext } from './copilot-inputs.js';

/** The most items the gateway drafts in one call (ai-gateway.yaml `DraftClarificationInput`). */
export const MAX_DRAFT_SELECTIONS = 50;

/** review.yaml `CopilotDraftInput`. */
export const copilotDraftInput = z.object({
  flagIds: z.array(z.uuid()).max(MAX_DRAFT_SELECTIONS),
  itemRefs: z
    .array(
      z.object({
        personKey: z.string().max(80).nullable(),
        itemId: z.uuid().nullable(),
        sectionKey: z.string().max(100).nullable(),
        requirement: requirementSchema.nullable(),
      }),
    )
    .max(MAX_DRAFT_SELECTIONS),
  language: letterLanguageSchema,
});
export type CopilotDraftInput = z.infer<typeof copilotDraftInput>;

/** review.yaml `ClarificationItemInput`, as a draft proposes it. */
export interface DraftItem {
  sectionKey: string | null;
  personKey: string | null;
  itemId: string | null;
  requirement: (typeof REQUIREMENTS)[number];
  text: string;
}

/** A selection that is not on the case: a flag it does not have, an item its version lacks. */
export class InvalidDraftSelection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDraftSelection';
  }
}

type FlagRow = typeof reviewFlags.$inferSelect;
type Selection = DraftClarificationInput['selections'][number];

export interface DraftSources {
  /** The case's current version: every selected item must be in it. */
  document: DeclarationV1;
  /** The case's flags: every selected flag must be one. */
  flags: FlagRow[];
  selection: CopilotDraftInput;
  commissionName: string;
}

/**
 * The `draft-clarification` input for a reviewer's selection (spec 07c S12): one selection per
 * selected item (with the selected flag that concerns it, if any, and the reviewer's
 * requirement), then one per item of each selected flag no selected item covers. Each carries the
 * item's context from the case's version. Throws `InvalidDraftSelection` for a flag the case does
 * not have, an item or section its version lacks, no selection at all, or more than the gateway
 * drafts at once.
 */
export function draftClarificationInput({
  document,
  flags,
  selection,
  commissionName,
}: DraftSources): DraftClarificationInput {
  const byId = new Map(flags.map((flag) => [flag.id, flag]));
  const selectedFlags = [...new Set(selection.flagIds)].map((id) => {
    const flag = byId.get(id);
    if (!flag) throw new InvalidDraftSelection(`Flag ${id} is not a flag of this case.`);
    return flag;
  });

  const items = new Map(placedItems(document).map((placed) => [placed.item.id, placed]));
  const sections = new Set<string>(sectionContents(document).map(([key]) => key));
  const persons = new Set(document.statements.map((statement) => statement.personKey));
  const selections: Selection[] = [];
  const seen = new Set<string>();
  const add = (s: Selection) => {
    const key = refKey(s.ref);
    if (seen.has(key)) return;
    seen.add(key);
    selections.push(s);
  };

  const covered = new Set<string>();
  for (const ref of selection.itemRefs) {
    const resolved = resolveRef(ref, items, sections, persons);
    const flag = selectedFlags.find((candidate) =>
      candidate.itemRefs.some((flagRef) => concerns(resolveFlagRef(flagRef), resolved.ref)),
    );
    if (flag) covered.add(flag.id);
    add({
      ref: resolved.ref,
      flag: flag ? flagInput(flag) : null,
      itemContext: resolved.context,
      requirement: ref.requirement,
    });
  }
  for (const flag of selectedFlags) {
    if (covered.has(flag.id)) continue;
    const input: FlagInput = flagInput(flag);
    const refs = flag.itemRefs.length > 0 ? flag.itemRefs.map(resolveFlagRef) : [NO_REF];
    for (const ref of refs) {
      const placed = ref.itemId === null ? undefined : items.get(ref.itemId);
      add({
        // An item the version no longer holds (disposed of) is drafted at its statement.
        ref: placed ? itemRef(placed) : { ...ref, itemId: null },
        flag: input,
        itemContext: placed ? placedItemContext(placed, 'current') : sectionContext(ref),
        requirement: null,
      });
    }
  }

  if (selections.length === 0) {
    throw new InvalidDraftSelection('Select at least one flag or item to draft.');
  }
  if (selections.length > MAX_DRAFT_SELECTIONS) {
    throw new InvalidDraftSelection(
      `At most ${String(MAX_DRAFT_SELECTIONS)} items can be drafted at once.`,
    );
  }
  return { kind: 'draft-clarification', commissionName, language: selection.language, selections };
}

/** The validated task output (ai-gateway.yaml `DraftClarificationOutput`). */
const draftOutput = z.object({
  label: z.record(z.string(), z.unknown()),
  opening: z.string().nullable(),
  items: z.array(
    z.object({
      ref: z.object({
        sectionKey: z.string().nullable(),
        personKey: z.string().nullable(),
        itemId: z.string().nullable(),
      }),
      requirement: z.enum(REQUIREMENTS),
      text: z.string().min(1).max(1000),
    }),
  ),
});

/** What a succeeded draft job gives the reviewer. */
export interface DraftContent {
  label: DraftClarificationOutput['label'];
  opening: string | null;
  items: DraftItem[];
}

/** What a succeeded draft job gives the reviewer; null when its output breaks the contract. */
export function draftOfOutput(output: Record<string, unknown> | null): DraftContent | null {
  const parsed = draftOutput.safeParse(output);
  if (!parsed.success) return null;
  return {
    label: parsed.data.label as DraftClarificationOutput['label'],
    opening: parsed.data.opening,
    items: parsed.data.items.map(({ ref, requirement, text }) => ({
      sectionKey: ref.sectionKey,
      personKey: ref.personKey,
      itemId: ref.itemId,
      requirement,
      text,
    })),
  };
}

const NO_REF: SourceRef = { sectionKey: null, personKey: null, itemId: null, fieldPath: null };

function resolveRef(
  ref: CopilotDraftInput['itemRefs'][number],
  items: Map<string, PlacedItem>,
  sections: Set<string>,
  persons: Set<string>,
): { ref: SourceRef; context: Record<string, unknown> } {
  if (ref.itemId !== null) {
    const placed = items.get(ref.itemId);
    if (
      !placed ||
      (ref.personKey !== null && ref.personKey !== placed.personKey) ||
      (ref.sectionKey !== null && ref.sectionKey !== statementSectionKey(placed.personKey))
    ) {
      throw new InvalidDraftSelection(`Item ${ref.itemId} is not in this case's declaration.`);
    }
    return { ref: itemRef(placed), context: placedItemContext(placed, 'current') };
  }
  const sectionKey =
    ref.sectionKey ?? (ref.personKey === null ? null : statementSectionKey(ref.personKey));
  const statementOf = sectionKey?.startsWith('statement:') ? sectionKey.slice(10) : null;
  if (
    sectionKey === null ||
    !sections.has(sectionKey) ||
    (ref.personKey !== null && !persons.has(ref.personKey)) ||
    (ref.personKey !== null && statementOf !== null && statementOf !== ref.personKey)
  ) {
    throw new InvalidDraftSelection(
      `Section ${String(ref.sectionKey ?? ref.personKey)} is not in this case's declaration.`,
    );
  }
  const resolved: SourceRef = {
    sectionKey,
    personKey: ref.personKey ?? statementOf,
    itemId: null,
    fieldPath: null,
  };
  return { ref: resolved, context: sectionContext(resolved) };
}

function resolveFlagRef(ref: FlagRow['itemRefs'][number]): SourceRef {
  return {
    sectionKey: ref.sectionKey ?? statementSectionKey(ref.personKey),
    personKey: ref.personKey,
    itemId: ref.itemId,
    fieldPath: null,
  };
}

function sectionContext(ref: SourceRef): Record<string, unknown> {
  return { section: ref.sectionKey, personKey: ref.personKey };
}

/** Whether a flag's ref is about the selected one: the same item, or the same section. */
function concerns(flagRef: SourceRef, selected: SourceRef): boolean {
  if (selected.itemId !== null) return flagRef.itemId === selected.itemId;
  return refKey(flagRef) === refKey(selected);
}

function refKey(ref: SourceRef): string {
  return JSON.stringify([ref.sectionKey, ref.personKey, ref.itemId]);
}
