import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardHeader,
  CardTitle,
  deadlineSoonDays,
  EmptyState,
  formatDate,
  Icon,
  useToast,
} from '@adili/ui';
import { InformationCircleIcon, SquareLock02Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { LeaRequest, Outcome } from '../../../server/access/types';
import { decideLea } from '../../../server/lea-requests';
import { Page } from '../../page';
import { DecisionForm } from '../decision/decision-form';
import { scopeText } from '../format';
import { messages as m } from './messages';

function Value({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[14.5px] break-words">{children}</dd>
    </div>
  );
}

/** What the officer decides on, beside the form: the agency, why, about whom, for what. */
function RequestContext({ request }: { request: LeaRequest }) {
  return (
    <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="context-title">
      <CardHeader className="border-b px-5 py-4">
        <CardTitle id="context-title">{m.requestTitle}</CardTitle>
      </CardHeader>
      <dl className="grid gap-3.5 px-5 py-4.5">
        <Value term={m.agency}>
          <span className="font-medium">{request.agency.name}</span>
          <span className="block text-[13px] text-muted-foreground">
            {m.agencyLine(request.officer.name, request.caseReference)}
          </span>
        </Value>
        <Value term={m.reason}>
          <span className="leading-relaxed whitespace-pre-line">{request.reason}</span>
        </Value>
        <Value term={m.officer}>
          {request.resolvedName ? (
            <span className="font-medium">{request.resolvedName}</span>
          ) : (
            <span className="text-muted-foreground">
              {request.officerSought.name} · {m.notIdentified}
            </span>
          )}
        </Value>
        <Value term={m.scopeRequested}>{scopeText(request.scope)}</Value>
      </dl>
    </Card>
  );
}

/**
 * Deciding a law enforcement request (spec 10 FE-6, S11), with #260's decision form: grant (the
 * requested scope, the package to the officer, the declarant told after) or deny with Regulation
 * 24 grounds and reasons sent to the agency, as the prototype offers. A verified request can be
 * either; a received one only denied (an officer who cannot be identified, an account no longer
 * active). The supervisor, and a decided request, get a short explanation instead.
 */
export function LeaDecidePage({ request, readOnly }: { request: LeaRequest; readOnly: boolean }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { toast } = useToast();

  if (readOnly || request.decision || request.status === 'withdrawn') {
    const decided = request.decision;
    return (
      <Page narrow>
        <EmptyState
          icon={<Icon icon={readOnly ? ViewIcon : SquareLock02Icon} />}
          title={readOnly ? m.readOnlyTitle : m.decidedTitle}
          description={
            readOnly
              ? m.readOnlyText
              : decided
                ? m.decidedText(decided.decidedBy.name, formatDate(decided.decidedAt))
                : undefined
          }
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/access/lea-requests/$leaRequestId" params={{ leaRequestId: request.id }}>
                {m.backToRequest}
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const verified = request.status === 'verified';
  const outcomes: readonly Outcome[] = verified ? ['grant', 'deny'] : ['deny'];
  // Reloaded on the way back: the request may have moved on (decided meanwhile).
  const back = async () => {
    await navigate({
      to: '/access/lea-requests/$leaRequestId',
      params: { leaRequestId: request.id },
    });
    await router.invalidate();
  };

  return (
    <Page>
      <div className="mb-[22px] min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]">
          {m.decideTitle}
        </h1>
        <p className="mt-1 font-mono text-[13.5px] text-muted-foreground">{request.reference}</p>
      </div>
      <div className="grid items-start gap-4 min-[1080px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-4">
          {verified ? null : (
            <Alert role="status">
              <Icon icon={InformationCircleIcon} />
              <AlertDescription>{m.verifyFirst}</AlertDescription>
            </Alert>
          )}
          <DecisionForm
            requestedScope={request.scope}
            outcomes={outcomes}
            deadline={{ due: request.deadlineAt, soonDays: deadlineSoonDays.lawEnforcement }}
            reasonsHint={m.reasonsHint}
            finality={(outcome) => ({
              title: m.final,
              text: outcome === 'deny' ? m.finalityDeny(request.agency.code) : m.finalityGrant,
            })}
            packageRecipient={`${request.officer.name} (${request.agency.code})`}
            submit={(input, idempotencyKey) =>
              decideLea({ data: { requestId: request.id, input, idempotencyKey } })
            }
            onDecided={async () => {
              toast({ title: m.decidedRecorded(request.agency.code) });
              await back();
            }}
            onCancel={() => void back()}
            failureCopy={{
              notUnderDecision: { title: m.notVerifiedTitle, message: m.notVerified },
            }}
          />
        </div>
        <aside className="grid min-w-0 gap-4" aria-label={m.requestTitle}>
          <RequestContext request={request} />
        </aside>
      </div>
    </Page>
  );
}
