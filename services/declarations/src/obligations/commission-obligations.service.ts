import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import {
  and,
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
import type { Transaction } from './apply-page.js';
import {
  BIENNIAL_CYCLE_KEY,
  decodeListCursor,
  encodeListCursor,
  type ListCommissionObligationsQuery,
  type SummaryQuery,
} from './commission-query.js';
import { addDays, atMonthDay, nairobiDate } from './dates.js';
import type { ObligationStatus, ObligationType } from './engine.js';
import {
  COMMISSION_STAFF_ROLES,
  obligationColumns,
  PLATFORM_ADMIN,
  PLATFORM_TENANT,
  toObligation,
} from './obligations.service.js';
import type {
  CommissionSummary,
  NationalSummary,
  ObligationPage,
  StatusCounts,
  SummaryCycle,
} from './representation.js';
import {
  commissionRefs,
  cycleCalendar,
  filingObligations,
  rosterSnapshots,
  tenantPolicyCache,
} from './schema.js';

/** EACC's roles: counts of any Commission, never officers. */
export const EACC_ROLES = ['eacc-analyst', 'eacc-supervisor'] as const;

/** The statutory biennial dates, for a Commission whose policy has not been pulled yet. */
const STATUTORY_BIENNIAL = { statementDate: '11-01', dueDate: '12-31' } as const;

const SLUG = /^[a-z][a-z0-9]{1,19}$/;

const OPEN_STATUSES = ['upcoming', 'due', 'overdue'] as const;

/** Statuses a summary counts: every one but `cancelled`. */
type CountedStatus = Exclude<ObligationStatus, 'cancelled'>;
const COUNTED_STATUSES = ['upcoming', 'due', 'overdue', 'filed'] as const;

/** Ranks overdue obligations before the rest, the list's first ordering key. */
const overdueRank = sql<number>`(case when ${filingObligations.status} = 'overdue' then 0 else 1 end)`;

/**
 * A Commission's obligations as its staff and EACC see them (spec 04): counts per cycle, and the
 * officers and their obligations. Commission staff read their own Commission (another is 404),
 * platform admins any; EACC reads any Commission's counts but no officer (the controller's roles
 * answer 403).
 */
@Injectable()
export class CommissionObligationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly clock: Clock,
  ) {}

  /**
   * Counts by type and status for a cycle (the current one by default) and the officers due or
   * overdue who have not onboarded, in one aggregate query. A Commission the service has no
   * obligations for yet gets zeros.
   */
  async summary(
    principal: Principal,
    slug: string,
    query: SummaryQuery,
  ): Promise<CommissionSummary> {
    const tenant = readTenant(principal, slug, { counts: true });
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [reference] = await tx
        .select({ issuerCode: commissionRefs.issuerCode, name: commissionRefs.name })
        .from(commissionRefs)
        .where(eq(commissionRefs.slug, slug));
      const [cached] = await tx
        .select({ policy: tenantPolicyCache.policy })
        .from(tenantPolicyCache)
        .where(eq(tenantPolicyCache.tenant, slug));
      const biennial = cached?.policy.biennial ?? STATUTORY_BIENNIAL;
      const year = await this.cycleYear(tx, query.cycle, biennial);

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
        ) as officers
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
      const issuerCode = reference?.issuerCode ?? slug.toUpperCase();
      return {
        commission: { slug, issuerCode, name: reference?.name ?? issuerCode },
        cycle: cycleOf(year, biennial),
        total,
        byType,
        notOnboarded,
      };
    });
  }

  /**
   * One page of the Commission's obligations with their officers, overdue first then by due
   * date, filtered and searched, in one query. Cancelled obligations only when asked for by
   * status.
   */
  async list(
    principal: Principal,
    slug: string,
    query: ListCommissionObligationsQuery,
  ): Promise<ObligationPage> {
    const tenant = readTenant(principal, slug, { counts: false });
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
      const rows = await tx
        .select({
          ...obligationColumns,
          rank: overdueRank,
          personnelFileNumber: rosterSnapshots.personnelFileNumber,
          fullName: rosterSnapshots.fullName,
          personId: rosterSnapshots.personId,
          ofr: rosterSnapshots.ofr,
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
          officer: {
            rosterRecordId: row.rosterRecordId,
            personnelFileNumber: row.personnelFileNumber,
            fullName: row.fullName,
            onboarded: row.personId !== null,
            ofr: row.ofr,
          },
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
   * biennial dates), the officers due or overdue who have not onboarded and the Commission's
   * last roster import, with totals, in one aggregate query. For EACC and platform admins (the
   * controller's roles); no officer data.
   */
  async national(principal: Principal, query: SummaryQuery): Promise<NationalSummary> {
    return withTenant(
      this.db,
      { tenant: PLATFORM_TENANT, subject: principal.subject },
      async (tx) => {
        const year = await this.cycleYear(tx, query.cycle, STATUTORY_BIENNIAL);
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
        return { cycle: `biennial:${String(year)}`, commissions, totals };
      },
    );
  }

  /**
   * The asked-for cycle's year, or the current cycle's: the latest one opened by today, or the
   * first of the calendar while none has opened.
   */
  private async cycleYear(
    tx: Transaction,
    cycle: string | undefined,
    biennial: { statementDate: string; dueDate: string },
  ): Promise<number> {
    const asked = cycle === undefined ? undefined : BIENNIAL_CYCLE_KEY.exec(cycle)?.[1];
    if (asked !== undefined) return Number(asked);
    const calendar = await tx.select().from(cycleCalendar).orderBy(asc(cycleCalendar.cycleYear));
    const today = nairobiDate(this.clock.now());
    const opened = calendar.filter(
      (entry) =>
        addDays(atMonthDay(entry.cycleYear, biennial.statementDate), -entry.openingLeadDays) <=
        today,
    );
    const current = opened.at(-1) ?? calendar[0];
    return current?.cycleYear ?? Number(today.slice(0, 4));
  }
}

/**
 * The `app.tenant` a caller reads Commission `slug`'s obligations under: the platform for
 * platform admins (and EACC, for counts), the Commission itself for its own staff. 404 for
 * anyone else, so another Commission's obligations cannot be probed.
 */
function readTenant(principal: Principal, slug: string, { counts }: { counts: boolean }): string {
  if (!SLUG.test(slug)) notFoundIfInvisible(null);
  const holds = (roles: readonly string[]) => principal.roles.some((role) => roles.includes(role));
  if (holds([PLATFORM_ADMIN])) return PLATFORM_TENANT;
  if (counts && holds(EACC_ROLES)) return PLATFORM_TENANT;
  return notFoundIfInvisible(
    holds(COMMISSION_STAFF_ROLES) && principal.tenant === slug ? slug : null,
  );
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
    (${eq(type, 'biennial')} and ${eq(cycleKey, `biennial:${String(year)}`)})
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
  biennial: { statementDate: string; dueDate: string },
): SummaryCycle {
  return {
    key: `biennial:${String(year)}`,
    statementDate: atMonthDay(year, biennial.statementDate),
    dueDate: atMonthDay(year, biennial.dueDate),
  };
}

export function zeroCounts(): StatusCounts {
  return { upcoming: 0, due: 0, overdue: 0, filed: 0 };
}
