import { Injectable } from '@nestjs/common';
import { type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import type { DeclarationV1, PersonName, Statement } from '@adili/forms';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { caseTenant } from '../cases/access.js';
import { findCase } from '../cases/case-lookup.js';
import { type Assignee, flagView } from '../cases/representation.js';
import { reviewAssignments, reviewFlags } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  declarationOf,
  DeclarationOutsideContract,
  DeclarationsClient,
  DeclarationsUnavailable,
  type PulledVersion,
} from '../declarations/declarations-client.js';
import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
} from '../integration-gateway/integration-gateway-client.js';
import { REGISTRY_RECORDS } from '../integration-gateway/registry-records.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { declarationsUnavailable, upstreamUnavailable } from '../internal-api/upstream.js';
import {
  REGISTRY_RULE_IDS,
  REGISTRY_SYSTEMS,
  type RegistryRecords,
  registryRows,
  registrySystemOf,
} from '../rules/index.js';
import { latestCheck, type RegistrySystemView, type RegistryView } from './representation.js';
import { registryChecks } from './schema.js';

type CheckRow = typeof registryChecks.$inferSelect;

/**
 * The Registry tab of a case (spec 07b, S12): per person of the declaration and registry, the
 * status of the latest check, the registry's records pulled from the integration-gateway by
 * result id (decrypted there, one hop) beside the declared items they matched or did not, and the
 * registry flags. The records are read for each view and never stored in the review database;
 * the declaration is pulled from declarations, which audits the read with the viewer and case.
 */
@Injectable()
export class RegistryViewService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly gateway: IntegrationGatewayClient,
  ) {}

  async view(principal: Principal, caseId: string): Promise<RegistryView> {
    const tenant = caseTenant(principal);
    const { row, checks, flags, names } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const found = await findCase(tx, tenant, caseId);
        const checkRows = await tx
          .select()
          .from(registryChecks)
          .where(eq(registryChecks.caseId, found.id));
        const flagRows = await tx
          .select()
          .from(reviewFlags)
          .where(
            and(eq(reviewFlags.caseId, found.id), inArray(reviewFlags.ruleId, REGISTRY_RULE_IDS)),
          )
          .orderBy(asc(reviewFlags.createdAt), asc(reviewFlags.id));
        const assignments = await tx
          .select({ subject: reviewAssignments.subject, name: reviewAssignments.subjectName })
          .from(reviewAssignments)
          .where(eq(reviewAssignments.caseId, found.id));
        return { row: found, checks: checkRows, flags: flagRows, names: assignments };
      },
    );

    const document = await this.pull(principal, row);
    const records = await this.records(tenant, checks);

    const nameOf = new Map(
      names.flatMap(({ subject, name }) => (subject ? [[subject, name]] : [])),
    );
    const officer = (subject: string): Assignee => ({
      subject,
      name: nameOf.get(subject) ?? subject,
    });
    const flagsOf = (personKey: string, system: string) =>
      flags
        .filter(
          (flag) =>
            registrySystemOf(flag.ruleId) === system &&
            flag.itemRefs.some((ref) => ref.personKey === personKey),
        )
        .map((flag) => flagView(flag, officer));

    return {
      checkedAt: latestCheck(checks),
      persons: document.statements.map((statement) => {
        const own = checks.filter((check) => check.personKey === statement.personKey);
        return {
          personKey: statement.personKey,
          personName: fullName(statement.personName),
          hasNationalId: hasNationalId(document, statement, own),
          systems: REGISTRY_SYSTEMS.map((system): RegistrySystemView => {
            const check = own.find((entry) => entry.system === system);
            const found = check && records.get(check.id);
            return {
              system,
              status: check?.status ?? 'not-checked',
              reason: check?.reason ?? null,
              checkedAt: check?.checkedAt.toISOString() ?? null,
              resultId: check?.resultId ?? null,
              rows: found ? registryRows(document, statement.personKey, system, found) : [],
              flags: flagsOf(statement.personKey, system),
            };
          }),
        };
      }),
    };
  }

  /** The current version's document, read for the viewer and the case, checked at the boundary. */
  private async pull(
    principal: Principal,
    row: { tenant: string } & CaseKeys,
  ): Promise<DeclarationV1> {
    let pulled: PulledVersion | null;
    try {
      pulled = await this.declarations.getVersionDocument(row.declarationId, row.currentVersion, {
        tenant: row.tenant,
        actingSubject: principal.subject,
        caseId: row.id,
      });
    } catch (error) {
      if (error instanceof DeclarationsUnavailable) throw declarationsUnavailable();
      throw error;
    }
    if (pulled === null) {
      throw declarationsUnavailable(
        'The declarations service does not have the version under review.',
      );
    }
    try {
      return declarationOf(pulled);
    } catch (error) {
      if (error instanceof DeclarationOutsideContract) {
        throw declarationsUnavailable(
          'The declarations service answered with a document outside its contract.',
        );
      }
      throw error;
    }
  }

  /**
   * The records of each check that found some, by check id, read from the gateway by result id.
   * A result the gateway no longer has shows no records; the gateway not answering is 502.
   */
  private async records(
    tenant: string,
    checks: CheckRow[],
  ): Promise<Map<string, RegistryRecords[keyof RegistryRecords]>> {
    const answered = checks.filter(
      (check) =>
        check.resultId !== null && (check.status === 'matched' || check.status === 'mismatched'),
    );
    try {
      const read = await Promise.all(
        answered.map(async (check) => {
          const stored = await this.gateway.getStoredResult(check.resultId ?? '', tenant);
          const parsed =
            stored?.outcome === 'found'
              ? REGISTRY_RECORDS[check.system].safeParse(stored.payload)
              : null;
          return parsed?.success ? ([[check.id, parsed.data]] as const) : [];
        }),
      );
      return new Map(read.flat());
    } catch (error) {
      if (error instanceof IntegrationGatewayUnavailable || error instanceof InternalApiRejected) {
        throw upstreamUnavailable(
          'integration-gateway',
          'Registry records could not be loaded from the integration-gateway. Try again shortly.',
        );
      }
      throw error;
    }
  }
}

interface CaseKeys {
  id: string;
  declarationId: string;
  currentVersion: number;
}

/**
 * Whether the person has a national ID to look up: as the latest check found (no-id everywhere
 * when not), or before any check, the officer always and the household as declared.
 */
function hasNationalId(document: DeclarationV1, statement: Statement, checks: CheckRow[]): boolean {
  if (checks.length > 0) return checks.some((check) => check.status !== 'no-id');
  if (statement.personKey === 'officer') return true;
  const declared = [
    ...document.spouses.items.map((s) => ({ key: `spouse:${s.id}`, id: s.nationalId })),
    ...document.children.items.map((c) => ({ key: `child:${c.id}`, id: c.nationalId })),
  ];
  return Boolean(declared.find((person) => person.key === statement.personKey)?.id?.trim());
}

function fullName({ firstName, otherNames, surname }: PersonName): string {
  return [firstName, otherNames, surname].filter(Boolean).join(' ');
}
