import type { DeclarationV1 } from '@adili/forms';

import type {
  ChangeInput,
  ExplainFlagsInput,
  FlagInput,
  SourceRef,
  SummarizeDeclarationInput,
} from '../ai-gateway/ai-gateway-client.js';
import type { reviewFlags } from '../cases/schema.js';
import {
  match,
  type PlacedItem,
  placedItems,
  statementSectionKey,
  valueOf,
} from '../rules/match.js';

/** A registry check's outcome for the summary (spec 07b); none until registry matching lands. */
export interface RegistryStatus {
  system: string;
  status: string;
}

/** What the copilot's inputs are built from: data the review service already holds or pulls. */
export interface CopilotSources {
  current: DeclarationV1;
  /** The person's previous submitted version at the Commission; null for a first. */
  previous: DeclarationV1 | null;
  flags: (typeof reviewFlags.$inferSelect)[];
  registryStatuses: RegistryStatus[];
}

export interface CopilotInputs {
  summarize: SummarizeDeclarationInput;
  /** Null when the case has no flags: there is nothing to explain. */
  explain: ExplainFlagsInput | null;
}

/**
 * The inputs of `summarizeDeclaration` and `explainFlags` for a case (spec 07c): the version's
 * document, the previous one, what changed between them (the rules engine's matcher, as the
 * comparison flags and the reviewer's diff pair items), the case's flags and the registry
 * statuses. The documents go to the gateway as they are: the gateway minimises identifiers before
 * any provider call. Summaries are for the reviewer, so they are in English.
 */
export function copilotInputs({
  current,
  previous,
  flags,
  registryStatuses,
}: CopilotSources): CopilotInputs {
  const flagInputs = flags.map(flagInput);
  const summarize: SummarizeDeclarationInput = {
    kind: 'summarize-declaration',
    document: current as unknown as Record<string, unknown>,
    previousDocument: previous as unknown as Record<string, unknown> | null,
    changes: previous ? changes(previous, current) : [],
    flags: flagInputs,
    registryStatuses,
    language: 'en',
  };
  const explain: ExplainFlagsInput | null =
    flagInputs.length === 0
      ? null
      : {
          kind: 'explain-flags',
          flags: flagInputs,
          itemContext: itemContext(flagInputs, current, previous),
          language: 'en',
        };
  return { summarize, explain };
}

/** A case's flag as the gateway's tasks take it. */
export function flagInput(flag: typeof reviewFlags.$inferSelect): FlagInput {
  return {
    id: flag.id,
    ruleId: flag.ruleId,
    severity: flag.severity,
    title: flag.title,
    indicator: flag.indicator,
    evidence: flag.evidence,
    itemRefs: flag.itemRefs.map((ref) => ({ ...ref, fieldPath: null })),
  };
}

/**
 * Items acquired, disposed of or changed in value since the previous version. Unchanged items
 * are left out: the document holds them, and the list is about what changed.
 */
function changes(previous: DeclarationV1, current: DeclarationV1): ChangeInput[] {
  const { matched, onlyPrevious, onlyCurrent } = match(previous, current);
  const changed: ChangeInput[] = [];
  for (const pair of matched) {
    const before = valueOf(pair.previous);
    const after = valueOf(pair.current);
    if (before === after) continue;
    changed.push({
      kind: 'value-changed',
      personKey: pair.personKey,
      sectionKey: statementSectionKey(pair.personKey),
      itemId: pair.current.id,
      percent: before === 0 ? null : Math.round(((after - before) / before) * 100),
    });
  }
  for (const placed of onlyCurrent) changed.push(unmatched('acquired', placed));
  for (const placed of onlyPrevious) changed.push(unmatched('disposed', placed));
  return changed;
}

function unmatched(kind: 'acquired' | 'disposed', placed: PlacedItem): ChangeInput {
  return {
    kind,
    personKey: placed.personKey,
    sectionKey: statementSectionKey(placed.personKey),
    itemId: placed.item.id,
    percent: null,
  };
}

/**
 * The minimal context of every item the flags refer to: its category, type, description, value
 * and change marking, from the version (or, for an item no longer declared, the previous one).
 */
function itemContext(
  flags: FlagInput[],
  current: DeclarationV1,
  previous: DeclarationV1 | null,
): ExplainFlagsInput['itemContext'] {
  const items = new Map<string, { placed: PlacedItem; version: 'current' | 'previous' }>();
  for (const placed of previous ? placedItems(previous) : []) {
    items.set(placed.item.id, { placed, version: 'previous' });
  }
  for (const placed of placedItems(current)) {
    items.set(placed.item.id, { placed, version: 'current' });
  }

  const context: ExplainFlagsInput['itemContext'] = [];
  const seen = new Set<string>();
  for (const ref of flags.flatMap((flag) => flag.itemRefs)) {
    if (ref.itemId === null || seen.has(ref.itemId)) continue;
    const found = items.get(ref.itemId);
    if (!found) continue;
    seen.add(ref.itemId);
    const { placed, version } = found;
    context.push({ ref: itemRef(placed), context: placedItemContext(placed, version) });
  }
  return context;
}

/**
 * What a task is told of an item: its category, type, description, value and the declarant's
 * change marking (s.31(3)-(4)) with any explanation, which the flags are often about.
 */
export function placedItemContext(
  placed: PlacedItem,
  version: 'current' | 'previous',
): Record<string, unknown> {
  return {
    version,
    category: placed.category,
    type: placed.item.type,
    description: placed.item.description,
    valueKesCents: valueOf(placed.item),
    change: placed.item.change,
  };
}

/** The source ref of an item: its statement, person and id. */
export function itemRef({ personKey, item }: PlacedItem): SourceRef {
  return {
    sectionKey: statementSectionKey(personKey),
    personKey,
    itemId: item.id,
    fieldPath: null,
  };
}
