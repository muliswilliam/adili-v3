import { Alert, AlertDescription, AlertTitle, Card, formatDate, Icon } from '@adili/ui';
import { BanknoteIcon, LegalHammerIcon, Tick02Icon } from '@hugeicons/core-free-icons';

import { SALARY_COPY as S } from '../../notices/salary-copy';
import type { SalaryStanding } from '../../notices/salary';
import type { DeclarantNotice } from '../../server/review/types';
import { ComplyLink } from './notices-view';

/** The Commission as letters short-name it ("TSC"). */
const shortName = (notice: DeclarantNotice) => notice.commission.slug.toUpperCase();

/**
 * Where the declarant's salary stands, as a banner (spec 08 FE-7, #208; S7, S10, US 20): stopped
 * until they comply, with the way to comply; the disciplinary referral, the salary still stopped;
 * the reinstatement on its way to payroll, then confirmed.
 */
export function SalaryBanner({ standing }: { standing: SalaryStanding }) {
  const { notice } = standing;
  if (standing.kind === 'reinstated' || standing.kind === 'reinstating') {
    return (
      <Alert variant="success" role="status">
        <Icon icon={Tick02Icon} />
        <AlertTitle>
          {standing.kind === 'reinstated'
            ? S.reinstated(standing.at)
            : standing.complied
              ? S.reinstating.complied
              : S.reinstating.ended}
        </AlertTitle>
      </Alert>
    );
  }
  const disciplinary = standing.kind === 'disciplinary';
  return (
    <Alert variant="destructive" role="status">
      <Icon icon={disciplinary ? LegalHammerIcon : BanknoteIcon} />
      <AlertTitle>{disciplinary ? S.disciplinary(shortName(notice)) : S.stopped}</AlertTitle>
      <AlertDescription>
        <p>{disciplinary ? S.disciplinaryBody(notice.subject) : S.toComply(notice.subject)}</p>
        <div className="mt-2.5">
          <ComplyLink notice={notice} />
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * A salary stoppage notice's payroll facts (spec 08 FE-7, #208; S6, S7): when payroll stopped
 * the salary, the instruction's reference (the notice's ADM number), and the reinstatement:
 * automatic when they comply, on its way, or confirmed by payroll.
 */
export function SalaryCard({ notice }: { notice: DeclarantNotice }) {
  if (notice.step !== 'salary-stoppage' || notice.salaryStoppedAt === null) return null;
  const reinstatement = notice.salaryReinstatedAt
    ? S.card.confirmed(notice.salaryReinstatedAt)
    : notice.status === 'complied' || notice.status === 'cancelled'
      ? S.card.beingSent
      : S.card.whenYouComply;
  return (
    <Card className="p-0 sm:p-0">
      <section aria-labelledby="salary-card-title">
        <h2 id="salary-card-title" className="border-b px-5 py-4 text-base font-semibold">
          {S.card.title}
        </h2>
        <dl className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3">
          <Fact term={S.card.stoppedOn}>{formatDate(notice.salaryStoppedAt)}</Fact>
          <Fact term={S.card.instruction} mono>
            {notice.reference}
          </Fact>
          <Fact term={S.card.reinstatement}>{reinstatement}</Fact>
        </dl>
      </section>
    </Card>
  );
}

function Fact({
  term,
  mono = false,
  children,
}: {
  term: string;
  mono?: boolean;
  children: string;
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className={mono ? 'truncate font-mono text-[14px]' : 'text-[15px] font-medium'}>
        {children}
      </dd>
    </div>
  );
}
