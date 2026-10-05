import { formatLongDate, formatPhone, formatScopeSections, formatScopeYears } from '@adili/ui';
import type { ReactNode } from 'react';

import type { OfficerRequestView } from '../../server/access/types';
import { scopePeople } from './format';
import { messages as m } from './messages';
import { StatusBadge } from './queue-list';

/** Desktop reading layout for the submitted Form K. The mobile form remains in FormKCard. */
export function FormKDesktop({ view }: { view: OfficerRequestView }) {
  const { partI, partII, partIII, scope } = view.formK;
  return (
    <article className="hidden min-w-0 min-[1200px]:mx-auto min-[1200px]:block min-[1200px]:w-full min-[1200px]:max-w-[720px] min-[1200px]:px-6 min-[1200px]:pt-8 min-[1200px]:pb-6">
      <h1 className="text-lg font-semibold tracking-tight">{view.reference}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {partI.name} · {partI.occupation}
      </p>

      <div className="mt-8 space-y-6 text-sm">
        <section>
          <h2 className="font-semibold">Seeking declaration(s) made by</h2>
          <p className="mt-2 text-secondary-foreground">{view.resolvedName ?? partII.name}</p>
        </section>
        <section>
          <h2 className="font-semibold">Specific information requested</h2>
          <p className="mt-2 whitespace-pre-line text-secondary-foreground">
            {partIII.informationSought}
          </p>
          <dl className="mt-3 grid grid-cols-[104px_minmax(0,1fr)] gap-x-2 gap-y-2">
            <dt className="text-muted-foreground">{m.sections}</dt>
            <dd>{formatScopeSections(scope)}</dd>
            <dt className="text-muted-foreground">{m.people}</dt>
            <dd>{scopePeople(scope)}</dd>
            <dt className="text-muted-foreground">{m.years}</dt>
            <dd>{formatScopeYears(scope)}</dd>
            <dt className="text-muted-foreground">{m.clarifications}</dt>
            <dd>{scope.includeClarifications ? m.included : m.notIncluded}</dd>
          </dl>
        </section>
        <section>
          <h2 className="font-semibold">{m.reason}</h2>
          <p className="mt-2 whitespace-pre-line text-secondary-foreground">{partIII.reason}</p>
        </section>
        <section>
          <h2 className="font-semibold">{m.otherInformation}</h2>
          <p className="mt-2 whitespace-pre-line text-secondary-foreground">
            {partIII.otherInformation || (
              <span className="text-muted-foreground">{m.notGiven}</span>
            )}
          </p>
        </section>
      </div>
    </article>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[184px_minmax(0,1fr)] gap-2 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
}

/** Desktop properties rail, shown alongside the reading layout. */
export function FormKDesktopProperties({ view }: { view: OfficerRequestView }) {
  const { partI, partII } = view.formK;
  const document = partI.identityDocument;
  return (
    <div className="hidden min-w-0 min-[1200px]:block">
      <section className="border-b px-5 py-5" aria-label="Request properties">
        <h2 className="mb-2 text-sm font-semibold">Properties</h2>
        <dl>
          <Property label="Reference code">{view.reference}</Property>
          <Property label="Requested on">{formatLongDate(view.submittedAt)}</Property>
          <Property label="Deadline">{formatLongDate(view.decisionDeadlineAt)}</Property>
          <Property label={m.columnStatus}>
            <StatusBadge status={view.status} />
          </Property>
        </dl>
      </section>
      <section className="border-b px-5 py-5" aria-label="Officer sought">
        <h2 className="mb-2 text-sm font-semibold">{m.columnOfficer}</h2>
        <dl>
          <Property label={m.name}>{view.resolvedName ?? partII.name}</Property>
          <Property label={m.entity}>{partII.entity}</Property>
          <Property label={m.workStation}>{partII.workStation || m.notGiven}</Property>
          <Property label={m.personnelFileNumber}>
            {view.resolvedFileNumber ?? partII.personnelFileNumber ?? m.notGiven}
          </Property>
        </dl>
      </section>
      <section className="px-5 py-5" aria-label="Applicant details">
        <h2 className="mb-2 text-sm font-semibold">Applicant details</h2>
        <dl>
          <Property label={m.name}>{partI.name}</Property>
          <Property label={m.identity}>
            {document.kind === 'passport'
              ? m.passport(document.number, document.country ?? '')
              : m.nationalId(document.number)}
          </Property>
          <Property label="Identity check">
            {view.applicantIdentityStatus === 'pending-verification'
              ? m.pendingVerification
              : document.kind === 'passport'
                ? m.verifiedByOfficer
                : m.iprsMatch}
          </Property>
          <Property label={m.telephone}>{formatPhone(partI.telephone)}</Property>
          <Property label={m.email}>{partI.email}</Property>
          <Property label={m.occupation}>{partI.occupation}</Property>
          <Property label={m.physicalAddress}>{partI.physicalAddress}</Property>
          <Property label={m.postalAddress}>{partI.postalAddress}</Property>
        </dl>
      </section>
    </div>
  );
}
