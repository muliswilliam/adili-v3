import type { FormKV1 } from '@adili/forms';
import { Badge, Card, CardHeader, CardTitle, formatDateTime, Icon } from '@adili/ui';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { OfficerRequestView } from '../../server/access/types';
import { scopePeople, scopeSections, scopeYears } from './format';
import { messages as m } from './messages';

/** The request's Form K as submitted. */
export function formKOf(view: Pick<OfficerRequestView, 'formK'>): FormKV1 {
  return view.formK;
}

export function Value({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[14.5px] font-medium break-words">{children}</dd>
    </div>
  );
}

export function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3.5 border-t px-5 py-4.5 first:border-t-0" aria-label={title}>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Grid({ columns = 3, children }: { columns?: 2 | 3; children: ReactNode }) {
  return (
    <dl
      className={
        columns === 3
          ? 'grid gap-x-6 gap-y-4 min-[560px]:grid-cols-2 min-[900px]:grid-cols-3'
          : 'grid gap-x-6 gap-y-4 min-[560px]:grid-cols-2'
      }
    >
      {children}
    </dl>
  );
}

export function Paragraph({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-[14.5px] leading-relaxed whitespace-pre-line">{children}</dd>
    </div>
  );
}

function IdentityBadge({ view, kind }: { view: OfficerRequestView; kind: string }) {
  if (view.applicantIdentityStatus === 'pending-verification') {
    return <Badge variant="warning">{m.pendingVerification}</Badge>;
  }
  return (
    <Badge variant="success">
      <Icon icon={Tick02Icon} strokeWidth={2.4} />
      {kind === 'passport' ? m.verifiedByOfficer : m.iprsMatch}
    </Badge>
  );
}

/**
 * Form K rendered by part (spec 10 FE-5): the applicant with how their identity was
 * established, the officer sought, the information and reasons, the scope asked for, and the
 * declaration of truth.
 */
export function FormKCard({ view }: { view: OfficerRequestView }) {
  const form = formKOf(view);
  const { partI, partII, partIII, scope } = form;
  const document = partI.identityDocument;
  return (
    <Card className="min-w-0 p-0 sm:p-0" role="region" aria-labelledby="form-k-title">
      <CardHeader className="flex-row flex-wrap items-center gap-2 border-b px-5 py-4">
        <CardTitle id="form-k-title">{m.formKTitle}</CardTitle>
        <span className="ml-auto text-[13px] text-muted-foreground">
          {m.declaredAt(formatDateTime(form.partIV.declaredAt))}
        </span>
      </CardHeader>
      <div>
        <Part title={m.partI}>
          <Grid>
            <Value term={m.name}>{partI.name}</Value>
            <Value term={m.identity}>
              {document.kind === 'passport'
                ? m.passport(document.number, document.country ?? '')
                : m.nationalId(document.number)}
              <div className="mt-1.5">
                <IdentityBadge view={view} kind={document.kind} />
              </div>
            </Value>
            <Value term={m.occupation}>{partI.occupation}</Value>
            <Value term={m.telephone}>{formatPhone(partI.telephone)}</Value>
            <Value term={m.email}>{partI.email}</Value>
            <Value term={m.postalAddress}>{partI.postalAddress}</Value>
            <Value term={m.physicalAddress}>{partI.physicalAddress}</Value>
          </Grid>
        </Part>
        <Part title={m.partII}>
          <Grid>
            <Value term={m.name}>{partII.name}</Value>
            <Value term={m.entity}>{partII.entity}</Value>
            <Value term={m.workStation}>{partII.workStation || <NotGiven />}</Value>
            <Value term={m.personnelFileNumber}>
              {partII.personnelFileNumber ? (
                <span className="font-mono text-[13.5px]">{partII.personnelFileNumber}</span>
              ) : (
                <NotGiven />
              )}
            </Value>
          </Grid>
        </Part>
        <Part title={m.partIII}>
          <dl className="grid gap-3.5">
            <Paragraph term={m.information}>{partIII.informationSought}</Paragraph>
            <Paragraph term={m.reason}>{partIII.reason}</Paragraph>
            {partIII.otherInformation ? (
              <Paragraph term={m.otherInformation}>{partIII.otherInformation}</Paragraph>
            ) : null}
          </dl>
        </Part>
        <Part title={m.scopeRequested}>
          <Grid columns={2}>
            <Value term={m.years}>{scopeYears(scope)}</Value>
            <Value term={m.people}>{scopePeople(scope)}</Value>
            <Value term={m.sections}>{scopeSections(scope)}</Value>
            <Value term={m.clarifications}>
              {scope.includeClarifications ? m.included : m.notIncluded}
            </Value>
          </Grid>
        </Part>
        <Part title={m.partIV}>
          <blockquote className="border-l-2 border-border pl-3.5 text-[14.5px] leading-relaxed text-secondary-foreground">
            {form.partIV.text}
          </blockquote>
        </Part>
      </div>
    </Card>
  );
}

export function NotGiven() {
  return <span className="font-normal text-muted-foreground">{m.notGiven}</span>;
}

/** `+254722418903` → `+254 722 418 903`; other countries' numbers as given. */
export function formatPhone(phone: string): string {
  const kenyan = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(phone);
  return kenyan ? `+254 ${kenyan[1]} ${kenyan[2]} ${kenyan[3]}` : phone;
}
