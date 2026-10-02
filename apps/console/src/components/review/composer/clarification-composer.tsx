import {
  AiLabel,
  type AiLabelDetails,
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  EmptyState,
  FieldError,
  formatDate,
  Icon,
  IconTile,
  Label,
  RadioCard,
  RadioGroup,
  SegmentedChoice,
  Spinner,
  Textarea,
  addDays,
  cn,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Alert02Icon,
  Clock01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  LeftToRightListBulletIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  RefreshIcon,
  SentIcon,
  SquareLock02Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useMemo, useReducer, useRef, useState } from 'react';

import {
  type ComposerDraft,
  type ComposerItem,
  type ComposerProblems,
  type ComposerState,
  composerProblems,
  composerReducer,
  composerToInput,
  draftComposer,
  emptyComposer,
  foreignLanguageOf,
  ITEM_TEXT_MAX,
  type ItemProblem,
  OPENING_TEXT_MAX,
} from '../../../clarification/composer';
import { REQUIREMENT_LABELS } from '../../../clarification/labels';
import { type ClarificationTarget, clarificationTargets } from '../../../clarification/targets';
import { reportingEntityOf } from '../../../review-case/declaration';
import { issueComposedClarification, saveClarificationDraft } from '../../../server/clarifications';
import type { IssueResult } from '../../../server/clarifications.server';
import type { CaseListItem, Clarification, Requirement } from '../../../server/review/types';
import type { ServiceError, ServiceResult } from '../../../server/service-call';
import { type LetterCommission, LetterPreview } from './letter-preview';
import { messages as t } from './messages';
import { isInOpenPicker, TargetPicker } from './target-picker';

/**
 * The clarification composer (spec 07a FE-4, S12, S19): a wide drawer where the reviewer holding
 * the case writes the items, each pointing at a section, statement or item of the current
 * version with what s.35(4) requires and the text, previews the letter, saves a draft or issues
 * it after a confirm. Ready to mount on the case view (#164) and on a draft's detail page; see
 * `/Users/william/.claude/spec-notes/272/composer-170.md` for the mount and Draft with AI notes.
 */

/** Days the declarant has to respond (tenant policy; the review service sets the real date). */
const REPLY_DAYS = 30;

/** What Draft with AI (spec 07c FE-3) gets to work with, through the `tools` slot. */
export interface ComposerApi {
  state: ComposerState;
  targets: readonly ClarificationTarget[];
  /** Appends drafted items (replacing a lone blank one) and sets the opening paragraph. */
  insert: (draft: ComposerDraft) => void;
  /** Removes an item, e.g. Discard on a drafted one. */
  remove: (key: string) => void;
}

/** The server functions the composer calls; tests pass fakes. */
export interface ComposerServer {
  save: (input: ComposedInput) => Promise<ServiceResult<Clarification>>;
  issue: (input: ComposedInput & { issueKey: string }) => Promise<IssueResult>;
}

type ComposedInput = ReturnType<typeof composerToInput> & {
  caseId: string;
  clarificationId: string | null;
  draftKey: string;
};

export const composerServer: ComposerServer = {
  save: (data) => saveClarificationDraft({ data }),
  issue: (data) => issueComposedClarification({ data }),
};

export interface ClarificationComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewCase: CaseListItem;
  /** The case's current version as filed (`CaseDetail.document`); null when unavailable. */
  document: Record<string, unknown> | null;
  commission: LetterCommission;
  /** A saved draft to continue (a follow-up's is pre-filled); leave out for a new one. */
  draft?: Clarification | null;
  /** The clarification a follow-up draft continues, for its callout. */
  followUpOf?: { reference: string | null } | null;
  /** Items a new clarification starts with instead of one blank item. */
  seed?: ComposerDraft | null;
  /** "Now", for the letter's date and the response due date. */
  now: string;
  /** Rendered above the items: the place for Draft with AI (#288). */
  tools?: (api: ComposerApi) => ReactNode;
  /** After a save; the drawer closes. */
  onSaved?: (draft: Clarification) => void;
  /** After an issue; the drawer closes. */
  onIssued?: (clarification: Clarification) => void;
  server?: ComposerServer;
}

export function ClarificationComposer({
  open,
  onOpenChange,
  ...props
}: ClarificationComposerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        size="wide"
        // A click beside the drawer must not throw away the reviewer's items.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isInOpenPicker(event.target)) event.preventDefault();
        }}
      >
        {open ? (
          <ComposerBody
            {...props}
            close={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

type Failure =
  | { kind: 'window-closed'; windowEndsAt: string }
  | { kind: 'not-mine' }
  | { kind: 'no-items' }
  | { kind: 'ai-draft-gone' }
  | { kind: 'unavailable' }
  | { kind: 'session' };

function failureOf(error: ServiceError, windowEndsAt: string): Failure {
  if (error.kind === 'unauthenticated') return { kind: 'session' };
  if (error.kind === 'problem') {
    const problem = error.problem as typeof error.problem & { windowEndsAt?: unknown };
    if (problem.type === 'clarification-window-closed') {
      return {
        kind: 'window-closed',
        windowEndsAt:
          typeof problem.windowEndsAt === 'string' ? problem.windowEndsAt : windowEndsAt,
      };
    }
    if (problem.status === 403) return { kind: 'not-mine' };
    if (problem.type === 'ai-draft-not-on-case') return { kind: 'ai-draft-gone' };
    if (problem.status === 400) return { kind: 'no-items' };
  }
  return { kind: 'unavailable' };
}

function ComposerBody({
  reviewCase,
  document,
  commission,
  draft = null,
  followUpOf = null,
  seed = null,
  now,
  tools,
  onSaved,
  onIssued,
  server = composerServer,
  close,
}: Omit<ClarificationComposerProps, 'open' | 'onOpenChange'> & { close: () => void }) {
  const { toast } = useToast();
  const targets = useMemo(() => clarificationTargets(document), [document]);
  const [state, dispatch] = useReducer(composerReducer, null, () => {
    if (draft) {
      return draftComposer(
        { items: draft.items, opening: draft.opening, openingAiJobId: draft.openingAiJobId },
        targets,
      );
    }
    const start = emptyComposer();
    return seed ? composerReducer(start, { type: 'insert', draft: seed, targets }) : start;
  });
  const [view, setView] = useState<'items' | 'preview'>('items');
  const [checked, setChecked] = useState<'save' | 'issue' | null>(null);
  const [clarificationId, setClarificationId] = useState(draft?.id ?? null);
  const [keys] = useState(() => ({ draft: crypto.randomUUID(), issue: crypto.randomUUID() }));
  const [busy, setBusy] = useState<'save' | 'issue' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  /** Brings the alert at the top into view after a refused save or issue. */
  const toTop = () => {
    if (body.current) body.current.scrollTop = 0;
  };

  const problems = checked ? composerProblems(state, checked) : null;
  const dueAt = addDays(now, REPLY_DAYS);
  const api: ComposerApi = {
    state,
    targets,
    insert: (inserted) => {
      dispatch({ type: 'insert', draft: inserted, targets });
    },
    remove: (key) => {
      dispatch({ type: 'remove', key });
    },
  };
  const title = followUpOf ? t.followUpTitle : draft ? t.draftTitle : t.newTitle;

  async function save() {
    setChecked('save');
    if (composerProblems(state, 'save').any) {
      setView('items');
      toTop();
      return;
    }
    setBusy('save');
    const result = await server.save({
      caseId: reviewCase.id,
      clarificationId,
      ...composerToInput(state),
      draftKey: keys.draft,
    });
    setBusy(null);
    if (!result.ok) {
      const failed = failureOf(result.error, reviewCase.windowEndsAt);
      toast({
        title:
          failed.kind === 'session'
            ? t.sessionEnded
            : failed.kind === 'not-mine'
              ? t.saveStale
              : failed.kind === 'ai-draft-gone'
                ? t.aiDraftGone
                : t.saveFailed,
        urgency: 'assertive',
      });
      return;
    }
    toast({ title: t.savedToast });
    close();
    onSaved?.(result.data);
  }

  function tryIssue() {
    setChecked('issue');
    if (composerProblems(state, 'issue').any) {
      setView('items');
      toTop();
      return;
    }
    setConfirming(true);
  }

  async function issue() {
    setBusy('issue');
    const result = await server.issue({
      caseId: reviewCase.id,
      clarificationId,
      ...composerToInput(state),
      draftKey: keys.draft,
      issueKey: keys.issue,
    });
    setBusy(null);
    setConfirming(false);
    if (!result.ok) {
      if (result.draftId) setClarificationId(result.draftId);
      setFailure(failureOf(result.error, reviewCase.windowEndsAt));
      toTop();
      return;
    }
    toast({ title: t.issuedToast(result.data.reference ?? '') });
    close();
    onIssued?.(result.data);
  }

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{title}</DrawerTitle>
        <DrawerDescription>
          {t.to(reviewCase.declarantName, reviewCase.reference)}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody ref={body}>
        {followUpOf?.reference ? (
          <Alert variant="info" role="note">
            <Icon icon={RefreshIcon} />
            <AlertDescription>{t.followUpOf(followUpOf.reference)}</AlertDescription>
          </Alert>
        ) : null}
        {failure ? <FailureAlert failure={failure} /> : null}
        {problems?.any ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>{problems.none ? t.addOneItem : t.completeItems}</AlertDescription>
          </Alert>
        ) : null}
        <SegmentedChoice
          variant="track"
          legend={t.viewLegend}
          value={view}
          onValueChange={(next) => {
            setView(next === 'preview' ? 'preview' : 'items');
          }}
          options={[
            { value: 'items', label: <ViewLabel icon={PencilEdit02Icon} text={t.viewItems} /> },
            { value: 'preview', label: <ViewLabel icon={ViewIcon} text={t.viewPreview} /> },
          ]}
        />
        {view === 'preview' ? (
          <LetterPreview
            commission={commission}
            reviewCase={reviewCase}
            reportingEntity={reportingEntityOf(document)}
            items={state.items.map((item) => ({
              label: item.target?.label ?? null,
              requirement: item.requirement,
              text: item.text,
            }))}
            opening={state.opening?.text ?? null}
            aiAssisted={
              state.items.some(isAiAssisted) ||
              (state.opening !== null && isAiAssisted(state.opening))
            }
            date={now}
            dueAt={dueAt}
          />
        ) : (
          <>
            {tools?.(api)}
            {state.opening ? (
              <OpeningField
                opening={state.opening}
                tooLong={problems?.opening === 'too-long'}
                onChange={(text) => {
                  dispatch({ type: 'opening', text });
                }}
                onDiscard={() => {
                  dispatch({ type: 'discard-opening' });
                }}
              />
            ) : null}
            {state.items.length > 0 ? (
              <ol className="grid gap-[18px]" aria-label={t.viewItems}>
                {state.items.map((item, index) => (
                  <li key={item.key}>
                    <ItemCard
                      item={item}
                      index={index}
                      targets={targets}
                      problems={problems?.items[item.key]}
                      removable={isAiAssisted(item) || state.items.length > 1}
                      pickerOpen={opened === item.key}
                      dispatch={dispatch}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                icon={<Icon icon={LeftToRightListBulletIcon} />}
                title={t.noItemsTitle}
                description={t.noItemsText}
                className="py-8"
              />
            )}
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => {
                setOpened(`item-${String(state.next)}`);
                dispatch({ type: 'add' });
              }}
            >
              <Icon icon={PlusSignIcon} />
              {t.addItem}
            </Button>
          </>
        )}
      </DrawerBody>
      <DrawerFooter className="flex-wrap items-center">
        <span className="flex basis-full items-center gap-1.5 text-[13px] text-muted-foreground sm:mr-auto sm:basis-auto">
          <Icon icon={Clock01Icon} className="size-3.5" />
          {t.responseDue(dueAt)}
        </span>
        <Button variant="secondary" disabled={busy !== null} onClick={() => void save()}>
          {busy === 'save' ? <Spinner /> : <Icon icon={FloppyDiskIcon} />}
          {busy === 'save' ? t.saving : t.saveDraft}
        </Button>
        <Button disabled={busy !== null || failure?.kind === 'window-closed'} onClick={tryIssue}>
          <Icon icon={SentIcon} />
          {t.issue}
        </Button>
      </DrawerFooter>
      <IssueConfirm
        open={confirming}
        onOpenChange={setConfirming}
        busy={busy === 'issue'}
        items={state.items.length}
        dueAt={dueAt}
        onIssue={() => void issue()}
      />
    </>
  );
}

function ViewLabel({ icon, text }: { icon: Parameters<typeof Icon>[0]['icon']; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon icon={icon} className="size-3.5" />
      {text}
    </span>
  );
}

function FailureAlert({ failure }: { failure: Failure }) {
  const text =
    failure.kind === 'window-closed'
      ? t.windowClosed(failure.windowEndsAt)
      : failure.kind === 'not-mine'
        ? t.notMine
        : failure.kind === 'no-items'
          ? t.addOneItem
          : failure.kind === 'ai-draft-gone'
            ? t.aiDraftGone
            : failure.kind === 'session'
              ? t.sessionEnded
              : t.issueUnavailable;
  return (
    <Alert variant="destructive">
      <Icon icon={failure.kind === 'window-closed' ? SquareLock02Icon : AlertCircleIcon} />
      <AlertTitle>{t.issueFailedTitle}</AlertTitle>
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

const PROBLEM_TEXT: Record<'target' | 'requirement' | 'text', Record<ItemProblem, string>> = {
  target: { required: t.targetRequired, 'too-long': t.targetRequired },
  requirement: { required: t.requirementRequired, 'too-long': t.requirementRequired },
  text: { required: t.textRequired, 'too-long': t.textTooLong },
};

const REQUIREMENTS = Object.keys(REQUIREMENT_LABELS) as Requirement[];

function ItemCard({
  item,
  index,
  targets,
  problems,
  removable,
  pickerOpen,
  dispatch,
}: {
  item: ComposerItem;
  index: number;
  targets: readonly ClarificationTarget[];
  problems: ComposerProblems['items'][string] | undefined;
  removable: boolean;
  pickerOpen: boolean;
  dispatch: (action: Parameters<typeof composerReducer>[1]) => void;
}) {
  const id = useId();
  const n = index + 1;
  const invalid = problems !== undefined;
  const over = item.text.length > ITEM_TEXT_MAX;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        'grid gap-3.5 rounded-2xl bg-card px-4 pt-3.5 pb-4',
        invalid ? 'shadow-control-error' : isAiAssisted(item) ? AI_CARD : 'shadow-card',
      )}
    >
      <div className="flex min-h-8 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold text-background"
        >
          {n}
        </span>
        <h3 id={`${id}-title`} className="text-[14.5px] font-semibold">
          {t.item(n)}
        </h3>
        {isAiAssisted(item) ? <AiDraftLabel ai={item.ai} edited={item.edited} /> : null}
        <span className="flex-1" />
        {removable ? (
          <Button
            variant="ghost"
            size="xs"
            aria-label={isAiAssisted(item) ? t.discardItemLabel(n) : t.removeItemLabel(n)}
            onClick={() => {
              dispatch({ type: 'remove', key: item.key });
            }}
          >
            <Icon icon={Delete02Icon} />
            {isAiAssisted(item) ? t.discardItem : t.removeItem}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <span
          id={`${id}-target`}
          className="text-sm leading-5 font-medium text-secondary-foreground"
        >
          {t.targetLabel}
        </span>
        <TargetPicker
          targets={targets}
          value={item.target}
          onChange={(target) => {
            dispatch({ type: 'target', key: item.key, target });
          }}
          invalid={problems?.target !== undefined}
          labelledBy={`${id}-target`}
          describedBy={problems?.target ? `${id}-target-error` : undefined}
          defaultOpen={pickerOpen}
        />
        {problems?.target ? (
          <FieldError id={`${id}-target-error`}>{PROBLEM_TEXT.target[problems.target]}</FieldError>
        ) : null}
      </div>

      <RadioGroup
        legend={t.requirementLegend}
        error={problems?.requirement ? PROBLEM_TEXT.requirement[problems.requirement] : undefined}
      >
        {REQUIREMENTS.map((requirement) => (
          <RadioCard
            key={requirement}
            name={`${id}-requirement`}
            value={requirement}
            label={REQUIREMENT_LABELS[requirement]}
            checked={item.requirement === requirement}
            onChange={() => {
              dispatch({ type: 'requirement', key: item.key, requirement });
            }}
          />
        ))}
      </RadioGroup>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${id}-text`}>{t.textLabel}</Label>
          <span
            className={cn(
              'text-[12.5px] text-muted-foreground tabular-nums',
              over && 'font-semibold text-destructive',
            )}
          >
            {t.counter(item.text.length, ITEM_TEXT_MAX)}
          </span>
        </div>
        <Textarea
          id={`${id}-text`}
          autoGrow
          rows={3}
          value={item.text}
          placeholder={t.textPlaceholder}
          aria-invalid={problems?.text ? true : undefined}
          aria-describedby={problems?.text ? `${id}-text-error` : undefined}
          onChange={(event) => {
            dispatch({ type: 'text', key: item.key, text: event.target.value });
          }}
        />
        {problems?.text ? (
          <FieldError id={`${id}-text-error`}>{PROBLEM_TEXT.text[problems.text]}</FieldError>
        ) : null}
        <LanguageWarning part={item} />
      </div>
    </section>
  );
}

/**
 * Text drafted with AI in a language other than the letter's own (`LETTER_LANGUAGE`): the letter
 * would mix two languages, so the reviewer is told before issuing. It stays while the text does,
 * edited or not; the composer cannot tell from the text whether it was rewritten.
 */
function LanguageWarning({ part }: { part: Parameters<typeof foreignLanguageOf>[0] }) {
  const language = foreignLanguageOf(part);
  if (language === null) return null;
  return (
    <Alert variant="warning" role="note" className="mt-1 px-3.5 py-2.5 text-[13.5px]">
      <Icon icon={Alert02Icon} />
      <AlertDescription>{t.otherLanguage(t.languages[language] ?? language)}</AlertDescription>
    </Alert>
  );
}

/** A drafted item's card: the card's shadow with the AI colour down its left edge. */
const AI_CARD = 'shadow-card-ai';

/** Drafted with AI: inserted in this sitting, or saved with its drafting job (ADR-007). */
const isAiAssisted = (part: { ai: unknown; aiJobId: string | null }) =>
  part.ai !== null || part.aiJobId !== null;

/**
 * The label on drafted text: "AI draft" (then "AI draft, edited") with its details while the
 * composer has them; "AI-assisted" on a saved draft's, whose label details were not kept and
 * which the reviewer may have edited before saving.
 */
function AiDraftLabel({ ai, edited }: { ai: AiLabelDetails | null; edited: boolean }) {
  return ai ? (
    <AiLabel details={ai} text={t.aiDraft} edited={edited} size="sm" />
  ) : (
    <AiLabel text={t.aiAssisted} messages={{ noDetails: t.aiAssistedTip }} size="sm" />
  );
}

/** The letter's opening paragraph (Draft with AI's, or a saved draft's); editable, or discarded. */
function OpeningField({
  opening,
  tooLong,
  onChange,
  onDiscard,
}: {
  opening: NonNullable<ComposerState['opening']>;
  tooLong: boolean;
  onChange: (text: string) => void;
  onDiscard: () => void;
}) {
  const id = useId();
  const over = opening.text.trim().length > OPENING_TEXT_MAX;
  return (
    <section
      className={cn(
        'grid gap-1.5 rounded-2xl bg-card px-4 pt-3.5 pb-4',
        tooLong ? 'shadow-control-error' : isAiAssisted(opening) ? AI_CARD : 'shadow-card',
      )}
    >
      <div className="flex min-h-8 items-center gap-2">
        <Label htmlFor={id} className="text-[14.5px] font-semibold text-foreground">
          {t.openingLabel}
        </Label>
        {isAiAssisted(opening) ? <AiDraftLabel ai={opening.ai} edited={opening.edited} /> : null}
        <span className="flex-1" />
        <span
          className={cn(
            'hidden text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums sm:inline',
            over && 'font-semibold text-destructive',
          )}
        >
          {t.counter(opening.text.length, OPENING_TEXT_MAX)}
        </span>
        <Button variant="ghost" size="xs" aria-label={t.discardOpeningLabel} onClick={onDiscard}>
          <Icon icon={Delete02Icon} />
          {t.discardItem}
        </Button>
      </div>
      <Textarea
        id={id}
        autoGrow
        rows={3}
        value={opening.text}
        aria-invalid={tooLong ? true : undefined}
        aria-describedby={tooLong ? `${id}-error` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {tooLong ? <FieldError id={`${id}-error`}>{t.openingTooLong}</FieldError> : null}
      <LanguageWarning part={opening} />
    </section>
  );
}

function IssueConfirm({
  open,
  onOpenChange,
  busy,
  items,
  dueAt,
  onIssue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  items: number;
  dueAt: string;
  onIssue: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent busy={busy}>
        <DialogHeader className="flex-row items-center gap-3">
          <IconTile>
            <Icon icon={SentIcon} />
          </IconTile>
          <DialogTitle>{t.confirmTitle}</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-4">
          <DialogDescription className="text-[15px] text-foreground">
            {t.confirmText}
          </DialogDescription>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div className="grid gap-1">
              <dt className="text-[13px] text-muted-foreground">{t.confirmItems}</dt>
              <dd className="font-medium">{items}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-[13px] text-muted-foreground">{t.confirmDue}</dt>
              <dd className="font-medium">{formatDate(dueAt)}</dd>
            </div>
          </dl>
          <p className="text-[13px] text-muted-foreground">{t.confirmNote}</p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t.backToEditing}
          </Button>
          <Button disabled={busy} onClick={onIssue}>
            {busy ? <Spinner /> : null}
            {busy ? t.issuing : t.issue}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
