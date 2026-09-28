import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, count, eq, ilike, isNull, ne, or, type SQL, sql } from 'drizzle-orm';

import { violatedUniqueConstraint } from '../db/errors.js';
import type { DirectorySchema } from '../db/schema.js';
import { rosterSummaries } from '../roster/schema.js';
import { rosterSummaryColumns, toRosterSummary } from '../roster/summary.js';
import { actingTenantContext } from '../internal-api.js';
import { canSeeCommission, seesAllCommissions, tenantContextOf } from './access.js';
import type { CreateCommissionBody } from './create-commission.js';
import { commissionCreated } from './events.js';
import { decodeCursor, encodeCursor, type ListCommissionsQuery } from './list-query.js';
import { PLATFORM_DEFAULT_POLICY } from './policy.js';
import { nairobiToday } from './policy-versions.js';
import {
  type Commission,
  type CommissionPage,
  type InternalCommission,
  type OfficerCategory,
} from './representation.js';
import {
  commissionCategories,
  commissions,
  officerCategories,
  reportingOfficerAssignments,
  tenantPolicyVersions,
} from './schema.js';

export type Transaction = Parameters<Parameters<Database<DirectorySchema>['transaction']>[0]>[0];

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
  roster: rosterSummaryColumns,
};

/** Unique constraints of `commissions` and the request field each one protects. */
const UNIQUE_FIELDS: Record<string, 'slug' | 'name'> = {
  commissions_slug_unique: 'slug',
  commissions_name_lower_key: 'name',
};

/**
 * Responsible Commissions with the spec 01 visibility rule: national readers see every
 * Commission, other staff only their own tenant's; anything invisible is 404. Only
 * platform admins create them (enforced by the controller).
 */
@Injectable()
export class CommissionsService {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
  ) {}

  /**
   * Creates a Commission with policy version 1 from platform defaults and records
   * `commission.created.v1`, all in one transaction: on any failure nothing is kept.
   * A slug or name that is taken is a 409 naming the field(s).
   */
  async create(principal: Principal, body: CreateCommissionBody): Promise<Commission> {
    try {
      return await this.db.transaction(async (tx) => {
        await this.refuseTaken(tx, body);
        const [created] = await tx
          .insert(commissions)
          .values({
            slug: body.slug,
            name: body.name,
            type: body.type,
            createdBy: principal.subject,
          })
          .returning({ id: commissions.id });
        if (!created) throw new Error('Commission insert returned no row');
        if (body.categories.length > 0) {
          await tx.insert(commissionCategories).values(
            body.categories.map((categoryCode) => ({
              commissionId: created.id,
              categoryCode,
            })),
          );
        }
        await tx.insert(tenantPolicyVersions).values({
          tenant: body.slug,
          version: 1,
          policy: PLATFORM_DEFAULT_POLICY,
          // The Commission's creation date: `now()` is the transaction's, as `created_at`'s.
          obligationsStartDate: nairobiToday,
          createdBy: principal.subject,
          createdByName: principal.name,
        });
        await this.events.record(
          tx,
          commissionCreated({ commissionId: created.id, slug: body.slug, type: body.type }),
        );
        // Read before the commit: nothing that can fail runs after it, so a committed create
        // always answers 201 and a retry with the same Idempotency-Key replays it.
        return this.read(tx, body.slug);
      });
    } catch (error) {
      // A concurrent create can pass `refuseTaken` and lose at the unique constraint instead.
      const field = UNIQUE_FIELDS[violatedUniqueConstraint(error) ?? ''];
      if (field) throw taken([field], body);
      throw error;
    }
  }

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
    notFoundIfInvisible(slug, (visible) => canSeeCommission(principal, visible));
    return withTenant(this.db, tenantContextOf(principal), (tx) => this.read(tx, slug));
  }

  /**
   * The Commission as the given transaction sees it, for writes that answer with it before
   * they commit. The caller has decided visibility. 404 when it does not exist.
   */
  async read(tx: Transaction, slug: string): Promise<Commission> {
    const [found] = await this.select(tx).where(eq(commissions.slug, slug)).limit(1);
    return toCommission(notFoundIfInvisible(found));
  }

  /** Slug, issuer code and name, for a service acting for `tenant`; another Commission's is 404. */
  async internalRef(
    principal: Principal,
    tenant: string,
    slug: string,
  ): Promise<InternalCommission> {
    actingTenantContext(principal, tenant, slug);
    const [found] = await this.db
      .select({ slug: commissions.slug, name: commissions.name })
      .from(commissions)
      .where(eq(commissions.slug, slug))
      .limit(1);
    const { name } = notFoundIfInvisible(found);
    return { slug, issuerCode: slug.toUpperCase(), name };
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

  /** 409 naming every field whose value another Commission already has. */
  private async refuseTaken(tx: Transaction, body: CreateCommissionBody): Promise<void> {
    const clashes = await tx
      .select({ slug: commissions.slug, name: commissions.name })
      .from(commissions)
      .where(
        or(eq(commissions.slug, body.slug), sql`lower(${commissions.name}) = lower(${body.name})`),
      );
    const fields = (['slug', 'name'] as const).filter((field) =>
      clashes.some((clash) =>
        field === 'slug'
          ? clash.slug === body.slug
          : clash.name.toLowerCase() === body.name.toLowerCase(),
      ),
    );
    if (fields.length > 0) throw taken(fields, body);
  }

  private select(tx: Transaction) {
    return tx
      .select(commissionColumns)
      .from(commissions)
      .leftJoin(reportingOfficerAssignments, currentAssignment)
      .leftJoin(rosterSummaries, eq(rosterSummaries.tenant, commissions.slug));
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

function taken(fields: readonly ('slug' | 'name')[], body: CreateCommissionBody) {
  const messages = {
    slug: `The key ${body.slug} is already used by another Commission`,
    name: 'A Commission with this name already exists',
  };
  return new ProblemException({
    type: 'commission-exists',
    title: 'Commission already exists',
    status: HttpStatus.CONFLICT,
    detail: 'A Commission with this key or name already exists.',
    errors: fields.map((path) => ({ path, message: messages[path] })),
  });
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
    roster: toRosterSummary(row.roster),
    createdAt: row.createdAt.toISOString(),
  };
}
