import { HttpStatus, Injectable } from '@nestjs/common';
import {
  notFoundIfInvisible,
  PLATFORM_TENANT,
  type Principal,
  ProblemException,
} from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import {
  and,
  type AnyColumn,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { loadCalendar } from './apply-page.js';
import { commissionReadTenant, fallbackIssuerCode } from './access.js';
import {
  decodeListCursor,
  encodeListCursor,
  type ListCommissionObligationsQuery,
  type SummaryQuery,
} from './commission-query.js';
import { addDays, atMonthDay, nairobiDate } from './dates.js';
import { OPEN_STATUSES, type ObligationStatus, type ObligationType } from './engine.js';
import { biennialCycleKey, biennialYear } from './cycle-key.js';
import { obligationColumns, toObligation } from './obligations.service.js';
import type {
  CommissionSummary,
  NationalSummary,
  ObligationPage,
  Reminder,
  StatusCounts,
  SummaryCycle,
} from './representation.js';
import {
  commissionRefs,
  cycleOpenings,
  filingObligations,
  obligationReminders,
  type ReminderChannel,
  type ReminderOutcome,
  rosterSnapshots,
  tenantPolicyCache,
} from './schema.js';

/** A policy's biennial statement and due dates, as month-days. */
interface MonthDays {
  statementDate: string;
  dueDate: string;
}

/** The statutory biennial dates, for a Commission whose policy has not been pulled yet. */
const STATUTORY_BIENNIAL: MonthDays = { statementDate: '11-01', dueDate: '12-31' };

/**
 * The opening lead named for a cycle the calendar does not list (spec 04's default). Such a cycle
 * never opens by date: the engine creates obligations only for calendar cycles.
 */
const UNLISTED_OPENING_LEAD_DAYS = 120;

/** Statuses a summary counts: every one but `cancelled`. */
type CountedStatus = Exclude<ObligationStatus, 'cancelled'>;
const COUNTED_STATUSES = [...OPEN_STATUSES, 'filed'] as const satisfies readonly CountedStatus[];

/** An obligation's latest reminder (by scheduled time) as JSON, times in epoch milliseconds. */
interface LastReminderRow {
  offsetDays: number;
  scheduledAt: number;
  sentAt: number | null;
  channels: ReminderChannel[];
  outcome: ReminderOutcome;
}

const epochMs = (column: AnyColumn) => sql`floor(extract(epoch from ${column}) * 1000)::bigint`;

const lastReminderColumn = sql<LastReminderRow | null>`(
  select json_build_object(
    'offsetDays', ${obligationReminders.offsetDays},
    'scheduledAt', ${epochMs(obligationReminders.scheduledAt)},
    'sentAt', ${epochMs(obligationReminders.sentAt)},
    'channels', ${obligationReminders.channels},
    'outcome', ${obligationReminders.outcome}
  )
  from ${obligationReminders}
  where ${obligationReminders.obligationId} = ${filingObligations.id}
  order by ${obligationReminders.scheduledAt} desc, ${obligationReminders.offsetDays} asc
  limit 1
)`;

function toReminder(row: LastReminderRow | null): Reminder | null {
  if (row === null) return null;
  return {
    offsetDays: row.offsetDays,
    scheduledAt: new Date(row.scheduledAt).toISOString(),
    sentAt: row.sentAt === null ? null : new Date(row.sentAt).toISOString(),
    channels: row.channels,
    outcome: row.outcome,
  };
}

/** Ranks overdue obligations before the rest, the list's first ordering key. */
const overdueRank = sql<number>`(case when ${filingObligations.status} = 'overdue' then 0 else 1 end)`;

/**
 * A Commission's obligations as its staff and EACC see them (spec 04): counts per cycle, and the
 * declarants and their obligations. Commission staff read their own Commission (another is 404),
 * platform admins any; EACC reads any Commission's counts but no declarant (the controller's roles
 * answer 403).
 */
@Injectable()
export class CommissionObligationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly clock: Clock,
  ) {}

  /**
   * Counts by type and status for a cycle (the current one by default) and the declarants due or
   * overdue who have not onboarded, in one aggregate query. A Commission the service has no
   * obligations for yet gets zeros; a slug that names no Commission is 404 for callers reading
   * across Commissions (EACC, platform admins).
   */
  async summary(
    principal: Principal,
    slug: string,
    query: SummaryQuery,
  ): Promise<CommissionSummary> {
    const tenant = commissionReadTenant(principal, slug, { counts: true });
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [reference] = await tx
        .select({ issuerCode: commissionRefs.issuerCode, name: commissionRefs.name })
        .from(commissionRefs)
        .where(eq(commissionRefs.slug, slug));
      // Staff reading their own Commission know it exists, even before the read model has it.
      // Readers across Commissions get 404 for a Commission the read model lacks: see
      // `knownCommission` for when a real one can be missing.
      if (tenant === PLATFORM_TENANT) notFoundIfInvisible(reference);
      const [cached] = await tx
        .select({ policy: tenantPolicyCache.policy })
        .from(tenantPolicyCache)
        .where(eq(tenantPolicyCache.tenant, slug));
      const biennial = cached?.policy.biennial ?? STATUTORY_BIENNIAL;
      const { counted, cycles } = await this.cycles(tx, {
        asked: query.cycle,
        biennial,
        tenant: slug,
      });
      const year = Number(counted.statementDate.slice(0, 4));

      const rows = await tx.execute<{
        kind: 'count' | 'not-onboarded';
        type: ObligationType | null;
        status: CountedStatus;
        n: number;
      }>(sql`
        with scoped as (
          select ${filingObligations.rosterRecordId} as roster_record_id,
                 ${filingObligations.type} as type,
                 ${filingObligations.status} as status,
                 ${filingObligations.personId} as person_id
          from ${filingObligations}
          where ${and(eq(filingObligations.tenant, slug), inCycle(year))}
        )
        select 'count' as kind, type, status, count(*)::int as n
        from scoped group by type, status
        union all
        select 'not-onboarded', null, worst, count(*)::int
        from (
          select case when bool_or(status = 'overdue') then 'overdue' else 'due' end as worst
          from scoped
          where person_id is null and status in ('due', 'overdue')
          group by roster_record_id
        ) as declarants
        group by worst`);

      const byType = {
        initial: zeroCounts(),
        biennial: zeroCounts(),
        final: zeroCounts(),
      };
      const total = zeroCounts();
      const notOnboarded = { due: 0, overdue: 0 };
      for (const row of rows.rows) {
        if (row.kind === 'not-onboarded') {
          if (row.status === 'due' || row.status === 'overdue') notOnboarded[row.status] = row.n;
        } else if (row.type !== null) {
          byType[row.type][row.status] = row.n;
          total[row.status] += row.n;
        }
      }
      const issuerCode = reference?.issuerCode ?? fallbackIssuerCode(slug);
      return {
        commission: { slug, issuerCode, name: reference?.name ?? issuerCode },
        cycle: counted,
        cycles,
        total,
        byType,
        notOnboarded,
      };
    });
  }

  /**
   * One page of the Commission's obligations with their declarants, overdue first then by due
   * date, filtered and searched, in one query. Cancelled obligations only when asked for by
   * status.
   */
  async list(
    principal: Principal,
    slug: string,
    query: ListCommissionObligationsQuery,
  ): Promise<ObligationPage> {
    const tenant = commissionReadTenant(principal, slug);
    const after = query.cursor === undefined ? undefined : decodeListCursor(query.cursor);
    if (after === null) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: [{ path: 'cursor', message: 'Unknown cursor; start again from the first page' }],
      });
    }

    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      if (tenant === PLATFORM_TENANT) await knownCommission(tx, slug);
      const rows = await tx
        .select({
          ...obligationColumns,
          rank: overdueRank,
          personnelFileNumber: rosterSnapshots.personnelFileNumber,
          fullName: rosterSnapshots.fullName,
          personId: rosterSnapshots.personId,
          ofr: rosterSnapshots.ofr,
          lastReminder: lastReminderColumn,
        })
        .from(filingObligations)
        .innerJoin(
          rosterSnapshots,
          eq(rosterSnapshots.rosterRecordId, filingObligations.rosterRecordId),
        )
        .leftJoin(commissionRefs, eq(commissionRefs.slug, filingObligations.tenant))
        .where(
          and(
            eq(filingObligations.tenant, slug),
            ...listFilters(query),
            after
              ? sql`(${overdueRank}, ${filingObligations.dueDate}, ${filingObligations.id}) > (${after.rank}, ${after.dueDate}::date, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(overdueRank, asc(filingObligations.dueDate), asc(filingObligations.id))
        .limit(query.limit + 1);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({
          ...toObligation(row),
          declarant: {
            rosterRecordId: row.rosterRecordId,
            personnelFileNumber: row.personnelFileNumber,
            fullName: row.fullName,
            onboarded: row.personId !== null,
            ofr: row.ofr,
          },
          lastReminder: toReminder(row.lastReminder),
        })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeListCursor({
                rank: last.rank === 0 ? 0 : 1,
                dueDate: last.dueDate,
                id: last.id,
              })
            : null,
      };
    });
  }

  /**
   * Every Commission's counts for a cycle (the current one by default, under the statutory
   * biennial dates), the declarants due or overdue who have not onboarded and the Commission's
   * last roster import, with totals, in one aggregate query. For EACC and platform admins (the
   * controller's roles); no declarant data.
   */
  async national(principal: Principal, query: SummaryQuery): Promise<NationalSummary> {
    return withTenant(
      this.db,
      { tenant: PLATFORM_TENANT, subject: principal.subject },
      async (tx) => {
        const { counted } = await this.cycles(tx, {
          asked: query.cycle,
          biennial: STATUTORY_BIENNIAL,
        });
        const year = Number(counted.statementDate.slice(0, 4));
        const rows = await tx.execute<{
          slug: string;
          issuer_code: string;
          name: string;
          last_roster_import_at: Date | string | null;
          upcoming: number;
          due: number;
          overdue: number;
          filed: number;
          not_onboarded: number;
        }>(sql`
        with scoped as (
          select ${filingObligations.tenant} as tenant,
                 ${filingObligations.rosterRecordId} as roster_record_id,
                 ${filingObligations.status} as status,
                 ${filingObligations.personId} as person_id
          from ${filingObligations}
          where ${inCycle(year)}
        ),
        counts as (
          select tenant,
                 count(*) filter (where status = 'upcoming')::int as upcoming,
                 count(*) filter (where status = 'due')::int as due,
                 count(*) filter (where status = 'overdue')::int as overdue,
                 count(*) filter (where status = 'filed')::int as filed,
                 count(distinct roster_record_id)
                   filter (where person_id is null and status in ('due', 'overdue'))::int
                   as not_onboarded
          from scoped
          group by tenant
        )
        select ${commissionRefs.slug} as slug,
               ${commissionRefs.issuerCode} as issuer_code,
               ${commissionRefs.name} as name,
               ${commissionRefs.lastRosterImportAt} as last_roster_import_at,
               coalesce(counts.upcoming, 0)::int as upcoming,
               coalesce(counts.due, 0)::int as due,
               coalesce(counts.overdue, 0)::int as overdue,
               coalesce(counts.filed, 0)::int as filed,
               coalesce(counts.not_onboarded, 0)::int as not_onboarded
        from ${commissionRefs}
        left join counts on counts.tenant = ${commissionRefs.slug}
        order by ${commissionRefs.name}, ${commissionRefs.slug}`);

        const totals = zeroCounts();
        const commissions = rows.rows.map((row) => {
          const total = {
            upcoming: row.upcoming,
            due: row.due,
            overdue: row.overdue,
            filed: row.filed,
          };
          for (const status of COUNTED_STATUSES) totals[status] += total[status];
          return {
            commission: { slug: row.slug, issuerCode: row.issuer_code, name: row.name },
            total,
            notOnboarded: row.not_onboarded,
            lastRosterImportAt:
              row.last_roster_import_at === null
                ? null
                : new Date(row.last_roster_import_at).toISOString(),
          };
        });
        return { cycle: counted, commissions, totals };
      },
    );
  }

  /**
   * The calendar's cycles under `biennial` dates, oldest first, and the one counted: the asked-for
   * cycle, or the current one (the latest opened, or the first of the calendar while none has).
   * A cycle has opened once its opening day has come (Africa/Nairobi) or its biennials were created
   * (a `cycle_openings` row of `tenant`, or of any Commission for the national summary).
   */
  private async cycles(
    tx: Transaction,
    {
      asked,
      biennial,
      tenant,
    }: { asked: string | undefined; biennial: MonthDays; tenant?: string },
  ): Promise<{ counted: SummaryCycle; cycles: SummaryCycle[] }> {
    const calendar = await loadCalendar(tx);
    const openings = await tx
      .selectDistinct({ cycleYear: cycleOpenings.cycleYear })
      .from(cycleOpenings)
      .where(tenant === undefined ? undefined : eq(cycleOpenings.tenant, tenant));
    const openedYears = new Set(openings.map((row) => row.cycleYear));
    const today = nairobiDate(this.clock.now());
    /** `listed`: whether the calendar has the cycle, so that it opens by date. */
    const cycleIn = (year: number, openingLeadDays: number, listed = true): SummaryCycle => {
      const dates = cycleOf(year, biennial);
      const opensOn = addDays(dates.statementDate, -openingLeadDays);
      return { ...dates, opensOn, opened: (listed && opensOn <= today) || openedYears.has(year) };
    };
    const cycles = calendar.map((entry) => cycleIn(entry.cycleYear, entry.openingLeadDays));

    const askedYear = asked === undefined ? null : biennialYear(asked);
    if (askedYear !== null) {
      const key = biennialCycleKey(askedYear);
      const counted =
        cycles.find((entry) => entry.key === key) ??
        cycleIn(askedYear, UNLISTED_OPENING_LEAD_DAYS, false);
      return { counted, cycles };
    }
    const counted =
      cycles.filter((entry) => entry.opened).at(-1) ??
      cycles[0] ??
      cycleIn(Number(today.slice(0, 4)), UNLISTED_OPENING_LEAD_DAYS, false);
    return { counted, cycles };
  }
}

/**
 * 404 unless the read model has the Commission `slug` (a read across Commissions of a slug). A
 * real Commission can be missing for a while: one created before the service consumed
 * `commission.created.v1`, until the start-up pull of every Commission (`CommissionRefs`, retried
 * every minute while the directory is down) succeeds. EACC and platform admins get 404 for it
 * meanwhile; its own staff are not checked against the read model.
 */
async function knownCommission(tx: Transaction, slug: string): Promise<void> {
  const [reference] = await tx
    .select({ slug: commissionRefs.slug })
    .from(commissionRefs)
    .where(eq(commissionRefs.slug, slug));
  notFoundIfInvisible(reference);
}

/**
 * The obligations a cycle's counts cover: its biennials, and every open initial and final
 * obligation, plus those filed that fell due in the cycle's two years (so filed ones do not pile
 * up in every later cycle). Cancelled ones never count.
 */
export function inCycle(year: number): SQL {
  const { type, status, cycleKey, dueDate } = filingObligations;
  const cycleYears = sql`${dueDate} between ${`${String(year - 1)}-01-01`}::date and ${`${String(year)}-12-31`}::date`;
  return sql`${inArray(status, [...COUNTED_STATUSES])} and (
    (${eq(type, 'biennial')} and ${eq(cycleKey, biennialCycleKey(year))})
    or (${ne(type, 'biennial')} and (${inArray(status, [...OPEN_STATUSES])} or ${cycleYears}))
  )`;
}

function listFilters(query: ListCommissionObligationsQuery): (SQL | undefined)[] {
  const filters: (SQL | undefined)[] = [
    query.status === undefined
      ? ne(filingObligations.status, 'cancelled')
      : eq(filingObligations.status, query.status),
  ];
  if (query.type) filters.push(eq(filingObligations.type, query.type));
  if (query.cycle) filters.push(eq(filingObligations.cycleKey, query.cycle));
  if (query.onboarded !== undefined) {
    filters.push(
      query.onboarded ? isNotNull(rosterSnapshots.personId) : isNull(rosterSnapshots.personId),
    );
  }
  if (query.search) {
    const escaped = query.search.replace(/[\\%_]/g, (char) => `\\${char}`);
    filters.push(
      or(
        like(sql`lower(${rosterSnapshots.personnelFileNumber})`, `${escaped.toLowerCase()}%`),
        ilike(rosterSnapshots.fullName, `%${escaped}%`),
      ),
    );
  }
  return filters;
}

/** A biennial cycle's key and dates under the policy's month-days. */
export function cycleOf(
  year: number,
  biennial: MonthDays,
): Pick<SummaryCycle, 'key' | 'statementDate' | 'dueDate'> {
  return {
    key: biennialCycleKey(year),
    statementDate: atMonthDay(year, biennial.statementDate),
    dueDate: atMonthDay(year, biennial.dueDate),
  };
}

export function zeroCounts(): StatusCounts {
  return { upcoming: 0, due: 0, overdue: 0, filed: 0 };
}
