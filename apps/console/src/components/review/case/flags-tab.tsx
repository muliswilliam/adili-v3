import type { DeclarationV1 } from '@adili/forms';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  cn,
  EmptyState,
  FieldError,
  focusRing,
  Icon,
  Label,
  SeverityBadge,
  Spinner,
  Textarea,
  Tooltip,
} from '@adili/ui';
import {
  ArrowRight02Icon,
  Flag02Icon,
  HashtagIcon,
  HelpCircleIcon,
  InformationCircleIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import { evidenceLine, flagTargetLine, groupFlags } from '../../../review-case/flags';
import { CASE_COPY, FLAG_NOTE_MAX } from '../../../review-case/messages';
import { RULE_SYSTEMS, SYSTEM_NAMES } from '../../../review-case/registry';
import type { CaseFlag } from '../../../server/review-case.server';

const copy = CASE_COPY.flags;

/** The coloured bar down a flag's left edge, by severity (the kit's `.flag.s-*::before`). */
const EDGE: Record<CaseFlag['severity'], string> = {
  high: 'before:bg-destructive',
  medium: 'before:bg-warning',
  low: 'before:bg-info',
  info: 'before:bg-input',
};

/** The DOM id of a flag's card, to scroll back to it from a pin. */
export function flagAnchorId(flagId: string): string {
  return `case-flag-${flagId}`;
}

const card =
  'relative grid scroll-mt-16 gap-1.5 overflow-hidden rounded-xl py-[13px] pr-3.5 pl-4 before:absolute before:inset-y-0 before:left-0 before:w-1';

function ReviewForm({
  flag,
  onCancel,
  onSubmit,
}: {
  flag: CaseFlag;
  onCancel: () => void;
  onSubmit: (note: string) => Promise<string | null>;
}) {
  const id = useId();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const text = note.trim();
    if (!text) {
      setError(copy.noteRequired);
      return;
    }
    if (text.length > FLAG_NOTE_MAX) {
      setError(copy.noteTooLong);
      return;
    }
    setBusy(true);
    const failed = await onSubmit(text);
    setBusy(false);
    setError(failed);
  }
  return (
    <form
      className="mt-1 grid gap-1.5"
      aria-label={`${copy.markReviewed}: ${flag.title}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor={id}>{copy.noteLabel}</Label>
      <Textarea
        id={id}
        rows={3}
        autoFocus
        value={note}
        maxLength={FLAG_NOTE_MAX}
        placeholder={copy.notePlaceholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setNote(event.target.value);
          if (error) setError(null);
        }}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {CASE_COPY.cancel}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Spinner /> : null}
          {copy.markReviewed}
        </Button>
      </div>
    </form>
  );
}

function OpenFlag({
  flag,
  document,
  previousVersion,
  canReview,
  editing,
  pulse,
  showSystem,
  onEdit,
  onCancel,
  onReview,
  onGo,
}: FlagActions & {
  flag: CaseFlag;
  document: DeclarationV1 | null;
  previousVersion: number | null;
  canReview: boolean;
  editing: boolean;
  pulse: boolean;
  showSystem: boolean;
}) {
  const evidence = evidenceLine(flag, previousVersion);
  const target = flagTargetLine(flag, document);
  const ruleSystem = RULE_SYSTEMS[flag.ruleId];
  const system = showSystem && ruleSystem ? SYSTEM_NAMES[ruleSystem] : null;
  const canGo = document !== null && flag.itemRefs.length > 0;
  return (
    <li
      id={flagAnchorId(flag.id)}
      data-flag-id={flag.id}
      data-pulse={pulse || undefined}
      className={cn(
        card,
        'bg-card shadow-card',
        EDGE[flag.severity],
        pulse && 'motion-safe:animate-ring-pulse',
      )}
    >
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 text-sm leading-[1.35] font-semibold">
          {flag.title}{' '}
          <Tooltip content={flag.indicator}>
            <button
              type="button"
              aria-label={`${copy.aboutIndicator}: ${flag.indicator}`}
              className={cn(
                focusRing,
                'inline-flex rounded-full align-[-2px] text-muted-foreground',
              )}
            >
              <Icon icon={InformationCircleIcon} className="size-[15px]" />
            </button>
          </Tooltip>
        </h4>
        {system ? <Badge>{system}</Badge> : null}
        {flag.recomputed ? <Badge>{copy.recomputed}</Badge> : null}
      </div>
      {evidence ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-muted px-[9px] py-1.5 text-[13px] text-secondary-foreground">
          <Icon icon={HashtagIcon} className="mt-0.5 size-3.5 text-muted-foreground" />
          <span>
            <span className="sr-only">{copy.evidence}</span>
            {evidence}
          </span>
        </p>
      ) : null}
      {target ? <p className="text-[12.5px] text-muted-foreground">{target}</p> : null}
      {editing ? (
        <ReviewForm flag={flag} onCancel={onCancel} onSubmit={(note) => onReview(flag, note)} />
      ) : canGo || canReview ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {canGo ? (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                onGo(flag);
              }}
            >
              <Icon icon={ArrowRight02Icon} />
              {copy.goToItem}
            </Button>
          ) : null}
          {canReview ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onEdit(flag);
              }}
            >
              <Icon icon={Tick02Icon} />
              {copy.markReviewed}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ReviewedFlag({ flag, currentVersion }: { flag: CaseFlag; currentVersion: number }) {
  const reviewed = flag.reviewed;
  if (!reviewed) return null;
  return (
    <li
      id={flagAnchorId(flag.id)}
      data-flag-id={flag.id}
      data-reviewed="true"
      className={cn(card, 'bg-muted/30 shadow-[0_0_0_1px_var(--border)] before:bg-success')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon icon={Tick02Icon} strokeWidth={2.4} className="text-success" />
        <h4 className="text-sm leading-[1.35] font-medium text-secondary-foreground">
          {flag.title}
        </h4>
        <SeverityBadge severity={flag.severity} />
        {flag.recomputed ? (
          <Tooltip content={copy.recomputedTip(currentVersion)}>
            <Badge tabIndex={0} className={focusRing}>
              {copy.recomputed}
            </Badge>
          </Tooltip>
        ) : null}
      </div>
      <div className="rounded-lg bg-success-subtle px-2.5 py-[7px] text-[13px] text-secondary-foreground">
        <p className="text-xs font-medium text-success-subtle-foreground">
          {copy.reviewedBy(reviewed.by.name, reviewed.at)}
        </p>
        <p className="break-words whitespace-pre-line">{reviewed.note}</p>
      </div>
    </li>
  );
}

function ClosedFlag({ flag }: { flag: CaseFlag }) {
  return (
    <li
      id={flagAnchorId(flag.id)}
      data-flag-id={flag.id}
      className={cn(
        card,
        'bg-muted/30 opacity-85 shadow-[0_0_0_1px_var(--border)]',
        EDGE[flag.severity],
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={flag.severity} />
        <h4 className="text-sm font-medium">{flag.title}</h4>
      </div>
      <p className="text-[12.5px] text-muted-foreground">{copy.closedNote}</p>
    </li>
  );
}

/**
 * One flag as it stands: open (with Go to item and, for the holder, Mark reviewed), reviewed
 * (with the note), or closed by a registry re-check. The Registry tab lists a registry's flags
 * with it, without the registry's badge.
 */
export function FlagCard({
  flag,
  currentVersion,
  showSystem = true,
  ...props
}: FlagActions & {
  flag: CaseFlag;
  document: DeclarationV1 | null;
  previousVersion: number | null;
  currentVersion: number;
  canReview: boolean;
  editing: boolean;
  pulse: boolean;
  showSystem?: boolean;
}) {
  if (flag.reviewed) return <ReviewedFlag flag={flag} currentVersion={currentVersion} />;
  if (flag.closedReason) return <ClosedFlag flag={flag} />;
  return <OpenFlag flag={flag} showSystem={showSystem} {...props} />;
}

export interface FlagActions {
  onEdit: (flag: CaseFlag) => void;
  onCancel: () => void;
  /** Resolves to an error to show under the note, or null once it is saved. */
  onReview: (flag: CaseFlag, note: string) => Promise<string | null>;
  /** "Go to item": show the flag's item (or section) in the declaration. */
  onGo: (flag: CaseFlag) => void;
}

/**
 * The Flags tab (spec 07a FE-3): the indicator banner, the counts and how priority is set, then
 * open flags grouped by severity (High, Medium, Low, Info), each with its title, indicator text
 * (behind the info mark), evidence line, what it points at, "Go to item" and, for the officer
 * holding the case, "Mark reviewed" with a note. Reviewed flags collapse below with the note and
 * the reviewer; flags a registry re-check closed come last.
 */
export function FlagsTab({
  flags,
  document,
  previousVersion,
  currentVersion,
  canReview,
  editing,
  pulse,
  ...actions
}: FlagActions & {
  flags: readonly CaseFlag[];
  document: DeclarationV1 | null;
  previousVersion: number | null;
  currentVersion: number;
  canReview: boolean;
  /** The flag whose review note is being written. */
  editing: string | null;
  /** The flag just sent to from a pin, pulsing once. */
  pulse: string | null;
}) {
  const groups = groupFlags(flags);
  const banner = (
    <Alert variant="info" role="note" className="font-medium">
      <Icon icon={InformationCircleIcon} />
      <AlertDescription>{copy.banner}</AlertDescription>
    </Alert>
  );
  if (flags.length === 0) {
    return (
      <div className="grid gap-3.5">
        {banner}
        <EmptyState
          icon={<Icon icon={Flag02Icon} />}
          title={copy.emptyTitle}
          description={copy.emptyBody}
        />
      </div>
    );
  }
  return (
    <div className="grid gap-3.5">
      {banner}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">
          {copy.counts(groups.openCount, groups.reviewed.length, groups.closed.length)}
        </span>
        <Tooltip content={copy.howPriorityTip}>
          <span
            tabIndex={0}
            className={cn(
              focusRing,
              'ml-auto inline-flex items-center gap-[5px] rounded-sm text-[13px] text-muted-foreground',
            )}
          >
            <Icon icon={HelpCircleIcon} className="size-3.5" />
            {copy.howPriority}
          </span>
        </Tooltip>
      </div>
      {groups.open.map(({ severity, flags: inGroup }) => (
        <section
          key={severity}
          aria-label={`${copy.severity[severity]}: ${String(inGroup.length)}`}
          className="grid gap-2.5"
        >
          <h3 className="mt-1 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
            <SeverityBadge severity={severity} />
            <span>{inGroup.length}</span>
          </h3>
          <ul className="grid gap-2.5">
            {inGroup.map((flag) => (
              <OpenFlag
                key={flag.id}
                flag={flag}
                document={document}
                previousVersion={previousVersion}
                canReview={canReview}
                editing={editing === flag.id}
                pulse={pulse === flag.id}
                showSystem
                {...actions}
              />
            ))}
          </ul>
        </section>
      ))}
      {groups.reviewed.length > 0 ? (
        <section aria-label={copy.reviewedGroup} className="grid gap-2.5">
          <h3 className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
            <Icon icon={Tick02Icon} className="size-3.5" />
            {copy.reviewedGroup} {groups.reviewed.length}
          </h3>
          <ul className="grid gap-2.5">
            {groups.reviewed.map((flag) => (
              <ReviewedFlag key={flag.id} flag={flag} currentVersion={currentVersion} />
            ))}
          </ul>
        </section>
      ) : null}
      {groups.closed.length > 0 ? (
        <section aria-label={copy.closedGroup} className="grid gap-2.5">
          <h3 className="mt-2 text-[12.5px] font-semibold text-muted-foreground">
            {copy.closedGroup} {groups.closed.length}
          </h3>
          <ul className="grid gap-2.5">
            {groups.closed.map((flag) => (
              <ClosedFlag key={flag.id} flag={flag} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
