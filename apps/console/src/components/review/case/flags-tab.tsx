import {
  Badge,
  Button,
  cn,
  EmptyState,
  FieldError,
  formatDate,
  Icon,
  Label,
  Spinner,
  Textarea,
  Tooltip,
} from '@adili/ui';
import {
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  Flag01Icon,
  HashIcon,
  HelpCircleIcon,
  InformationCircleIcon,
  SparklesIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useId, useRef, useState } from 'react';

import type { CaseFlag } from '../../../server/review-case.server';
import type { DeclarationView } from '../../../review-case/declaration';
import {
  concernsLine,
  evidenceLine,
  FLAG_NOTE_MAX_LENGTH,
  flagAnchorId,
  flagItemId,
  flagNoteError,
  groupFlags,
} from '../../../review-case/flags';
import { SeverityBadge } from '../copilot/severity-badge';
import { InfoTip } from './info-tip';
import { messages as t } from './messages';

/**
 * The Flags tab (spec 07a FE-3, S11): the indicator banner, open flags grouped by severity, each
 * with its evidence, what it concerns, Go to item, Mark reviewed (the officer holding the case,
 * with a note) and Explain (when the copilot has explanations); reviewed flags collapse to the
 * reviewer's note.
 */

export interface FlagsTabProps {
  flags: CaseFlag[];
  view: DeclarationView | null;
  declarant: string;
  /** The officer holding the case may mark flags reviewed. */
  canReview: boolean;
  /** The copilot has explanations to open. */
  canExplain: boolean;
  /** The flag to draw attention to (a pin was followed); a new `key` each time. */
  pulse: { flagId: string; key: number } | null;
  onGoToItem: (itemId: string) => void;
  onExplain: (flagId: string) => void;
  /** Saves the note; resolves to an error to show, or null once saved. */
  onReview: (flagId: string, note: string) => Promise<string | null>;
}

export function FlagsTab({
  flags,
  view,
  declarant,
  canReview,
  canExplain,
  pulse,
  onGoToItem,
  onExplain,
  onReview,
}: FlagsTabProps) {
  const [formFor, setFormFor] = useState<string | null>(null);
  const groups = groupFlags(flags);
  const card = (flag: CaseFlag) => (
    <FlagCard
      key={flag.id}
      flag={flag}
      evidence={evidenceLine(flag)}
      concerns={concernsLine(flag, view, declarant)}
      view={view}
      canReview={canReview}
      canExplain={canExplain}
      pulse={pulse?.flagId === flag.id ? pulse.key : null}
      formOpen={formFor === flag.id}
      onOpenForm={() => {
        setFormFor(flag.id);
      }}
      onCloseForm={() => {
        setFormFor(null);
      }}
      onGoToItem={onGoToItem}
      onExplain={onExplain}
      onReview={async (note) => {
        const failed = await onReview(flag.id, note);
        if (!failed) setFormFor(null);
        return failed;
      }}
    />
  );

  return (
    <div className="grid gap-3.5">
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg bg-info-subtle px-[13px] py-[11px] text-[13.5px] font-medium text-info-subtle-foreground"
      >
        <Icon icon={InformationCircleIcon} className="mt-0.5 size-4 shrink-0" />
        <span>{t.flags.banner}</span>
      </div>
      {flags.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Flag01Icon} />}
          title={t.flags.noneTitle}
          description={t.flags.noneBody}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span>
              {t.flags.counts(groups.openCount, groups.reviewed.length, groups.closed.length)}
            </span>
            <Tooltip content={t.flags.howPriorityTip}>
              <button
                type="button"
                className="ml-auto inline-flex cursor-help items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Icon icon={HelpCircleIcon} className="size-3.5" />
                {t.flags.howPriority}
              </button>
            </Tooltip>
          </div>
          {groups.open.map((group) => (
            <section
              key={group.severity}
              aria-label={`${group.severity} severity`}
              className="grid gap-2.5"
            >
              <h3 className="mt-1 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
                <SeverityBadge severity={group.severity} />
                <span>{group.flags.length}</span>
              </h3>
              {group.flags.map(card)}
            </section>
          ))}
          {groups.reviewed.length > 0 ? (
            <section aria-label={t.flags.reviewed(groups.reviewed.length)} className="grid gap-2.5">
              <h3 className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
                <Icon icon={Tick02Icon} className="size-3.5" />
                {t.flags.reviewed(groups.reviewed.length)}
              </h3>
              {groups.reviewed.map(card)}
            </section>
          ) : null}
          {groups.closed.length > 0 ? (
            <section
              aria-label={t.flags.closedGroup(groups.closed.length)}
              className="grid gap-2.5"
            >
              <h3 className="mt-2 text-[12.5px] font-semibold text-muted-foreground">
                {t.flags.closedGroup(groups.closed.length)}
              </h3>
              {groups.closed.map(card)}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

const STRIPES = {
  high: 'before:bg-destructive',
  medium: 'before:bg-warning-mark',
  low: 'before:bg-info',
  info: 'before:bg-input',
} as const;

function FlagCard({
  flag,
  view,
  evidence,
  concerns,
  canReview,
  canExplain,
  pulse,
  formOpen,
  onOpenForm,
  onCloseForm,
  onGoToItem,
  onExplain,
  onReview,
}: {
  flag: CaseFlag;
  view: DeclarationView | null;
  evidence: string | null;
  concerns: string;
  canReview: boolean;
  canExplain: boolean;
  pulse: number | null;
  formOpen: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  onGoToItem: (itemId: string) => void;
  onExplain: (flagId: string) => void;
  onReview: (note: string) => Promise<string | null>;
}) {
  const ref = useRef<HTMLElement>(null);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (pulse === null || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ref.current.focus({ preventScroll: true });
    setPulsing(true);
    const timer = setTimeout(() => {
      setPulsing(false);
    }, 1_700);
    return () => {
      clearTimeout(timer);
    };
  }, [pulse]);

  const base = cn(
    'relative grid scroll-mt-[60px] gap-1.5 overflow-hidden rounded-xl py-[13px] pr-3.5 pl-4 outline-none before:absolute before:inset-y-0 before:left-0 before:w-1',
    pulsing && 'animate-[copilot-flag-pulse_1.6s_ease-out] motion-reduce:animate-none',
  );

  if (flag.closedReason) {
    return (
      <article
        ref={ref}
        id={flagAnchorId(flag.id)}
        tabIndex={-1}
        className={cn(base, 'bg-background opacity-85 ring-1 ring-border before:bg-input')}
      >
        <div className="flex items-center gap-2">
          <SeverityBadge severity={flag.severity} size="sm" />
          <h4 className="text-sm font-medium text-secondary-foreground">{flag.title}</h4>
        </div>
        <p className="text-[13px] text-muted-foreground">{t.flags.closedLine}</p>
      </article>
    );
  }

  if (flag.reviewed) {
    return (
      <article
        ref={ref}
        id={flagAnchorId(flag.id)}
        tabIndex={-1}
        className={cn(base, 'bg-background ring-1 ring-border before:bg-success')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Icon icon={CheckmarkCircle02Icon} className="size-4 text-success" strokeWidth={2.2} />
          <h4 className="text-sm font-medium text-secondary-foreground">{flag.title}</h4>
          <SeverityBadge severity={flag.severity} size="sm" />
          {flag.recomputed ? (
            <Tooltip content={t.flags.recomputedTip}>
              <Badge tabIndex={0} className="h-[19px] px-1.5 text-[11px]">
                {t.flags.recomputed}
              </Badge>
            </Tooltip>
          ) : null}
        </div>
        <div className="rounded-lg bg-success-subtle px-2.5 py-[7px] text-[13px] text-secondary-foreground">
          <div className="text-xs font-medium text-success-subtle-foreground">
            {t.flags.reviewedBy(flag.reviewed.by.name, formatDate(flag.reviewed.at))}
          </div>
          <p className="whitespace-pre-line">{flag.reviewed.note}</p>
        </div>
      </article>
    );
  }

  // Without the declaration there is no item to go to.
  const itemId = view ? flagItemId(flag) : null;
  return (
    <article
      ref={ref}
      id={flagAnchorId(flag.id)}
      tabIndex={-1}
      aria-label={flag.title}
      className={cn(base, 'bg-card shadow-card', STRIPES[flag.severity])}
    >
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 text-sm leading-[1.35] font-semibold">
          {flag.title} <InfoTip label={t.flags.aboutIndicator} content={flag.indicator} />
        </h4>
        {flag.recomputed ? <Badge className="h-[22px] text-xs">{t.flags.recomputed}</Badge> : null}
      </div>
      {evidence ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-muted px-[9px] py-1.5 text-[13px] text-secondary-foreground">
          <Icon icon={HashIcon} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>
            <span className="sr-only">{t.flags.evidence}</span>
            {evidence}
          </span>
        </p>
      ) : null}
      <p className="text-[12.5px] text-muted-foreground">{concerns}</p>
      {formOpen ? (
        <ReviewForm onCancel={onCloseForm} onSave={onReview} />
      ) : (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {itemId ? (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                onGoToItem(itemId);
              }}
            >
              <Icon icon={ArrowRight02Icon} />
              {t.flags.goToItem}
            </Button>
          ) : null}
          {canReview ? (
            <Button variant="ghost" size="xs" onClick={onOpenForm}>
              <Icon icon={Tick02Icon} />
              {t.flags.markReviewed}
            </Button>
          ) : null}
          {canExplain ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-ai hover:text-ai"
              onClick={() => {
                onExplain(flag.id);
              }}
            >
              <Icon icon={SparklesIcon} />
              {t.flags.explain}
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}

function ReviewForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (note: string) => Promise<string | null>;
}) {
  const id = useId();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);

  async function save() {
    const problem = flagNoteError(note);
    if (problem) {
      setError(problem);
      field.current?.focus();
      return;
    }
    setBusy(true);
    const failed = await onSave(note.trim());
    setBusy(false);
    setError(failed);
  }

  return (
    <div className="mt-1 grid gap-1.5">
      <Label htmlFor={id}>{t.flags.noteLabel}</Label>
      <Textarea
        ref={field}
        id={id}
        rows={3}
        maxLength={FLAG_NOTE_MAX_LENGTH}
        value={note}
        placeholder={t.flags.notePlaceholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setNote(event.target.value);
          if (error) setError(null);
        }}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t.flags.cancel}
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : null}
          {t.flags.markReviewed}
        </Button>
      </div>
    </div>
  );
}
