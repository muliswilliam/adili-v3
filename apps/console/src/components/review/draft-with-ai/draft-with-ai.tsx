import {
  Button,
  cn,
  focusRing,
  Icon,
  Select,
  SelectGroup,
  SelectItem,
  Spinner,
  Tooltip,
  useToast,
} from '@adili/ui';
import {
  Building03Icon,
  Cancel01Icon,
  CreditCardIcon,
  Money03Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import {
  addPick,
  DEFAULT_DRAFT_LANGUAGE,
  DRAFT_LANGUAGES,
  type DraftLanguage,
  type DraftFlag,
  type DraftPick,
  type DraftSelection,
  draftInput,
  NO_SELECTION,
  pickable,
  pickedOf,
  removePick,
} from '../../../clarification/draft-selection';
import type { ItemCategory } from '../../../clarification/targets';
import { draftClarificationWithAi, getCopilotDraft } from '../../../server/copilot';
import type { AiDraft } from '../../../server/copilot-drafts.server';
import type { CopilotDraftInput } from '../../../server/review/types';
import type { ServiceError, ServiceResult } from '../../../server/service-call';
import type { ComposerApi } from '../composer/clarification-composer';
import { SeverityBadge } from '../copilot/severity-badge';
import { POLL_STOP_AFTER_MS, pollDelay } from '../copilot/use-case-copilot';
import { messages as t } from './messages';

/** The server functions Draft with AI calls; tests pass fakes. */
export interface DraftServer {
  request: (
    input: CopilotDraftInput & { caseId: string; key: string },
  ) => Promise<ServiceResult<AiDraft>>;
  poll: (draftId: string) => Promise<ServiceResult<AiDraft>>;
}

export const draftServer: DraftServer = {
  request: (data) => draftClarificationWithAi({ data }),
  poll: (draftId) => getCopilotDraft({ data: { draftId } }),
};

export interface DraftWithAiProps {
  /** The composer it drafts into (its `tools` slot). */
  api: ComposerApi;
  caseId: string;
  /** The case's flags (`CaseDetail.flags`). */
  flags: readonly DraftFlag[];
  selection: DraftSelection;
  onSelectionChange: (selection: DraftSelection) => void;
  /** False when AI assistance is not enabled for the Commission: the button is disabled. */
  enabled: boolean;
  /** The review service said AI is not enabled (409 `ai-not-enabled`). */
  onNotEnabled: () => void;
  server?: DraftServer;
}

type Phase = 'idle' | 'busy' | 'pending';

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The toast for a request or poll that gave no draft. */
function errorText(error: ServiceError): string {
  if (error.kind === 'unauthenticated') return t.sessionEnded;
  if (error.kind === 'problem') {
    const { problem } = error;
    if (problem.status === 403) return t.notAssignee;
    if (problem.type === 'ai-not-enabled') return t.notEnabled;
    if (problem.type === 'selection-not-on-case') return t.failed(reasonText(problem.type));
    if (problem.status === 404) return t.failed(reasonText('missing'));
  }
  return t.failed(reasonText('provider-unavailable'));
}

const reasonText = (reason: string) => t.reasons[reason] ?? t.unknownReason;

/**
 * Asks for the draft and, while it is pending, polls it: after 2, 3, 5, 8 and 13 seconds, then
 * every 15, for up to two minutes (`timeout` after). A poll the review service did not answer is
 * tried again on the same schedule. Null once `wanted` turns false (the composer closed).
 */
async function fetchDraft(
  server: DraftServer,
  request: Parameters<DraftServer['request']>[0],
  wanted: () => boolean,
  onPending: () => void,
): Promise<ServiceResult<AiDraft> | 'timeout' | null> {
  let result = await server.request(request);
  const started = Date.now();
  let attempt = 0;
  let pendingId = result.ok && result.data.status === 'pending' ? result.data.id : null;
  while (pendingId !== null) {
    if (!wanted()) return null;
    onPending();
    if (Date.now() - started >= POLL_STOP_AFTER_MS) return 'timeout';
    await wait(pollDelay(attempt));
    attempt += 1;
    if (!wanted()) return null;
    const polled = await server.poll(pendingId);
    if (!polled.ok && polled.error.kind === 'unavailable') continue;
    result = polled;
    if (!polled.ok || polled.data.status !== 'pending') pendingId = null;
  }
  return wanted() ? result : null;
}

/**
 * Draft with AI in the clarification composer (spec 07c FE-3, S12): the picked flags and items
 * as chips, a list to add more, the letter's language and the button. The review service waits
 * up to 10 s for the draft; a slower one is polled (2, 3, 5, 8, 13, then every 15 s, for up to
 * two minutes). A ready draft's items and opening paragraph go into the composer as ordinary
 * items, labelled until edited, and the picks are cleared; nothing is saved or issued here.
 */
export function DraftWithAi({
  api,
  caseId,
  flags,
  selection,
  onSelectionChange,
  enabled,
  onNotEnabled,
  server = draftServer,
}: DraftWithAiProps) {
  const id = useId();
  const { toast } = useToast();
  const [language, setLanguage] = useState<DraftLanguage>(DEFAULT_DRAFT_LANGUAGE);
  const [phase, setPhase] = useState<Phase>('idle');
  // The composer closed (this unmounted) while drafting: drop the answer.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const picked = pickedOf(selection, flags, api.targets);
  const options = pickable(selection, flags, api.targets);
  const count = picked.flags.length + picked.items.length;
  const busy = phase !== 'idle';

  async function draft() {
    if (count === 0 || busy) return;
    setPhase('busy');
    const input = draftInput(selection, flags, api.targets, language);
    const outcome = await fetchDraft(
      server,
      { ...input, caseId, key: crypto.randomUUID() },
      () => alive.current,
      () => {
        setPhase('pending');
      },
    );
    if (outcome === null) return;
    if (outcome === 'timeout') {
      finish(t.failed(reasonText('timeout')), true);
      return;
    }
    if (!outcome.ok) {
      if (outcome.error.kind === 'problem' && outcome.error.problem.type === 'ai-not-enabled') {
        onNotEnabled();
      }
      finish(errorText(outcome.error), true);
      return;
    }
    const done = outcome.data;
    if (done.status === 'failed') {
      if (done.reason === 'policy') onNotEnabled();
      finish(t.failed(reasonText(done.reason)), true);
      return;
    }
    if (done.status === 'ready') {
      api.insert({ label: done.label, opening: done.opening, items: done.items });
      onSelectionChange(NO_SELECTION);
      finish(t.inserted(done.items.length), false);
    }
  }

  function finish(message: string, failed: boolean) {
    setPhase('idle');
    toast({ title: message, urgency: failed ? 'assertive' : 'polite' });
  }

  if (!enabled) {
    return (
      <section
        aria-label={t.legend}
        className="flex flex-wrap items-center gap-2 rounded-[14px] bg-ai-subtle px-3.5 py-3"
      >
        <Tooltip content={t.notEnabled}>
          <span tabIndex={0} className="rounded-md">
            <DraftButton disabled busy={false} onClick={() => undefined} />
          </span>
        </Tooltip>
        <span className="text-[13.5px] text-muted-foreground">{t.notEnabledShort}</span>
      </section>
    );
  }

  const remove = (pick: DraftPick) => {
    onSelectionChange(removePick(selection, pick));
  };
  const button = <DraftButton disabled={count === 0 || busy} busy={busy} onClick={draft} />;
  return (
    <section
      aria-label={t.legend}
      aria-busy={busy}
      className="grid gap-2.5 rounded-[14px] bg-ai-subtle px-3.5 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ai-subtle-foreground">{t.draftFrom}</span>
        {picked.flags.map((flag) => (
          <Chip
            key={flag.id}
            lead={<SeverityBadge severity={flag.severity} size="sm" />}
            text={flag.title}
            disabled={busy}
            onRemove={() => {
              remove(`flag:${flag.id}`);
            }}
          />
        ))}
        {picked.items.map((target) => (
          <Chip
            key={target.key}
            lead={
              <Icon
                icon={CATEGORY_ICONS[target.item?.category ?? 'assets']}
                className="size-[13px] text-muted-foreground"
              />
            }
            text={target.item?.description ?? target.label}
            disabled={busy}
            onRemove={() => {
              remove(`item:${target.ref.itemId ?? ''}`);
            }}
          />
        ))}
        {options.flags.length + options.items.length > 0 ? (
          <Select
            aria-label={t.addLabel}
            value=""
            placeholder={count > 0 ? t.addMore : t.addFirst}
            disabled={busy}
            onValueChange={(value) => {
              onSelectionChange(addPick(selection, value as DraftPick));
            }}
            className="h-8 w-auto max-w-[190px] bg-card text-[13.5px] data-placeholder:text-foreground"
          >
            {options.flags.length > 0 ? (
              <SelectGroup label={t.flagsGroup}>
                {options.flags.map((flag) => (
                  <SelectItem key={flag.id} value={`flag:${flag.id}`}>
                    {flag.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {options.items.length > 0 ? (
              <SelectGroup label={t.itemsGroup}>
                {options.items.map((target) => (
                  <SelectItem key={target.key} value={`item:${target.ref.itemId ?? ''}`}>
                    {t.itemOption(target.item?.description ?? target.label, target.group)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
          </Select>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label
          htmlFor={`${id}-language`}
          className="text-[12.5px] font-semibold text-ai-subtle-foreground"
        >
          {t.language}
        </label>
        <Select
          id={`${id}-language`}
          value={language}
          disabled={busy}
          onValueChange={(value) => {
            setLanguage(value as DraftLanguage);
          }}
          className="h-8 w-auto bg-card text-[13.5px]"
        >
          {DRAFT_LANGUAGES.map((each) => (
            <SelectItem key={each} value={each}>
              {t.languages[each]}
            </SelectItem>
          ))}
        </Select>
        <span className="flex-1" />
        <span
          role="status"
          className={cn(phase === 'pending' ? 'text-[13.5px] font-medium text-ai' : 'sr-only')}
        >
          {phase === 'pending' ? t.stillDrafting : phase === 'busy' ? t.draftingStatus : ''}
        </span>
        {count === 0 && !busy ? (
          <Tooltip content={t.pickFirst}>
            <span tabIndex={0} className="rounded-md">
              {button}
            </span>
          </Tooltip>
        ) : (
          button
        )}
      </div>
    </section>
  );
}

const CATEGORY_ICONS: Record<ItemCategory, Parameters<typeof Icon>[0]['icon']> = {
  income: Money03Icon,
  assets: Building03Icon,
  liabilities: CreditCardIcon,
};

function DraftButton({
  disabled,
  busy,
  onClick,
}: {
  disabled: boolean;
  busy: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <Button variant="ai" size="sm" disabled={disabled} onClick={() => void onClick()}>
      {busy ? <Spinner className="size-3.5" /> : <Icon icon={SparklesIcon} />}
      {busy ? t.drafting : t.draft}
    </Button>
  );
}

/** A picked flag or item: what it is, and a button to take it out. */
function Chip({
  lead,
  text,
  disabled,
  onRemove,
}: {
  lead: ReactNode;
  text: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-card pr-1 pl-[9px] text-[12.5px] font-medium shadow-[0_0_0_1px] shadow-ai/20">
      {lead}
      <span className="min-w-0 truncate">{text}</span>
      <button
        type="button"
        aria-label={t.remove(text)}
        disabled={disabled}
        onClick={onRemove}
        className={cn(
          focusRing,
          'grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <Icon icon={Cancel01Icon} className="size-[13px]" />
      </button>
    </span>
  );
}
