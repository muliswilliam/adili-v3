import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardHeader,
  CardTitle,
  formatDateTime,
  Icon,
  type IconProps,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from '@adili/ui';
import {
  ArrowDataTransferHorizontalIcon,
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ComputerIcon,
  Download04Icon,
  File01Icon,
  Flag02Icon,
  LinkSquare02Icon,
  Mail01Icon,
  Message01Icon,
  SentIcon,
  SquareLock02Icon,
  Tick02Icon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useCallback, useState } from 'react';

import { approvalPanel, evidenceLabel, referralPhase, referralTitle } from '../../referral/view';
import { getSupervisors, reassignToSupervisor } from '../../server/approvals';
import { getReferralPackageLink } from '../../server/referrals';
import type { DecisionResult } from '../../server/referrals.server';
import type { Assignee, Referral, ReferralManifestKind } from '../../server/review/types';
import { ReassignDialog, type ReassignTarget } from '../approvals/reassign-dialog';
import type { FailureText } from '../dialog-parts';
import { downloadFrom } from '../download';
import { Page } from '../page';
import { usePollWhile } from '../use-poll-while';
import { ConfidentialBadge, GroundsBadge, ReferralStatusBadge } from './badges';
import {
  ApproveReferralDialog,
  DeclineReferralDialog,
  type ReferralSubject,
} from './decision-dialogs';
import { messages as t } from './messages';
import { useReferralDecisions } from './use-referral-decisions';

export interface ReferralPageProps {
  referral: Referral;
  viewer: Assignee;
  supervisor: boolean;
  /** The viewer's Commission, for the supervisors a referral can be reassigned to. */
  slug: string;
  /** A fresh Idempotency-Key per approval; tests fix it. */
  newKey?: () => string;
}

/** Reload every 2 seconds while the package is assembled, at most 15 times. */
const POLL_MS = 2_000;
const POLL_TIMES = 15;

const EVIDENCE_ICON: Record<ReferralManifestKind, IconProps['icon']> = {
  'declaration-version': File01Icon,
  'declaration-attachment': Attachment01Icon,
  flag: Flag02Icon,
  clarification: Message01Icon,
  'clarification-attachment': Attachment01Icon,
  obligation: Calendar03Icon,
  letter: Mail01Icon,
};

/** An evidence item: what it is, and its case's reference beside a flag. */
function EvidenceText({ kind, reference }: { kind: ReferralManifestKind; reference: string }) {
  const { text, detail } = evidenceLabel(kind, reference);
  // A reference reads in mono; a name (a flag's finding, an obligation) as text.
  const named = text !== reference;
  return (
    <>
      <span className={named ? '' : 'font-mono text-[13px] break-all'}>{text}</span>
      {detail ? (
        <span className="ml-2 font-mono text-[12.5px] whitespace-nowrap text-muted-foreground">
          {detail}
        </span>
      ) : null}
    </>
  );
}

/**
 * Why review refused the viewer a decision after the page loaded, and which decision: the panel
 * then says so in that decision's words (approve or decline) and offers no decision again.
 */
interface Refused {
  reason: 'proposer' | 'reviewer-of-record' | 'role';
  decision: 'approve' | 'decline';
}

/**
 * One referral to EACC (spec 08 FE-6; S12, S13): its status, grounds and classification, that
 * the declarant is not told, the grounds and who proposed them (or the system sweep), the
 * evidence it rests on, and its evidence package: what it will include before approval, the
 * manifest with a SHA-256 per item once sent. Beside it, the approval: Approve and send or
 * Decline for a supervisor who may decide it, why not for anyone else, and once decided who did
 * and when. After approval the page reloads until the package is assembled and sent.
 */
export function ReferralPage({
  referral,
  viewer,
  supervisor,
  slug,
  newKey = () => crypto.randomUUID(),
}: ReferralPageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [approving, setApproving] = useState<ReferralSubject | null>(null);
  const [declining, setDeclining] = useState<ReferralSubject | null>(null);
  const [reassigning, setReassigning] = useState<ReassignTarget | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [downloading, setDownloading] = useState(false);
  const decisions = useReferralDecisions(referral.id, newKey);
  const phase = referralPhase(referral);
  const poll = usePollWhile(phase === 'assembling', POLL_MS, POLL_TIMES);
  const evidence = referral.evidence ?? [];
  const subject: ReferralSubject = {
    id: referral.id,
    declarantName: referral.declarantName,
    grounds: referral.grounds,
    // The cover sheet lists every item, then itself.
    evidenceItems: evidence.length + 1,
  };
  const panel = refused ? 'refused' : approvalPanel(referral, viewer, supervisor);
  const loadSupervisors = useCallback(() => getSupervisors({ data: { slug } }), [slug]);

  /** Settles a decision: a refusal by the rule says why on the page; another's decision reloads. */
  async function settle(
    result: DecisionResult,
    success: (data: Referral) => string,
    decision: Refused['decision'],
  ): Promise<FailureText | null> {
    if (result.ok) {
      setApproving(null);
      setDeclining(null);
      toast({ title: success(result.data) });
      await router.invalidate();
      return null;
    }
    if (result.refusal) {
      setApproving(null);
      setDeclining(null);
      const { refusal } = result;
      if (refusal.kind === 'not-proposed') {
        toast({ title: t.toasts.decided, urgency: 'assertive' });
      } else {
        setRefused({
          reason: refusal.kind === 'separation-of-duties' ? refusal.reason : 'role',
          decision,
        });
      }
      await router.invalidate();
      return null;
    }
    if (result.error.kind === 'unauthenticated') return { title: t.toasts.sessionEnded };
    return { title: t.toasts.failed };
  }

  async function approve(): Promise<FailureText | null> {
    return settle(
      await decisions.approve(),
      (data) => t.toasts.approved(data.reference),
      'approve',
    );
  }

  async function decline(_: ReferralSubject, note: string): Promise<FailureText | null> {
    return settle(await decisions.decline(note), () => t.toasts.declined, 'decline');
  }

  async function reassign(target: ReassignTarget, to: Assignee): Promise<FailureText | null> {
    const result = await reassignToSupervisor({
      data: { kind: 'referral', subjectId: target.subjectId, toSupervisor: to.subject },
    });
    if (result.ok) {
      setReassigning(null);
      toast({ title: `Reassigned to ${result.data.reassignedTo.name}` });
      return null;
    }
    if (result.error.kind === 'unauthenticated') return { title: t.toasts.sessionEnded };
    return { title: t.toasts.failed };
  }

  async function download() {
    setDownloading(true);
    const result = await getReferralPackageLink({ data: { referralId: referral.id } }).catch(
      () => ({ ok: false }) as const,
    );
    setDownloading(false);
    if (result.ok) downloadFrom(result.data.downloadUrl);
    else toast({ title: t.detail.downloadFailed, urgency: 'assertive' });
  }

  return (
    <Page>
      <header className="mb-4 grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ReferralStatusBadge referral={referral} />
          <GroundsBadge grounds={referral.grounds} />
          <ConfidentialBadge />
        </div>
        <h1 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.02em]">
          {referralTitle(referral)}
        </h1>
        <p className="text-[15px] text-muted-foreground">
          {t.detail.subtitle(referral.declarantName, referral.personnelFileNumber)}
        </p>
      </header>

      <Alert variant="neutral" role="note" className="mb-4">
        <Icon icon={ViewOffSlashIcon} />
        <AlertDescription>{t.notTold}</AlertDescription>
      </Alert>

      <div className="grid items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-4">
          <Section
            title={t.detail.groundsTitle}
            aside={
              <span className="inline-flex items-center gap-1.5">
                {referral.proposerKind === 'system' ? (
                  <Icon icon={ComputerIcon} className="size-3.5" />
                ) : null}
                {t.detail.proposedBy(referral.proposer?.name ?? t.systemSweep, referral.proposedAt)}
              </span>
            }
          >
            <p className="px-5 py-4 text-[15px] leading-relaxed whitespace-pre-line">
              {referral.narrative}
            </p>
          </Section>

          <Section title={t.detail.evidenceTitle}>
            {evidence.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">{t.detail.noEvidence}</p>
            ) : (
              <ul className="divide-y px-5">
                {evidence.map((each, index) => (
                  <li
                    // Evidence comes in the package's order and is never reordered.
                    key={index}
                    className="flex items-start gap-3 py-3 text-[14.5px]"
                  >
                    <Icon
                      icon={EVIDENCE_ICON[each.kind]}
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{t.evidence[each.kind]}</span>{' '}
                      <EvidenceText kind={each.kind} reference={each.reference} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <PackageCard
            referral={referral}
            downloading={downloading}
            onDownload={() => void download()}
          />

          {referral.caseId ? (
            <div>
              <Button asChild variant="secondary" size="sm">
                <Link to="/review/cases/$caseId" params={{ caseId: referral.caseId }}>
                  <Icon icon={LinkSquare02Icon} />
                  {t.detail.openCase}
                </Link>
              </Button>
            </div>
          ) : null}
        </div>

        <Section title={t.detail.approvalTitle} aside={<ReferralStatusBadge referral={referral} />}>
          <div className="grid gap-3 px-5 py-4">
            <ApprovalBody
              referral={referral}
              panel={panel}
              refused={refused}
              exhausted={poll.exhausted}
              onCheckAgain={poll.restart}
              onApprove={() => {
                setApproving(subject);
              }}
              onDecline={() => {
                setDeclining(subject);
              }}
              onReassign={
                supervisor
                  ? () => {
                      setReassigning({
                        kind: 'referral',
                        subjectId: referral.id,
                        subject: `${referral.declarantName} · ${t.grounds[referral.grounds]}`,
                        proposer: referral.proposer,
                        current: null,
                      });
                    }
                  : null
              }
            />
          </div>
        </Section>
      </div>

      <ApproveReferralDialog
        subject={approving}
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
        onConfirm={approve}
      />
      <DeclineReferralDialog
        subject={declining}
        onOpenChange={(open) => {
          if (!open) setDeclining(null);
        }}
        onConfirm={decline}
      />
      <ReassignDialog
        key={reassigning?.subjectId ?? 'closed'}
        target={reassigning}
        onOpenChange={(open) => {
          if (!open) setReassigning(null);
        }}
        loadSupervisors={loadSupervisors}
        onConfirm={reassign}
      />
    </Page>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 p-0 sm:p-0">
      <CardHeader className="flex-row items-center gap-2.5 border-b px-5 py-4">
        <CardTitle className="text-base">{title}</CardTitle>
        {aside ? <div className="ml-auto text-[13.5px] text-muted-foreground">{aside}</div> : null}
      </CardHeader>
      {children}
    </Card>
  );
}

/** The approval card's content for where the referral stands and what the viewer may do. */
function ApprovalBody({
  referral,
  panel,
  refused,
  exhausted,
  onCheckAgain,
  onApprove,
  onDecline,
  onReassign,
}: {
  referral: Referral;
  panel: ReturnType<typeof approvalPanel> | 'refused';
  refused: Refused | null;
  exhausted: boolean;
  onCheckAgain: () => void;
  onApprove: () => void;
  onDecline: () => void;
  /** Null for a reviewer, who cannot reassign. */
  onReassign: (() => void) | null;
}) {
  if (panel === 'decide') {
    return (
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={onApprove}>
          <Icon icon={Tick02Icon} />
          {t.detail.approve}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDecline}>
          <Icon icon={Cancel01Icon} />
          {t.detail.decline}
        </Button>
      </div>
    );
  }
  if (panel !== 'decided') {
    const reason = refused
      ? t.refused[refused.decision][refused.reason]
      : panel === 'role'
        ? t.detail.role
        : t.detail.proposer;
    const role = refused ? refused.reason === 'role' : panel === 'role';
    return (
      <>
        <Alert variant="warning" role="status">
          <Icon icon={SquareLock02Icon} />
          <AlertTitle>{reason}</AlertTitle>
        </Alert>
        {onReassign && !role ? (
          <Button size="sm" variant="secondary" className="w-full" onClick={onReassign}>
            <Icon icon={ArrowDataTransferHorizontalIcon} />
            {t.detail.reassign}
          </Button>
        ) : null}
      </>
    );
  }
  const phase = referralPhase(referral);
  if (phase === 'declined') {
    return (
      <dl className="grid gap-3 text-[14.5px]">
        <Fact term={t.detail.declinedBy}>
          {referral.declinedBy && referral.declinedAt
            ? t.detail.when(referral.declinedBy.name, referral.declinedAt)
            : null}
        </Fact>
        {referral.declineNote ? (
          <Fact term={t.detail.note}>
            <span className="font-normal whitespace-pre-line">{referral.declineNote}</span>
          </Fact>
        ) : null}
      </dl>
    );
  }
  const approver = referral.approver?.name ?? '';
  if (phase === 'assembling') {
    return (
      <div className="grid gap-2.5">
        <p role="status" className="flex items-start gap-2.5 text-[14.5px]">
          <Spinner className="mt-0.5 shrink-0" />
          {t.detail.assembling(approver)}
        </p>
        {exhausted ? (
          <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
            {t.detail.stillAssembling}
            <Button size="sm" variant="secondary" onClick={onCheckAgain}>
              {t.detail.checkAgain}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <dl className="grid gap-3 text-[14.5px]">
      <Fact term={t.detail.approvedBy}>
        {referral.approvedAt ? t.detail.when(approver, referral.approvedAt) : approver}
      </Fact>
      {referral.sentAt ? (
        <div className="flex items-start gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-subtle text-success">
            <Icon icon={SentIcon} className="size-3.5" />
          </span>
          <div>
            <dt className="font-medium">{t.detail.sentToEacc}</dt>
            <dd className="text-[13px] text-muted-foreground">{formatDateTime(referral.sentAt)}</dd>
          </div>
        </div>
      ) : null}
    </dl>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

/**
 * The evidence package: what it will include while proposed, its items while it is assembled,
 * the manifest with each item's SHA-256 and the download once sent, or nothing when declined.
 */
function PackageCard({
  referral,
  downloading,
  onDownload,
}: {
  referral: Referral;
  downloading: boolean;
  onDownload: () => void;
}) {
  const phase = referralPhase(referral);
  if (phase === 'declined') {
    return (
      <Section title={t.detail.packageTitle}>
        <p className="px-5 py-4 text-sm text-muted-foreground">{t.detail.packageNone}</p>
      </Section>
    );
  }
  const pack = referral.package;
  const rows = pack
    ? pack.manifest.map(
        (each): { kind: ReferralManifestKind; reference: string; sha256: string | null } => each,
      )
    : (referral.evidence ?? []).map((each) => ({ ...each, sha256: null }));
  return (
    <Section title={t.detail.packageTitle}>
      {pack ? null : (
        <p className="px-5 pt-4 pb-3 text-sm text-muted-foreground">
          {phase === 'assembling' ? t.detail.packageAssembling : t.detail.packagePreview}
        </p>
      )}
      <Table caption={t.detail.packageTitle} className="[&_caption]:sr-only">
        <TableHeader>
          <TableRow>
            <TableHead>{t.detail.item}</TableHead>
            <TableHead>{t.detail.reference}</TableHead>
            {pack ? <TableHead>{t.detail.hash}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((each, index) => (
            // The manifest's order is the package's; rows are never reordered.
            <TableRow key={index}>
              <TableCell>{t.manifest[each.kind]}</TableCell>
              <TableCell>
                <EvidenceText kind={each.kind} reference={each.reference} />
              </TableCell>
              {pack ? (
                <TableCell
                  className="max-w-[180px] truncate font-mono text-[12px] text-muted-foreground"
                  title={each.sha256 ?? undefined}
                >
                  {each.sha256}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          <TableRow>
            <TableCell>{t.detail.coverSheet}</TableCell>
            <TableCell className="font-mono text-[13px]">
              {referral.reference ?? (
                <span className="font-sans text-muted-foreground">{t.detail.rflOnApproval}</span>
              )}
            </TableCell>
            {pack ? <TableCell /> : null}
          </TableRow>
        </TableBody>
      </Table>
      {pack ? (
        <div className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
          <span className="text-[13px] text-muted-foreground">
            {t.detail.verificationId}{' '}
            <span className="font-mono text-foreground">{pack.verificationId}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            disabled={downloading}
            onClick={onDownload}
          >
            {downloading ? <Spinner /> : <Icon icon={Download04Icon} />}
            {t.detail.download}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
