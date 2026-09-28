import {
  Badge,
  Button,
  Card,
  CardIcon,
  ConsentDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  emptyFieldDiff,
  formatDate,
  FormField,
  Icon,
  Input,
  listNames,
  maskNationalId,
  RegistryStatusList,
  SOURCE_NAMES,
  SuggestionCard,
  type SuggestionField,
  type SuggestionMatch,
  Tooltip,
  useToast,
} from '@adili/ui';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  BankIcon,
  RefreshIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useId, useRef, useState } from 'react';

import {
  dismissDeclarationSuggestion,
  listDeclarationSuggestions,
  requestRegistryLookups,
} from '../../server/declarations';
import type {
  JsonObject,
  LoadedSection,
  LoadedSuggestion,
  LoadedSuggestionSet,
} from '../../server/declarations.server';
import type { RegistrySystem } from '../../server/declarations/types';
import type { Draft, PersonKey, Statement } from '../../declaration/contents';
import { relationOfPerson } from '../../declaration/section-key';
import type { AnyItem, Item } from '../../declaration/statement';
import { type AcceptInput, useAcceptSuggestion } from './suggestion-accept';
import {
  categoryOf,
  CONSENT_TEXT_VERSION,
  editFields,
  editValue,
  isChecking,
  lastChecked,
  REGISTRIES,
  registryEntries,
  type ShownSuggestion,
  shownSuggestions,
  stopWaiting,
  suggestionKind,
  suggestionPatch,
  suggestionTitle,
  supersededBy,
  typeWord,
  valuesAt,
  withSuggestion,
} from '../../declaration/suggestions';
import { REGISTRY_COPY } from '../../declaration/copy';
import { TYPE_LABELS } from '../../declaration/labels';
import { useWorkspace } from './workspace';

/**
 * "Check registries" for one person's financial statement (#312, spec 05b S1, S2, S4, S5): the
 * consent dialog, the per-registry status strip (polled while registries answer), suggestion
 * cards grouped by registry with Add, Edit and add, Apply to this item and Dismiss, the
 * dismissed fold, and re-check. Accepting runs through `useAcceptSuggestion`.
 */

/** How often a pending check is read again, and how many times at most (about a minute). */
export const REGISTRY_POLL_MS = 1_000;
export const REGISTRY_POLL_LIMIT = 60;

export interface RegistryPerson {
  /** Full name, for the consent text and announcements. */
  name: string;
  firstName: string;
  /** Null when the portal does not know it (the officer's, contract gap 5). */
  nationalId: string | null;
  /** False for a spouse or child with no national ID in Household. */
  hasId: boolean;
  /** A spouse's KRA PIN as Household has it. */
  kraPin?: string;
}

export interface RegistriesPanelProps {
  personKey: PersonKey;
  person: RegistryPerson;
  /** The person's suggestion sets as the route loaded them. */
  initialSets: LoadedSuggestionSet[];
  /** The statement as edited on screen, to match suggestions to items. */
  statement: Draft<Statement>;
  disabled?: boolean;
  /** An item was added or filled; `section` is the statement read back after it. */
  onAccepted: (accepted: { itemId: string; section: LoadedSection | null }) => void;
  /** Go to the item (or the Household entry) an accepted suggestion added. */
  onView: (suggestion: LoadedSuggestion) => void;
  pollMs?: number;
  pollLimit?: number;
}

type Busy = Record<string, 'saving' | 'refreshing'>;

function itemsOf(statement: Draft<Statement>): Item[] {
  return [
    ...(statement.income ?? []),
    ...(statement.assets ?? []),
    ...(statement.liabilities ?? []),
  ];
}

function itemName(item: Item, itemType: string) {
  const category = categoryOf(itemType);
  const type = (item as AnyItem).type;
  const description = item.description?.trim();
  if (description) return description;
  return (category && type ? TYPE_LABELS[category][type] : undefined) ?? typeWord(itemType);
}

function previewFields(suggestion: LoadedSuggestion): SuggestionField[] {
  return suggestionPatch(suggestion)
    .filter((entry) => entry.path !== 'description' && entry.path !== 'location.detail')
    .map((entry) => ({ key: entry.path, label: entry.label, value: entry.display }));
}

export function RegistriesPanel({
  personKey,
  person,
  initialSets,
  statement,
  disabled = false,
  onAccepted,
  onView,
  pollMs = REGISTRY_POLL_MS,
  pollLimit = REGISTRY_POLL_LIMIT,
}: RegistriesPanelProps) {
  const { declaration } = useWorkspace();
  const { toast } = useToast();
  const accept = useAcceptSuggestion();
  const headingId = useId();
  const noIdTipId = useId();
  const declarationId = declaration.id;
  const isOfficer = relationOfPerson(personKey) === 'officer';

  const [sets, setSets] = useState(initialSets);
  // The registries the consent dialog is open for: every one, or one to retry. Null when closed.
  const [consentFor, setConsentFor] = useState<readonly RegistrySystem[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [refusedNoId, setRefusedNoId] = useState(false);
  const [busy, setBusy] = useState<Busy>({});
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<ShownSuggestion | null>(null);
  const [open, setOpen] = useState(true);
  const [foldOpen, setFoldOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const checking = isChecking(sets);
  const shown = shownSuggestions(sets);
  const checkedAt = lastChecked(sets);
  const everChecked = checkedAt !== null;
  const noId = !person.hasId || refusedNoId;
  const live = shown.filter((each) => each.suggestion.status !== 'dismissed');
  const dismissed = shown.filter((each) => each.suggestion.status === 'dismissed');
  const toReview = shown.filter((each) => each.suggestion.status === 'new').length;
  const items = itemsOf(statement);

  // While a registry has not answered, read the person's sets again. After about a minute, stop
  // waiting: the registries still pending show as not available now, with Retry.
  const polls = useRef(0);
  const stopped = useRef(false);
  useEffect(() => {
    if (!checking) {
      polls.current = 0;
      return;
    }
    const timer = setTimeout(() => {
      if (polls.current >= pollLimit) {
        stopped.current = true;
        setSets(stopWaiting);
        return;
      }
      polls.current += 1;
      // Always a new array, so the next read is scheduled even when nothing changed.
      void listDeclarationSuggestions({ data: { declarationId, personKey } })
        .then((result) => {
          setSets((current) => [...(result.status === 'ok' ? result.sets : current)]);
        })
        .catch(() => {
          setSets((current) => [...current]);
        });
    }, pollMs);
    return () => {
      clearTimeout(timer);
    };
  }, [checking, sets, declarationId, personKey, pollMs, pollLimit]);

  // Say when the last registry has answered, or when the panel stopped waiting for them.
  const wasChecking = useRef(checking);
  useEffect(() => {
    if (wasChecking.current && !checking) {
      setAnnouncement(
        stopped.current
          ? REGISTRY_COPY.stoppedWaiting(person.name)
          : REGISTRY_COPY.finished(person.name),
      );
      stopped.current = false;
    }
    wasChecking.current = checking;
  }, [checking, person.name]);

  async function start(systems: readonly RegistrySystem[]) {
    setStarting(true);
    try {
      const result = await requestRegistryLookups({
        data: {
          declarationId,
          personKey,
          systems: [...systems],
          textVersion: CONSENT_TEXT_VERSION,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (result.status === 'started') {
        setOpen(true);
        setAnnouncement('');
        setSets((current) => [...supersededBy(current, personKey, systems), ...result.sets]);
      } else if (result.status === 'no-id') {
        setRefusedNoId(true);
      } else {
        toast({ title: REGISTRY_COPY.startFailed });
      }
    } catch {
      toast({ title: REGISTRY_COPY.startFailed });
    } finally {
      setStarting(false);
    }
  }

  async function reread() {
    try {
      const result = await listDeclarationSuggestions({ data: { declarationId, personKey } });
      if (result.status === 'ok') setSets(result.sets);
    } catch {
      // Keep what is shown; the next check reads them again.
    }
  }

  async function run(
    shownSuggestion: ShownSuggestion,
    input: AcceptInput,
    words: { done: string; refreshed: string; applied: boolean },
  ) {
    const { suggestion } = shownSuggestion;
    setBusy((current) => ({ ...current, [suggestion.id]: 'saving' }));
    const result = await accept(suggestion, input, () => {
      setBusy((current) => ({ ...current, [suggestion.id]: 'refreshing' }));
    });
    setBusy((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => id !== suggestion.id)),
    );
    if (result.status === 'accepted') {
      setSets((current) => withSuggestion(current, result.suggestion));
      if (words.applied) setApplied((current) => new Set([...current, suggestion.id]));
      onAccepted({ itemId: result.itemId, section: result.section });
      toast({ title: result.retried ? words.refreshed : words.done });
    } else {
      toast({ title: REGISTRY_COPY.acceptFailed });
      await reread();
    }
  }

  async function dismiss({ suggestion }: ShownSuggestion) {
    const title = suggestionTitle(suggestion);
    try {
      const result = await dismissDeclarationSuggestion({
        data: { declarationId, suggestionId: suggestion.id },
      });
      if (result.status === 'dismissed') {
        setSets((current) => withSuggestion(current, result.suggestion));
        setAnnouncement(REGISTRY_COPY.dismissedAnnounce(title));
        return;
      }
      if (result.status === 'already-accepted') {
        await reread();
        return;
      }
    } catch {
      // Falls through to the message.
    }
    toast({ title: REGISTRY_COPY.dismissFailed });
  }

  function card(each: ShownSuggestion) {
    const { suggestion, source, at } = each;
    const title = suggestionTitle(suggestion);
    const status = suggestion.status === 'superseded' ? 'dismissed' : suggestion.status;
    const common = {
      title,
      source,
      at,
      status,
      busy: busy[suggestion.id],
      disabled: disabled || busy[suggestion.id] !== undefined,
      onDismiss: () => {
        void dismiss(each);
      },
      onView: () => {
        onView(suggestion);
      },
    } as const;
    const fields = previewFields(suggestion);

    if (suggestionKind(suggestion.itemType).target === 'tax') {
      const acceptedAs = 'applied' as const;
      if (isOfficer) {
        // declaration.v1 has no KRA fields for the officer (contract gap 6): shown, not applied.
        return (
          <SuggestionCard
            key={suggestion.id}
            {...common}
            acceptedAs={acceptedAs}
            description={REGISTRY_COPY.officerTax}
          />
        );
      }
      const pin = person.kraPin?.trim();
      const match: SuggestionMatch | undefined = pin
        ? {
            title: REGISTRY_COPY.theirKraPin(person.firstName),
            fills: emptyFieldDiff(fields, { kraPin: pin }),
          }
        : undefined;
      return (
        <SuggestionCard
          key={suggestion.id}
          {...common}
          acceptedAs={acceptedAs}
          description={match ? undefined : REGISTRY_COPY.spouseTax(person.firstName)}
          fields={fields}
          match={match}
          // The spouse's KRA PIN is already there: applying would change nothing, and there is
          // no item to mark with the source, so there is no Apply.
          messages={{ add: REGISTRY_COPY.apply, nothingToFill: () => REGISTRY_COPY.pinOnFile }}
          onAdd={
            match
              ? undefined
              : () => {
                  void run(
                    each,
                    { fields: suggestion.fields, applyToItemId: null },
                    {
                      done: REGISTRY_COPY.applied,
                      refreshed: REGISTRY_COPY.refreshedApplied,
                      applied: true,
                    },
                  );
                }
          }
        />
      );
    }

    if (categoryOf(suggestion.itemType) === null) {
      return <SuggestionCard key={suggestion.id} {...common} fields={fields} />;
    }

    // Add and Edit and add are offered on every item card: the main actions when nothing
    // matches, secondary ones beside "Apply to this item" when something does (#312).
    const addActions = {
      onAdd: () => {
        void run(
          each,
          { fields: suggestion.fields, applyToItemId: null },
          { done: REGISTRY_COPY.added, refreshed: REGISTRY_COPY.refreshedAdded, applied: false },
        );
      },
      onEditAndAdd: () => {
        setEditing(each);
      },
    };
    const matchId = suggestion.matchItemId;
    const matched = matchId ? items.find((item) => item.id === matchId) : undefined;
    const acceptedAs =
      applied.has(suggestion.id) ||
      (suggestion.matchItemId !== null && suggestion.matchItemId === suggestion.acceptedItemId)
        ? 'applied'
        : 'added';

    if (matched && matchId) {
      const patch = suggestionPatch(suggestion);
      const fills = emptyFieldDiff(
        patch.map((entry) => ({ key: entry.path, label: entry.label, value: entry.display })),
        valuesAt(matched, patch),
      );
      return (
        <SuggestionCard
          key={suggestion.id}
          {...common}
          acceptedAs={acceptedAs}
          match={{ title: itemName(matched, suggestion.itemType), fills }}
          {...addActions}
          onApply={() => {
            void run(
              each,
              { fields: suggestion.fields, applyToItemId: matchId },
              {
                done: REGISTRY_COPY.applied,
                refreshed: REGISTRY_COPY.refreshedApplied,
                applied: true,
              },
            );
          }}
        />
      );
    }

    return (
      <SuggestionCard
        key={suggestion.id}
        {...common}
        acceptedAs={acceptedAs}
        description={REGISTRY_COPY.addValue(typeWord(suggestion.itemType))}
        fields={fields}
        {...addActions}
      />
    );
  }

  const checkLabel = everChecked ? REGISTRY_COPY.checkAgain : REGISTRY_COPY.check;
  const checkIcon = everChecked ? RefreshIcon : Search01Icon;
  const checkButton = noId ? (
    <Tooltip content={isOfficer ? REGISTRY_COPY.noOwnId : REGISTRY_COPY.noId(person.firstName)}>
      <span tabIndex={0} aria-describedby={noIdTipId} className="rounded-md">
        <Button type="button" variant="secondary" size="sm" disabled>
          <Icon icon={checkIcon} />
          {checkLabel}
        </Button>
        <span id={noIdTipId} className="sr-only">
          {isOfficer ? REGISTRY_COPY.noOwnId : REGISTRY_COPY.noId(person.firstName)}
        </span>
      </span>
    </Tooltip>
  ) : (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled || checking || starting}
      onClick={() => {
        setConsentFor(REGISTRIES);
      }}
    >
      <Icon icon={checkIcon} />
      {checkLabel}
    </Button>
  );

  const sub = checking
    ? REGISTRY_COPY.checking
    : checkedAt
      ? REGISTRY_COPY.checked(checkedAt)
      : listNames(REGISTRIES.map((source) => SOURCE_NAMES[source]));

  return (
    <section aria-labelledby={headingId}>
      <Card className="gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <CardIcon className="mb-0 shrink-0">
            <Icon icon={BankIcon} />
          </CardIcon>
          <div className="min-w-0 flex-1">
            <h2
              id={headingId}
              className="flex flex-wrap items-center gap-2 text-base font-semibold"
            >
              {REGISTRY_COPY.heading}
              {toReview > 0 ? (
                <Badge variant="info">{REGISTRY_COPY.toReview(toReview)}</Badge>
              ) : null}
            </h2>
            <p className="text-sm text-muted-foreground">{sub}</p>
          </div>
          {checkButton}
          {everChecked ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={open}
              aria-label={open ? REGISTRY_COPY.hide : REGISTRY_COPY.show}
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} />
            </Button>
          ) : null}
        </div>

        {everChecked && open ? (
          <>
            <RegistryStatusList
              registries={registryEntries(sets)}
              disabled={disabled || starting}
              onRetry={(id) => {
                // A retry asks the registry again, so it needs the declarant's request again.
                const source = REGISTRIES.find((registry) => registry === id);
                if (source) setConsentFor([source]);
              }}
            />
            {REGISTRIES.map((source) => {
              const group = live.filter((each) => each.source === source);
              if (group.length === 0) return null;
              return (
                <div
                  key={source}
                  role="group"
                  aria-label={`From ${SOURCE_NAMES[source]}`}
                  className="grid gap-2"
                >
                  {group.map(card)}
                </div>
              );
            })}
            {dismissed.length > 0 ? (
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  aria-expanded={foldOpen}
                  onClick={() => {
                    setFoldOpen((current) => !current);
                  }}
                >
                  <Icon icon={foldOpen ? ArrowDown01Icon : ArrowRight01Icon} />
                  {REGISTRY_COPY.dismissedFold(dismissed.length)}
                </Button>
                {foldOpen ? <div className="grid gap-2">{dismissed.map(card)}</div> : null}
              </div>
            ) : null}
          </>
        ) : null}

        <p role="status" className="sr-only">
          {announcement}
        </p>

        <ConsentDialog
          open={consentFor !== null}
          onOpenChange={(next) => {
            if (!next) setConsentFor(null);
          }}
          name={person.name}
          maskedId={person.nationalId ? maskNationalId(person.nationalId) : undefined}
          registries={(consentFor ?? REGISTRIES).map((source) => SOURCE_NAMES[source])}
          busy={starting}
          onContinue={() => {
            const systems = consentFor ?? REGISTRIES;
            setConsentFor(null);
            void start(systems);
          }}
        />
        <EditAndAddDialog
          editing={editing}
          onClose={() => {
            setEditing(null);
          }}
          onAdd={(each, fields) => {
            setEditing(null);
            void run(
              each,
              { fields, applyToItemId: null },
              {
                done: REGISTRY_COPY.addedEdited,
                refreshed: REGISTRY_COPY.refreshedAdded,
                applied: false,
              },
            );
          }}
        />
      </Card>
    </section>
  );
}

function EditAndAddDialog({
  editing,
  onClose,
  onAdd,
}: {
  editing: ShownSuggestion | null;
  onClose: () => void;
  onAdd: (each: ShownSuggestion, fields: JsonObject) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState(editing);
  if (seen !== editing) {
    setSeen(editing);
    setValues(
      editing
        ? Object.fromEntries(
            editFields(editing.suggestion.itemType).map(({ key }) => [
              key,
              editValue(editing.suggestion, key),
            ]),
          )
        : {},
    );
  }
  const suggestion = editing?.suggestion;

  return (
    <Dialog
      open={editing !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{REGISTRY_COPY.editTitle}</DialogTitle>
          <DialogDescription>
            {editing
              ? REGISTRY_COPY.editSource(SOURCE_NAMES[editing.source], formatDate(editing.at))
              : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          {suggestion
            ? editFields(suggestion.itemType).map(({ key, label }) => (
                <FormField
                  key={key}
                  label={label}
                  className={key === 'description' ? 'sm:col-span-2' : undefined}
                >
                  <Input
                    maxLength={200}
                    value={values[key] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setValues((current) => ({ ...current, [key]: value }));
                    }}
                  />
                </FormField>
              ))
            : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {REGISTRY_COPY.cancel}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!editing) return;
              const edited = Object.fromEntries(
                Object.entries(values).map(([key, value]) => [key, value.trim()]),
              );
              onAdd(editing, { ...editing.suggestion.fields, ...edited });
            }}
          >
            {REGISTRY_COPY.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
