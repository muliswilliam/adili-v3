import { Injectable } from '@nestjs/common';
import { type Principal, type ReadAudit } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import type { DeclarationV1, PersonName } from '@adili/forms';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { caseTenant } from '../cases/access.js';
import { findCase, type ReviewTransaction } from '../cases/case-lookup.js';
import { type Assignee, flagView } from '../cases/representation.js';
import { reviewAssignments, reviewFlags } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  declarationOf,
  DeclarationOutsideContract,
  DeclarationsClient,
} from '../declarations/declarations-client.js';
import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
} from '../integration-gateway/integration-gateway-client.js';
import { REGISTRY_RECORDS } from '../integration-gateway/registry-records.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { declarationsUnavailable, upstreamUnavailable } from '../internal-api/upstream.js';
import { VIEW_REGISTRY_RECORDS_BUDGET_MS, within } from '../internal-api/view-budget.js';
import { pullViewedVersion } from '../internal-api/view-declaration.js';
import {
  householdIds,
  REGISTRY_RULE_IDS,
  REGISTRY_SYSTEMS,
  type RegistryRecords,
  registryRows,
  registrySystemOf,
} from '../rules/index.js';
import {
  latestCheck,
  type RegistryStatus,
  type RegistrySystemView,
  type RegistryView,
} from './representation.js';
import { registryChecks } from './schema.js';

type CheckRow = typeof registryChecks.$inferSelect;

/**
 * The Registry tab of a case (spec 07b, S12): per person of the declaration and registry, the
 * status of the latest check, the registry's records pulled from the integration-gateway by
 * result id (decrypted there, one hop) beside the declared items they matched or did not, and the
 * registry flags. The records are read for each view and never stored in the review database
 * (flags keep only the identifiers they are about: a parcel number, a registration);
 * the declaration is pulled from declarations, which audits the read with the viewer and case.
 */
@Injectable()
export class RegistryViewService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly gateway: IntegrationGatewayClient,
  ) {}

  /**
   * When the current version's latest check was stored: what a client polls while a re-check
   * runs. Read from review alone (no declaration, no records), so not an audited read.
   */
  async status(principal: Principal, caseId: string): Promise<RegistryStatus> {
    const tenant = caseTenant(principal);
    const checks = await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) =>
      currentChecks(tx, await findCase(tx, tenant, caseId)),
    );
    return { checkedAt: latestCheck(checks) };
  }

  /**
   * The Registry tab. `audit` is told the case's declarant, so the read is audited as a read of
   * their data (ADR-008 "who accessed my data"); the gateway's reads of the records name the
   * viewer as the subject they are made for (ADR-013 §8.6).
   */
  async view(principal: Principal, caseId: string, audit: ReadAudit): Promise<RegistryView> {
    const tenant = caseTenant(principal);
    const { row, checks, flags, names } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const found = await findCase(tx, tenant, caseId);
        const checkRows = await currentChecks(tx, found);
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
    audit.resource({ tenant, subjectPersonId: row.personId });

    const document = await this.pull(principal, row);
    const records = await this.records(tenant, principal.subject, checks);

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

    // The officer's ID is the roster's, not read here: before a check, the officer has one.
    const declaredIds = householdIds(document, null);
    return {
      checkedAt: latestCheck(checks),
      persons: document.statements.map((statement) => {
        const own = checks.filter((check) => check.personKey === statement.personKey);
        return {
          personKey: statement.personKey,
          personName: fullName(statement.personName),
          // As the latest check found (no-id everywhere when not), else as declared.
          hasNationalId:
            own.length > 0
              ? own.some((check) => check.status !== 'no-id')
              : statement.personKey === 'officer' || declaredIds[statement.personKey] !== null,
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
    const pulled = await pullViewedVersion(this.declarations, principal, row);
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
    viewer: string,
    checks: CheckRow[],
  ): Promise<Map<string, RegistryRecords[keyof RegistryRecords]>> {
    const answered = checks.filter(
      (check): check is CheckRow & { resultId: string } =>
        check.resultId !== null && (check.status === 'matched' || check.status === 'mismatched'),
    );
    try {
      const read = await within(
        VIEW_REGISTRY_RECORDS_BUDGET_MS,
        () =>
          Promise.all(
            answered.map(async (check) => {
              const stored = await this.gateway.getStoredResult(check.resultId, tenant, viewer);
              const parsed =
                stored?.outcome === 'found'
                  ? REGISTRY_RECORDS[check.system].safeParse(stored.payload)
                  : null;
              return parsed?.success ? ([[check.id, parsed.data]] as const) : [];
            }),
          ),
        () => new IntegrationGatewayUnavailable('The integration-gateway did not answer in time'),
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

/**
 * The checks of the case's current version only: another version's result ids are records matched
 * against other declared items, never to be paired with this document.
 */
function currentChecks(
  tx: ReviewTransaction,
  found: { id: string; currentVersionId: string },
): Promise<CheckRow[]> {
  return tx
    .select()
    .from(registryChecks)
    .where(
      and(
        eq(registryChecks.caseId, found.id),
        eq(registryChecks.versionId, found.currentVersionId),
      ),
    );
}

interface CaseKeys {
  id: string;
  declarationId: string;
  currentVersion: number;
}

function fullName({ firstName, otherNames, surname }: PersonName): string {
  return [firstName, otherNames, surname].filter(Boolean).join(' ');
}
