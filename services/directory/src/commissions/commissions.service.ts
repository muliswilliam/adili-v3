import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, asc, count, eq, ilike, isNull, ne, or, type SQL, sql } from 'drizzle-orm';

import type { DirectorySchema } from '../db/schema.js';
import { canSeeCommission, seesAllCommissions, tenantContextOf } from './access.js';
import { decodeCursor, encodeCursor, type ListCommissionsQuery } from './list-query.js';
import {
  type Commission,
  type CommissionPage,
  NO_ROSTER,
  type OfficerCategory,
} from './representation.js';
import {
  commissionCategories,
  commissions,
  officerCategories,
  reportingOfficerAssignments,
  tenantPolicyVersions,
} from './schema.js';

type Transaction = Parameters<Parameters<Database<DirectorySchema>['transaction']>[0]>[0];

/** The current assignment: at most one per Commission is not `replaced`. */
const currentAssignment = and(
  eq(reportingOfficerAssignments.commissionId, commissions.id),
  ne(reportingOfficerAssignments.state, 'replaced'),
);

const commissionColumns = {
  id: commissions.id,
  slug: commissions.slug,
  name: commissions.name,
  type: commissions.type,
  status: commissions.status,
  createdAt: commissions.createdAt,
  categories: sql<OfficerCategory[]>`coalesce((
    select json_agg(json_build_object(
      'code', ${officerCategories.code},
      'citation', ${officerCategories.citation},
      'description', ${officerCategories.description}
    ) order by ${officerCategories.sortOrder})
    from ${commissionCategories}
    join ${officerCategories} on ${officerCategories.code} = ${commissionCategories.categoryCode}
    where ${commissionCategories.commissionId} = ${commissions.id}
  ), '[]'::json)`,
  policyVersion: sql<number>`coalesce((
    select max(${tenantPolicyVersions.version}) from ${tenantPolicyVersions}
    where ${tenantPolicyVersions.tenant} = ${commissions.slug}
  ), 0)::int`,
  officer: {
    id: reportingOfficerAssignments.id,
    name: reportingOfficerAssignments.name,
    email: reportingOfficerAssignments.email,
    phone: reportingOfficerAssignments.phone,
    state: reportingOfficerAssignments.state,
    invitedAt: reportingOfficerAssignments.invitedAt,
    activatedAt: reportingOfficerAssignments.activatedAt,
  },
};

/**
 * Reads of Responsible Commissions with the spec 01 visibility rule: national readers see every
 * Commission, other staff only their own tenant's; anything invisible is 404.
 */
@Injectable()
export class CommissionsService {
  constructor(@InjectDatabase() private readonly db: Database<DirectorySchema>) {}

  /** One page ordered by name, plus the number of Commissions matching the filters. */
  async list(principal: Principal, query: ListCommissionsQuery): Promise<CommissionPage> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (after === null) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: [{ path: 'cursor', message: 'Unknown cursor; start again from the first page' }],
      });
    }
    const filters = and(...this.filtersFor(principal, query));

    return withTenant(this.db, tenantContextOf(principal), async (tx) => {
      const rows = await this.select(tx)
        .where(
          and(
            filters,
            after
              ? sql`(${commissions.name}, ${commissions.id}) > (${after.name}, ${after.id})`
              : undefined,
          ),
        )
        .orderBy(asc(commissions.name), asc(commissions.id))
        .limit(query.limit + 1);
      const [{ total } = { total: 0 }] = await tx
        .select({ total: count() })
        .from(commissions)
        .leftJoin(reportingOfficerAssignments, currentAssignment)
        .where(filters);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toCommission),
        nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
        total,
      };
    });
  }

  async get(principal: Principal, slug: string): Promise<Commission> {
    const row = canSeeCommission(principal, slug)
      ? await withTenant(this.db, tenantContextOf(principal), async (tx) => {
          const [found] = await this.select(tx).where(eq(commissions.slug, slug)).limit(1);
          return found;
        })
      : undefined;
    return toCommission(notFoundIfInvisible(row));
  }

  async listOfficerCategories(): Promise<OfficerCategory[]> {
    return this.db
      .select({
        code: officerCategories.code,
        citation: officerCategories.citation,
        description: officerCategories.description,
      })
      .from(officerCategories)
      .orderBy(asc(officerCategories.sortOrder));
  }

  private select(tx: Transaction) {
    return tx
      .select(commissionColumns)
      .from(commissions)
      .leftJoin(reportingOfficerAssignments, currentAssignment);
  }

  private filtersFor(principal: Principal, query: ListCommissionsQuery): (SQL | undefined)[] {
    const filters: (SQL | undefined)[] = [];
    if (!seesAllCommissions(principal)) {
      filters.push(eq(commissions.slug, principal.tenant ?? ''));
    }
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      filters.push(or(ilike(commissions.name, pattern), ilike(commissions.slug, pattern)));
    }
    if (query.type) {
      filters.push(eq(commissions.type, query.type));
    }
    if (query.reportingOfficer === 'none') {
      filters.push(isNull(reportingOfficerAssignments.id));
    } else if (query.reportingOfficer) {
      filters.push(eq(reportingOfficerAssignments.state, query.reportingOfficer));
    }
    return filters;
  }
}

type CommissionRow = Awaited<
  ReturnType<ReturnType<CommissionsService['select']>['execute']>
>[number];

function toCommission(row: CommissionRow): Commission {
  const { officer } = row;
  return {
    id: row.id,
    slug: row.slug,
    issuerCode: row.slug.toUpperCase(),
    name: row.name,
    type: row.type,
    categories: row.categories,
    status: row.status,
    policyVersion: row.policyVersion,
    reportingOfficer: officer
      ? {
          id: officer.id,
          name: officer.name,
          email: officer.email,
          phone: officer.phone,
          state: officer.state,
          invitedAt: officer.invitedAt.toISOString(),
          activatedAt: officer.activatedAt?.toISOString() ?? null,
        }
      : null,
    roster: NO_ROSTER,
    createdAt: row.createdAt.toISOString(),
  };
}
