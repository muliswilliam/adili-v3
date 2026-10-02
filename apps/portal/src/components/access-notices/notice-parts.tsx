import { Badge, cn, focusRingInset, formatDate, Icon, IconTile } from '@adili/ui';
import { ArrowRight01Icon, Clock01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';

import { NOTICES_COPY as COPY } from '../../access/notice-copy';
import {
  daysLeft,
  leaTitle,
  noticeState,
  type NoticeState,
  scopeLine,
  STATE_META,
  windowOpen,
} from '../../access/notices';
import type { DeclarantNotice } from '../../server/access/types';

/** Where a request stands for the declarant, as a badge in its tone. */
export function NoticeStateBadge({ state }: { state: NoticeState }) {
  const meta = STATE_META[state];
  return (
    <Badge variant={meta.tone} data-state={state}>
      <Icon icon={meta.icon} strokeWidth={2.2} />
      {meta.label}
    </Badge>
  );
}

/** "Respond by 29 Sep 2026 · 3 days left", red on the last day. */
export function WindowChip({ notice, now }: { notice: DeclarantNotice; now: string }) {
  if (!notice.windowEndsAt) return null;
  const left = daysLeft(notice, now);
  const date = formatDate(notice.windowEndsAt);
  return (
    <Badge variant={left <= 1 ? 'destructive' : 'warning'}>
      <Icon icon={Clock01Icon} strokeWidth={2.2} />
      {notice.representations ? COPY.editUntil(date) : COPY.respondBy(date)} · {COPY.left(left)}
    </Badge>
  );
}

function rowTitle(notice: DeclarantNotice, open: boolean): string {
  if (notice.kind === 'lea') return leaTitle(notice);
  return open ? COPY.someone : COPY.from(notice.applicantName);
}

function dateLine(notice: DeclarantNotice): string {
  return notice.decision
    ? COPY.decidedOn(formatDate(notice.decision.decidedAt))
    : COPY.notifiedOn(formatDate(notice.notifiedAt));
}

/**
 * One request in the Access requests card or list. While the window is open it says someone
 * has requested access, with the applicant, the purpose in general terms, the scope and when to
 * respond by; afterwards, who asked and where it stands.
 */
export function NoticeRow({ notice, now }: { notice: DeclarantNotice; now: string }) {
  const state = noticeState(notice, now);
  const open = windowOpen(notice, now);
  const meta = STATE_META[state];
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        to="/access/notices/$id"
        params={{ id: notice.requestId }}
        aria-label={COPY.openRequest(notice.reference)}
        className={cn(focusRingInset, 'flex items-start gap-4 px-5 py-4 hover:bg-muted/60 sm:px-6')}
      >
        <IconTile tone={open && !notice.representations ? 'warning' : meta.tone} aria-hidden="true">
          <Icon icon={meta.icon} />
        </IconTile>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[15px] leading-snug font-semibold">{rowTitle(notice, open)}</span>
          <span className="truncate text-[13px] text-muted-foreground">
            <span className="font-mono">{notice.reference}</span>
            {notice.kind === 'form-k' && open ? ` · ${notice.applicantName}` : null}
            {notice.kind === 'form-k' && !open ? ` · ${dateLine(notice)}` : null}
          </span>
          {notice.kind === 'form-k' && open ? (
            <span className="text-[13px] break-words text-secondary-foreground">
              {notice.purposeInGeneralTerms}
            </span>
          ) : null}
          {notice.kind === 'form-k' ? (
            <span className="text-[13px] text-muted-foreground">{scopeLine(notice.scope)}</span>
          ) : null}
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {open && !notice.representations ? null : <NoticeStateBadge state={state} />}
            {open ? <WindowChip notice={notice} now={now} /> : null}
          </span>
        </span>
        <Icon
          icon={ArrowRight01Icon}
          className="mt-3 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
