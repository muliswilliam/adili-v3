import { randomUUID } from 'node:crypto';

import type { FormMV1 } from '@adili/forms';
import { vi } from 'vitest';

import {
  actionEvent,
  clarificationEvent,
  declarationSubmitted,
  obligationCreated,
  obligationStatusChanged,
} from './events.js';
import type { Caller, ReportingApi } from './reporting-api.js';

export const SUPERVISOR: Caller = {
  sub: 'supervisor-psc',
  tenant: 'psc',
  roles: ['supervisor'],
  name: 'Grace Wanjiru',
};
export const COMMISSION_ADMIN: Caller = {
  sub: 'admin-psc',
  tenant: 'psc',
  roles: ['commission-admin'],
  name: 'Peter Otieno',
};
export const REPORTING_OFFICER: Caller = {
  sub: 'officer-psc',
  tenant: 'psc',
  roles: ['reporting-officer'],
};

/** `caller` after the step-up re-authentication at `at` (an ISO instant). */
export function steppedUp(caller: Caller, at: string): Caller {
  return { ...caller, acr: 'step-up', authTime: at };
}

/** An officer who did not declare on time, with the details declarations holds. */
export interface NonFiler {
  obligationId: string;
  name: string;
  designation: string;
  fileNumber: string;
  date: string;
}

/** The S2 fixture's facts, and the ids and names tests look for. */
export interface Fy2027Facts {
  initial: { noticed: NonFiler; recent: NonFiler };
  biennial: { compliedLate: NonFiler; silent: NonFiler[] };
  final: { silent: NonFiler };
  clarifications: { clarificationId: string; status: string }[];
  /** Every name and file number the fixture gives declarations and review. */
  personalData: string[];
}

let sequence = 0;

function nonFiler(date: string, designation = 'Senior Officer'): NonFiler {
  sequence += 1;
  const n = String(sequence).padStart(4, '0');
  return {
    obligationId: randomUUID(),
    name: `Officer ${n} Kamau`,
    designation,
    fileNumber: `PSC/2019/${n}`,
    date,
  };
}

/**
 * Commission `psc`, FY 2027 (S2): 12 appointed (10 declared on time; one on notice to comply,
 * one appointed in June and not yet due at year end); 100 in service in the 2027 cycle (95 on
 * time; one filed late after a notice, four silent); 4 exited (3 final
 * declarations); 6 clarifications; the 2 actions. Declarations and review know the officers
 * and clarifications by id.
 */
export async function givenFy2027Facts(api: ReportingApi): Promise<Fy2027Facts> {
  const t = (date: string, time = '09:00:00') => `${date}T${time}.000Z`;
  const filedOnTime = async (type: 'initial' | 'biennial' | 'final', statementDate: string) => {
    const obligationId = randomUUID();
    await api.deliver(obligationCreated('psc', { obligationId, type, statementDate }));
    await api.deliver(declarationSubmitted('psc', obligationId, t(statementDate, '12:00:00')));
    await api.deliver(
      obligationStatusChanged('psc', obligationId, 'due', 'filed', t(statementDate, '12:00:01')),
    );
  };
  const unfiled = async (
    type: 'initial' | 'biennial' | 'final',
    officer: NonFiler,
    statementDate: string,
    dueDate?: string,
  ) => {
    await api.deliver(
      obligationCreated('psc', {
        obligationId: officer.obligationId,
        type,
        statementDate,
        dueDate,
      }),
    );
  };

  for (let i = 0; i < 10; i += 1) await filedOnTime('initial', '2027-09-01');
  const noticed = nonFiler('2027-08-01');
  await unfiled('initial', noticed, '2027-08-01');
  const recent = nonFiler('2028-06-20');
  await unfiled('initial', recent, '2028-06-20', '2028-07-20');

  for (let i = 0; i < 95; i += 1) await filedOnTime('biennial', '2027-11-01');
  const compliedLate = nonFiler('2015-03-01');
  const silent = [
    nonFiler('2012-01-15'),
    nonFiler('2018-05-05'),
    nonFiler('2020-02-02'),
    nonFiler('2021-10-10'),
  ];
  for (const officer of [compliedLate, ...silent]) {
    await unfiled('biennial', officer, '2027-11-01', '2027-12-31');
  }
  await api.deliver(
    declarationSubmitted('psc', compliedLate.obligationId, t('2028-02-10'), { late: true }),
  );

  for (let i = 0; i < 3; i += 1) await filedOnTime('final', '2028-01-15');
  const exited = nonFiler('2028-02-28', 'Director');
  await unfiled('final', exited, '2028-02-28');

  // The two actions: a notice on the new appointee, a notice on the late biennial filer that
  // ended when they filed.
  const notice = {
    actionId: randomUUID(),
    subjectId: noticed.obligationId,
    step: 'notice-to-comply',
  } as const;
  await api.deliver(actionEvent('psc', 'proposed', notice, t('2027-10-05')));
  await api.deliver(actionEvent('psc', 'approved', notice, t('2027-10-06')));
  await api.deliver(actionEvent('psc', 'issued', notice, t('2027-10-06', '09:05:00')));
  const lateNotice = {
    actionId: randomUUID(),
    subjectId: compliedLate.obligationId,
    step: 'notice-to-comply',
  } as const;
  await api.deliver(actionEvent('psc', 'issued', lateNotice, t('2028-01-15')));
  await api.deliver(actionEvent('psc', 'complied', lateNotice, t('2028-02-10')));

  const statuses = ['issued', 'responded', 'resolved', 'overdue', 'withdrawn', 'resolved'] as const;
  const clarifications: Fy2027Facts['clarifications'] = [];
  const personalData: string[] = [];
  for (const [i, status] of statuses.entries()) {
    const ids = { clarificationId: randomUUID(), caseId: randomUUID() };
    const issuedAt = t(`2027-12-${String(10 + i)}`);
    await api.deliver(clarificationEvent('psc', 'issued', ids, issuedAt));
    if (status === 'resolved') {
      await api.deliver(clarificationEvent('psc', 'responded', ids, t('2028-01-20')));
    }
    if (status !== 'issued') {
      await api.deliver(clarificationEvent('psc', status, ids, t('2028-01-21')));
    }
    const name = `Declarant ${String(i)} Achieng`;
    const identifier = `PSC/2010/${String(700 + i)}`;
    api.review.given('psc', {
      clarificationId: ids.clarificationId,
      reference: `CLR-PSC-2027-000000${String(i + 1)}-4`,
      name,
      designation: 'Accountant',
      identifier,
      requirementLabels: ['Source of income', 'Land acquired'],
    });
    personalData.push(name, identifier);
    clarifications.push({ clarificationId: ids.clarificationId, status });
  }

  const officers = [noticed, recent, compliedLate, ...silent, exited];
  api.declarations.given(
    'psc',
    ...officers.map((officer) => ({
      obligationId: officer.obligationId,
      name: officer.name,
      designation: officer.designation,
      fileNumber: officer.fileNumber,
      appointmentDate: officer === exited ? '2001-04-01' : officer.date,
      exitDate: officer === exited ? officer.date : null,
    })),
  );
  personalData.push(...officers.flatMap((officer) => [officer.name, officer.fileNumber]));

  return {
    initial: { noticed, recent },
    biennial: { compliedLate, silent },
    final: { silent: exited },
    clarifications,
    personalData,
  };
}

/** The Commission, its supervisor and commission-admin as the directory knows them. */
export function givenPscDirectory(api: ReportingApi): void {
  api.directory.givenCommission('psc');
  api.directory.givenStaff('psc', 'supervisor', 'supervisor-psc', 'supervisor@psc.go.ke');
  api.directory.givenStaff('psc', 'commission-admin', 'admin-psc', 'admin@psc.go.ke');
  api.directory.givenStaff('psc', 'reporting-officer', 'officer-psc', 'officer@psc.go.ke');
}

/** Waits until the year's report holds a draft compiled after `after`; returns the report body. */
export async function compiledReport(
  api: ReportingApi,
  fy: number,
  after = new Date(0),
): Promise<ReportBody> {
  return vi.waitFor(
    async () => {
      const response = await api.get(
        `/v1/commissions/psc/compliance-reports/${String(fy)}`,
        SUPERVISOR,
      );
      const body = response.json<ReportBody>();
      if (
        body.status !== 'draft' ||
        body.compiledAt === null ||
        new Date(body.compiledAt) <= after
      ) {
        throw new Error(`not compiled yet: ${response.body}`);
      }
      return body;
    },
    { timeout: 45_000, interval: 250 },
  );
}

export interface ReportBody {
  id: string;
  status: string;
  compiledAt: string | null;
  counts: Record<string, unknown>;
  document: FormMV1 | null;
  [key: string]: unknown;
}
