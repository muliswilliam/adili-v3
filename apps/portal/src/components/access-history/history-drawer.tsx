import {
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  formatDate,
  formatDateTime,
  Icon,
  RegisterTimeline,
  Spinner,
} from '@adili/ui';
import { Download01Icon, SquareLock01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { HISTORY_COPY as COPY } from '../../access/history-copy';
import { entriesOfSubject, toRegisterEntry } from '../../access/history';
import { STANCES } from '../../access/notice-copy';
import { needsResponse, noticeState, scopeLine } from '../../access/notices';
import type { AccessHistoryEntry, DeclarantNotice } from '../../server/access/types';
import { NoticeStateBadge } from '../access-notices/notice-parts';
import { GroundsList } from '../access/request-parts';
import type { CertifiedCopies } from '../certified-copies/use-certified-copies';

/**
 * A Who accessed entry opened: the access request (who asked, why, for what, the declarant's
 * response and the decision), the law-enforcement grant, or the certified copy, with the
 * request's own timeline and what the declarant can do next (respond, open the request,
 * download the copy).
 */
export function HistoryDrawer({
  entry,
  all,
  notices,
  now,
  copies,
  onClose,
}: {
  entry: AccessHistoryEntry | null;
  all: AccessHistoryEntry[];
  notices: DeclarantNotice[];
  now: string;
  copies: CertifiedCopies;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {entry ? (
        entry.subjectKind === 'self-access' ? (
          <CopyContent entry={entry} copies={copies} />
        ) : (
          <RequestContent
            entry={entry}
            all={all}
            notices={notices}
            notice={notices.find((notice) => notice.requestId === entry.subjectId) ?? null}
            now={now}
          />
        )
      ) : null}
    </Drawer>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid gap-3.5">{children}</dl>;
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="text-[15px] font-medium break-words">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-[13.5px] font-normal text-muted-foreground">{children}</span>;
}

function RequestContent({
  entry,
  all,
  notices,
  notice,
  now,
}: {
  entry: AccessHistoryEntry;
  all: AccessHistoryEntry[];
  notices: DeclarantNotice[];
  notice: DeclarantNotice | null;
  now: string;
}) {
  const lea = entry.subjectKind === 'lea-request';
  const timeline = entriesOfSubject(entry, all).map((each) => toRegisterEntry(each, all, notices));
  const waiting = notice !== null && needsResponse(notice, now);
  return (
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>{lea ? COPY.leaRequest : COPY.accessRequest}</DrawerTitle>
        <DrawerDescription>
          <span className="font-mono text-[12.5px]">{entry.reference}</span> ·{' '}
          {entry.commission.name}
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody>
        {lea ? (
          <LeaFacts entry={entry} notice={notice} />
        ) : (
          <FormKFacts entry={entry} notice={notice} now={now} />
        )}
        <section className="mt-1 grid gap-3">
          <h3 className="text-[15px] font-semibold">{COPY.timeline}</h3>
          <RegisterTimeline entries={timeline} label={COPY.timeline} />
        </section>
      </DrawerBody>
      {notice ? (
        <DrawerFooter>
          {waiting && notice.windowEndsAt ? (
            <Button asChild>
              <Link to="/access/notices/$id" params={{ id: notice.requestId }}>
                {COPY.respondBy(formatDate(notice.windowEndsAt))}
              </Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link to="/access/notices/$id" params={{ id: notice.requestId }}>
                {COPY.openRequest}
              </Link>
            </Button>
          )}
        </DrawerFooter>
      ) : null}
    </DrawerContent>
  );
}

function FormKFacts({
  entry,
  notice,
  now,
}: {
  entry: AccessHistoryEntry;
  notice: DeclarantNotice | null;
  now: string;
}) {
  if (!notice) {
    return (
      <Facts>
        <Fact term={COPY.applicantTerm}>{entry.requester ?? COPY.someone}</Fact>
      </Facts>
    );
  }
  const { decision, representations } = notice;
  const state = noticeState(notice, now);
  const waiting = state === 'awaiting' || state === 'saved';
  return (
    <Facts>
      <Fact term={COPY.applicantTerm}>{notice.applicantName}</Fact>
      <Fact term={COPY.purpose}>{notice.purposeInGeneralTerms}</Fact>
      <Fact term={COPY.scopeAsked}>{scopeLine(notice.scope)}</Fact>
      <Fact term={COPY.yourResponse}>
        {representations ? (
          <>
            {STANCES[representations.stance].done.en}{' '}
            <Muted>{formatDate(representations.submittedAt)}</Muted>
          </>
        ) : waiting && notice.windowEndsAt ? (
          COPY.dueBy(formatDate(notice.windowEndsAt))
        ) : (
          COPY.none
        )}
      </Fact>
      <Fact term={COPY.decision}>
        {waiting ? (
          COPY.notYet
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <NoticeStateBadge state={state} />
            {decision ? <Muted>{formatDate(decision.decidedAt)}</Muted> : null}
          </span>
        )}
      </Fact>
      {decision?.outcome === 'partial-grant' && decision.grantedScope ? (
        <Fact term={COPY.scopeGranted}>{scopeLine(decision.grantedScope)}</Fact>
      ) : null}
      {decision && decision.grounds.length > 0 ? (
        <Fact term={COPY.grounds}>
          <GroundsList grounds={decision.grounds} />
        </Fact>
      ) : null}
      {decision ? (
        <Fact term={COPY.reasons}>
          <span className="font-normal">{decision.reasons}</span>
        </Fact>
      ) : null}
    </Facts>
  );
}

function LeaFacts({
  entry,
  notice,
}: {
  entry: AccessHistoryEntry;
  notice: DeclarantNotice | null;
}) {
  const decided = entry.kind === 'decided' ? entry : null;
  const grantedAt = notice?.decision?.decidedAt ?? decided?.at ?? null;
  const scope = notice?.decision?.grantedScope ?? notice?.scope ?? null;
  return (
    <Facts>
      <Fact term={COPY.agencyTerm}>{entry.requester ?? COPY.someone}</Fact>
      {entry.caseReference ? (
        <Fact term={COPY.caseReference}>
          <span className="font-mono text-[14px]">{entry.caseReference}</span>
        </Fact>
      ) : null}
      {scope ? <Fact term={COPY.scopeGranted}>{scopeLine(scope)}</Fact> : null}
      <Fact term={COPY.decision}>
        <span className="inline-flex flex-wrap items-center gap-2">
          <NoticeStateBadge state="grant" />
          {grantedAt ? <Muted>{formatDate(grantedAt)}</Muted> : null}
        </span>
      </Fact>
    </Facts>
  );
}

function CopyContent({ entry, copies }: { entry: AccessHistoryEntry; copies: CertifiedCopies }) {
  const copy = entry.certifiedCopy;
  const documentId = copy?.documentId ?? null;
  const busy = documentId !== null && copies.downloading === documentId;
  return (
    <DrawerContent aria-describedby={undefined}>
      <DrawerHeader>
        <DrawerTitle>{COPY.certifiedCopy}</DrawerTitle>
      </DrawerHeader>
      <DrawerBody>
        <Facts>
          <Fact term={COPY.declaration}>
            {copy ? COPY.versionOf(copy.version) : null}
            <span className="block font-mono text-[12.5px] font-normal text-muted-foreground">
              {entry.reference}
            </span>
          </Fact>
          <Fact term={COPY.issued}>{formatDateTime(entry.at)}</Fact>
          <Fact term={COPY.obtainedBy}>
            {copy?.representativeName
              ? COPY.representativeOf(copy.representativeName)
              : COPY.youOnline}
          </Fact>
          <Fact term={COPY.commission}>{entry.commission.name}</Fact>
          <Fact term={COPY.classification}>
            <Badge>
              <Icon icon={SquareLock01Icon} strokeWidth={2.2} />
              {COPY.restricted}
            </Badge>
          </Fact>
        </Facts>
      </DrawerBody>
      {documentId ? (
        <DrawerFooter>
          <Button type="button" disabled={busy} onClick={() => void copies.download(documentId)}>
            {busy ? <Spinner /> : <Icon icon={Download01Icon} />}
            {COPY.download}
          </Button>
        </DrawerFooter>
      ) : null}
    </DrawerContent>
  );
}
