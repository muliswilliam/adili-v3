import {
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
import { SquareLock02Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { decideAccessRequest } from '../../server/access-requests';
import type { OfficerRequestView } from '../../server/access/types';
import { Page } from '../page';
import { DecisionForm } from './decision/decision-form';
import { messages as d } from './decision/messages';
import { scopeText } from './decision/scope-text';
import { formKOf } from './form-k-card';
import { RepresentationsCard } from './side-cards';

function Value({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[14.5px] break-words">{children}</dd>
    </div>
  );
}

/** What the officer decides on, beside the form: who asks, why, about whom, for what. */
function RequestContext({ view }: { view: OfficerRequestView }) {
  const form = formKOf(view);
  return (
    <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="context-title">
      <CardHeader className="border-b px-5 py-4">
        <CardTitle id="context-title">{d.requestTitle}</CardTitle>
      </CardHeader>
      <dl className="grid gap-3.5 px-5 py-4.5">
        <Value term={d.applicant}>
          <span className="font-medium">{form.partI.name}</span>
          <span className="block text-[13px] text-muted-foreground">{form.partI.occupation}</span>
        </Value>
        <Value term={d.reason}>
          <span className="leading-relaxed whitespace-pre-line">{form.partIII.reason}</span>
        </Value>
        <Value term={d.officer}>
          <span className="font-medium">{view.resolvedName ?? form.partII.name}</span>
        </Value>
        <Value term={d.scopeRequested}>{scopeText(form.scope)}</Value>
      </dl>
    </Card>
  );
}

function BackToRequest({ requestId }: { requestId: string }) {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link to="/access/requests/$requestId" params={{ requestId }}>
        {d.backToRequest}
      </Link>
    </Button>
  );
}

/**
 * "Decide" on a Form K request (spec 10 S6, #260): the decision form beside the request it
 * decides and the declarant's representations. The supervisor, and a request that is not under
 * decision, get a short explanation instead.
 */
export function DecidePage({ view, readOnly }: { view: OfficerRequestView; readOnly: boolean }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { toast } = useToast();
  const form = formKOf(view);

  if (readOnly || view.status !== 'under-decision') {
    const decided = view.decision;
    return (
      <Page narrow>
        <EmptyState
          icon={<Icon icon={readOnly ? ViewIcon : SquareLock02Icon} />}
          title={readOnly ? d.readOnlyTitle : decided ? d.decidedTitle : d.notUnderDecisionTitle}
          description={
            readOnly
              ? d.readOnlyText
              : decided
                ? d.decidedText(decided.decidedBy.name, formatDate(decided.decidedAt))
                : d.notReadyText
          }
          action={<BackToRequest requestId={view.id} />}
        />
      </Page>
    );
  }

  // Reloaded on the way back: the request may have moved on (decided by someone else, closed).
  const back = async () => {
    await navigate({ to: '/access/requests/$requestId', params: { requestId: view.id } });
    await router.invalidate();
  };

  return (
    <Page>
      <div className="mb-[22px] min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]">
          {d.decideTitle}
        </h1>
        <p className="mt-1 font-mono text-[13.5px] text-muted-foreground">{view.reference}</p>
      </div>
      <div className="grid items-start gap-4 min-[1080px]:grid-cols-[minmax(0,1fr)_380px]">
        <DecisionForm
          requestedScope={form.scope}
          clarifications
          deadline={{ due: view.decisionDeadlineAt, soonDays: deadlineSoonDays.decision }}
          reasonsHint={d.reasonsToBoth}
          finality={() => ({ title: d.finalToBoth })}
          packageRecipient={form.partI.name}
          submit={(input, idempotencyKey) =>
            decideAccessRequest({ data: { requestId: view.id, input, idempotencyKey } })
          }
          onDecided={async () => {
            toast({ title: d.recorded });
            await back();
          }}
          onCancel={() => void back()}
        />
        <aside className="grid min-w-0 gap-4" aria-label={d.contextLabel}>
          <RequestContext view={view} />
          <RepresentationsCard view={view} />
        </aside>
      </div>
    </Page>
  );
}
