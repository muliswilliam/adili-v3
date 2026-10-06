import {
  Button,
  ConsentDialog,
  formatDate,
  SuggestionCard,
  type SuggestionField,
  useToast,
} from '@adili/ui';
import { useEffect, useState } from 'react';

import {
  bioHolds,
  birthOf,
  birthSuggestion,
  birthTitle,
  type IprsBirth,
  latestIprsSet,
} from '../../declaration/iprs-birth';
import { PERSON_FIELD_LABELS } from '../../declaration/field-labels';
import { withSuggestion } from '../../declaration/suggestions';
import {
  dismissDeclarationSuggestion,
  listDeclarationSuggestions,
  requestRegistryLookups,
} from '../../server/declarations';
import type { LoadedSection, LoadedSuggestionSet } from '../../server/declarations.server';
import { REGISTRY_POLL_LIMIT, REGISTRY_POLL_MS } from './registries-panel';
import { useAcceptSuggestion } from './suggestion-accept';
import { usePoll } from './use-poll';
import { useWorkspace } from './workspace';

export const IPRS_BIRTH_COPY = {
  check: 'Check IPRS',
  checkAgain: 'Check IPRS again',
  lead: 'Fill your date and place of birth from the civil register (IPRS).',
  consentTitle: 'Check IPRS',
  consentBody: (name: string) =>
    `Adili will ask IPRS for the date and place of birth it holds for ${name} and show them to you only. Nothing is added unless you accept it.`,
  checking: 'Checking IPRS…',
  unavailable: 'IPRS is not available now. Enter your details yourself, or try again later.',
  notFound: 'IPRS has no record to suggest. Enter your details yourself.',
  use: 'Use these',
  matches: 'Your details already say this.',
  used: 'Filled from IPRS',
  startFailed: 'Could not ask IPRS. Try again.',
  acceptFailed: 'Could not fill your details from IPRS. Try again.',
} as const;

/**
 * Names the IPRS consent text above (`consentTitle` and `consentBody`) in the recorded consent, so
 * the record says which words the declarant agreed to (spec 05b). Bump it whenever that copy
 * changes.
 */
export const IPRS_BIRTH_CONSENT_VERSION = 'iprs-birth-consent.v1';

/** The one registry this check asks. */
const IPRS_ONLY = ['iprs'] as const;

export interface IprsBirthCheckProps {
  /** The declarant's name, for the consent text. */
  name: string;
  /** Date and place of birth as the bio holds them now. */
  current: IprsBirth;
  /** The bio as read back after IPRS's birth was accepted into it. */
  onAccepted: (section: LoadedSection) => void;
  disabled?: boolean;
  pollMs?: number;
  pollLimit?: number;
}

/**
 * Story 2 (#612): the declarant can ask IPRS, with their consent recorded (spec 05b), for the
 * date and place of birth it holds for them, and fill their bio from it with one tap. The check
 * runs like a statement's registry check (asked, polled, answered as a suggestion); nothing
 * reaches the bio unless they use it.
 */
export function IprsBirthCheck({
  name,
  current,
  onAccepted,
  disabled = false,
  pollMs = REGISTRY_POLL_MS,
  pollLimit = REGISTRY_POLL_LIMIT,
}: IprsBirthCheckProps) {
  const { declaration } = useWorkspace();
  const declarationId = declaration.id;
  const { toast } = useToast();
  const accept = useAcceptSuggestion();
  const [sets, setSets] = useState<LoadedSuggestionSet[]>([]);
  const [consenting, setConsenting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState<'saving' | 'refreshing' | undefined>();
  const [round, setRound] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  const latest = latestIprsSet(sets);
  const pending = latest?.status === 'pending' && !gaveUp;
  const suggestion = birthSuggestion(latest);

  async function read() {
    const result = await listDeclarationSuggestions({
      data: { declarationId, personKey: 'officer' },
    });
    return result.status === 'ok' ? result.sets.filter((set) => set.source === 'iprs') : null;
  }

  useEffect(() => {
    let left = false;
    void read()
      .then((found) => {
        if (!left && found) setSets(found);
      })
      .catch(() => {
        // Nothing checked yet as far as the screen knows; the declarant can ask.
      });
    return () => {
      left = true;
    };
    // Read once, when the bio opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declarationId]);

  usePoll({
    pollKey: pending ? round : null,
    read,
    onRead: (found) => {
      if (!found) return false;
      setSets(found);
      return latestIprsSet(found)?.status !== 'pending';
    },
    onGiveUp: () => {
      setGaveUp(true);
    },
    intervalMs: pollMs,
    limit: pollLimit,
  });

  async function start() {
    setStarting(true);
    try {
      const result = await requestRegistryLookups({
        data: {
          declarationId,
          personKey: 'officer',
          systems: [...IPRS_ONLY],
          textVersion: IPRS_BIRTH_CONSENT_VERSION,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (result.status === 'started') {
        setGaveUp(false);
        setSets((before) => [...before, ...result.sets]);
        setRound((value) => value + 1);
      } else {
        toast({ title: IPRS_BIRTH_COPY.startFailed });
      }
    } catch {
      toast({ title: IPRS_BIRTH_COPY.startFailed });
    } finally {
      setStarting(false);
    }
  }

  async function use() {
    if (!suggestion) return;
    setBusy('saving');
    const result = await accept(
      suggestion,
      // The declarant chose IPRS's values: they replace what the bio says, not only fill blanks.
      { fields: suggestion.fields, applyToItemId: null, overwrite: true },
      () => {
        setBusy('refreshing');
      },
    );
    setBusy(undefined);
    if (result.status === 'accepted') {
      setSets((before) => withSuggestion(before, result.suggestion));
      if (result.section) onAccepted(result.section);
    } else {
      toast({ title: IPRS_BIRTH_COPY.acceptFailed });
    }
  }

  async function dismiss() {
    if (!suggestion) return;
    try {
      const result = await dismissDeclarationSuggestion({
        data: { declarationId, suggestionId: suggestion.id },
      });
      if (result.status === 'dismissed')
        setSets((before) => withSuggestion(before, result.suggestion));
    } catch {
      // The card stays; the declarant can dismiss again.
    }
  }

  function body() {
    if (pending) return <p className="text-sm text-muted-foreground">{IPRS_BIRTH_COPY.checking}</p>;
    if (!latest) return null;
    if (latest.status !== 'ready' || gaveUp) {
      return <p className="text-sm text-muted-foreground">{IPRS_BIRTH_COPY.unavailable}</p>;
    }
    if (!suggestion)
      return <p className="text-sm text-muted-foreground">{IPRS_BIRTH_COPY.notFound}</p>;
    const birth = birthOf(suggestion);
    const fields: SuggestionField[] = [
      ...(birth.date
        ? [{ key: 'date', label: PERSON_FIELD_LABELS.dateOfBirth, value: formatDate(birth.date) }]
        : []),
      ...(birth.place ? [{ key: 'place', label: 'Place of birth', value: birth.place }] : []),
    ];
    const held = suggestion.status === 'new' && bioHolds(current, birth);
    return (
      <SuggestionCard
        title={birthTitle(birth)}
        source="iprs"
        at={latest.readyAt ?? latest.requestedAt}
        status={suggestion.status === 'superseded' ? 'dismissed' : suggestion.status}
        description={held ? IPRS_BIRTH_COPY.matches : undefined}
        fields={fields}
        busy={busy}
        disabled={disabled || busy !== undefined}
        acceptedAs="applied"
        messages={{ add: IPRS_BIRTH_COPY.use, applied: IPRS_BIRTH_COPY.used }}
        onAdd={
          held
            ? undefined
            : () => {
                void use();
              }
        }
        onDismiss={() => {
          void dismiss();
        }}
      />
    );
  }

  return (
    <div className="grid gap-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{IPRS_BIRTH_COPY.lead}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || pending || starting}
          onClick={() => {
            setConsenting(true);
          }}
        >
          {latest ? IPRS_BIRTH_COPY.checkAgain : IPRS_BIRTH_COPY.check}
        </Button>
      </div>
      {body()}
      <ConsentDialog
        open={consenting}
        onOpenChange={setConsenting}
        name={name}
        registries={IPRS_ONLY}
        busy={starting}
        messages={{
          title: IPRS_BIRTH_COPY.consentTitle,
          body: IPRS_BIRTH_COPY.consentBody,
        }}
        onContinue={() => {
          setConsenting(false);
          void start();
        }}
      />
    </div>
  );
}
