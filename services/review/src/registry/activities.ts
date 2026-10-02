import { Injectable, Logger } from '@nestjs/common';
import { PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import type { DeclarationV1 } from '@adili/forms';
import { ApplicationFailure } from '@temporalio/common';
import { and, asc, eq, inArray, max, ne, sql } from 'drizzle-orm';

import { reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  declarationOf,
  DeclarationOutsideContract,
  DeclarationsClient,
  type PulledVersion,
} from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import {
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
  type LookupSystem,
  type RegistryContext,
} from '../integration-gateway/integration-gateway-client.js';
import { REGISTRY_RECORDS } from '../integration-gateway/registry-records.js';
import { InternalApiRejected } from '../internal-api/rejected.js';
import { VERSION_MISSING } from '../processing/contract.js';
import {
  householdIds,
  matchRegistries,
  type PersonRegistryResults,
  type RegistryAnswer,
  REGISTRY_SYSTEMS,
  type RegistryRecords,
  type SupplierCheckResult,
  type Unavailable,
} from '../rules/index.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import {
  type AnsweredLookup,
  DECLARATION_INVALID,
  GATEWAY_REJECTED,
  GATEWAY_UNAVAILABLE,
  isAnswered,
  type LookupOutcome,
  type LookupRequest,
  lookUpAgain,
  type MatchRequest,
  PROCESSING_LEGAL_BASIS,
  type RegistryCheckRequest,
  type RegistryCheckResult,
  type RegistryLookups,
  RESULT_MISSING,
  type SupplierOutcome,
  type SweepCheck,
} from './contract.js';
import { storeRegistryCheck } from './registry-check-store.js';
import { registryChecks } from './schema.js';
import { planSweep, type SweepCandidate } from './sweep-plan.js';

/** Cases one sweep run considers at most, oldest check first; the plan takes what fits. */
const SWEEP_CANDIDATES = 1_000;

/**
 * Calls a lookup makes to its registry, as the gateway's rate limits count them, where more than
 * one: KRA's PINs, then each PIN's compliance (one PIN, usually).
 */
const CALLS_PER_LOOKUP: Readonly<Record<string, number>> = { kra: 2 };

/** The reason a BRS status is unavailable when only the supplier check (`hr-suppliers`) is. */
const SUPPLIER_CHECK_UNAVAILABLE = 'supplier-check-unavailable';

const logger = new Logger('RegistryChecks');

/**
 * The activities of the registry check (spec 07b), hosted by the review worker: the lookups of
 * every person of a version with a national ID in KRA, NTSA, BRS and ArdhiSasa (and the officer's
 * companies against the employer's supplier list), then the matching of the records against the
 * declared items, stored on the case. Every public method is an activity named after it (keep
 * helpers out of this class); each is safe to retry. National IDs and records stay in the
 * activities; what they hand on is listed in contract.ts.
 *
 * A pull from declarations or the directory that fails propagates, so Temporal retries it. The
 * gateway not answering a lookup is not an error: it is that lookup's `unavailable`, which the
 * workflow looks up again with backoff.
 */
@Injectable()
export class RegistryCheckActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
    private readonly gateway: IntegrationGatewayClient,
  ) {}

  /**
   * Looks up every person of the version with a national ID in every registry, and the officer's
   * BRS companies against the officer's employer's supplier list, with the case as reference and
   * the legal basis of processing. Given the previous attempt, looks up again only what was
   * unavailable and not refused. Null when the case is no longer at the version (nothing is looked
   * up).
   */
  async lookupRegistries({ check, previous }: LookupRequest): Promise<RegistryLookups | null> {
    // A new check takes its number on the case; a further attempt keeps the check's.
    const found = previous ? await caseAt(this.db, check) : await startCheck(this.db, check);
    if (found === null) return null;
    const sequence = previous?.sequence ?? found.sequence;
    const { roster, ids } = await household(this.declarations, this.directory, check);
    const context: RegistryContext = {
      tenant: check.tenant,
      legalBasis: PROCESSING_LEGAL_BASIS,
      caseRef: check.caseId,
      subjectPersonId: found.personId,
    };
    const employerCode = roster?.employerCode ?? null;
    const lookups: RegistryLookups = {
      sequence,
      persons: {},
      suppliers: { ...previous?.suppliers },
      ...(employerCode === null ? { noEmployer: true } : {}),
    };
    let officerCompanies: string[] | undefined;

    for (const [personKey, nationalId] of Object.entries(ids)) {
      if (nationalId === null) continue;
      const before = previous?.persons[personKey] ?? {};
      // One person's registries at once; people in turn, so no registry sees a burst.
      const answers = await Promise.all(
        REGISTRY_SYSTEMS.map(async (system) => {
          const known = before[system];
          if (known && !lookUpAgain(known)) return { system, outcome: known };
          return { system, ...(await lookUp(this.gateway, system, nationalId, context)) };
        }),
      );
      lookups.persons[personKey] = Object.fromEntries(
        answers.map(({ system, outcome }) => [system, outcome]),
      );
      if (personKey === 'officer') {
        officerCompanies = answers.find((answer) => 'companies' in answer)?.companies;
      }
    }

    if (employerCode !== null) {
      // Companies BRS named now are checked; those of an earlier attempt are known by number.
      const companies = officerCompanies ?? Object.keys(lookups.suppliers);
      for (const registrationNumber of companies) {
        const known = lookups.suppliers[registrationNumber];
        if (known && !lookUpAgain(known)) continue;
        lookups.suppliers[registrationNumber] = await checkSupplier(
          this.gateway,
          registrationNumber,
          employerCode,
          context,
        );
      }
    }
    return lookups;
  }

  /**
   * Reads the records of every found lookup back from the gateway by result id, matches them
   * against the version's declared items (the pure matching module) and stores the outcome on the
   * case in one transaction: the registry flags, a status per person and registry, the score and
   * band with the registry flags, a timeline entry and `review.registry.checked.v1`. `stale` (and
   * nothing stored) when the case moved on to a later version.
   */
  async matchAndStoreRegistries({ check, lookups }: MatchRequest): Promise<RegistryCheckResult> {
    if ((await caseAt(this.db, check)) === null) return { outcome: 'stale' };
    const { document, ids } = await household(this.declarations, this.directory, check);

    const results: Record<string, PersonRegistryResults> = {};
    for (const [personKey, systems] of Object.entries(lookups.persons)) {
      const person: Record<string, PersonRegistryResults[LookupSystem]> = {};
      for (const system of REGISTRY_SYSTEMS) {
        const lookup = systems[system];
        if (lookup) person[system] = await recordsOf(this.gateway, check.tenant, system, lookup);
      }
      results[personKey] = person;
    }
    const suppliers: Record<string, SupplierCheckResult | Unavailable> = {};
    for (const [registrationNumber, supplier] of Object.entries(lookups.suppliers)) {
      suppliers[registrationNumber] = isAnswered(supplier)
        ? { ...answerOf(supplier), supplies: supplier.supplies }
        : unavailable(supplier.reason, supplier.resultId);
    }

    const match = matchRegistries({
      document,
      householdIds: ids,
      results,
      // No employer to check the officer's companies against: the match says so.
      suppliers: lookups.noEmployer ? null : suppliers,
    });
    return storeRegistryCheck(this.db, this.events, check, match, lookups.sequence);
  }

  /**
   * The sweep's plan: the open (not determined) cases across Commissions with a registry still
   * unavailable at their latest check, the oldest check first, each at its current version, paced
   * under the gateway's rate limits (`planSweep`). A case's re-check sends each system its
   * unavailable lookups only: its answered ones come from the gateway's cache.
   */
  async planRegistrySweep(): Promise<SweepCheck[]> {
    const limits = await this.gateway.getRegistryRateLimits();
    const candidates = await withTenant(this.db, systemContext(PLATFORM_TENANT), async (tx) => {
      const cases = await tx
        .select({
          tenant: reviewCases.tenant,
          caseId: reviewCases.id,
          declarationId: reviewCases.declarationId,
          versionId: reviewCases.currentVersionId,
          version: reviewCases.currentVersion,
        })
        .from(reviewCases)
        .innerJoin(registryChecks, eq(registryChecks.caseId, reviewCases.id))
        .where(and(eq(reviewCases.registryUnavailable, true), ne(reviewCases.status, 'determined')))
        .groupBy(reviewCases.id)
        .orderBy(asc(max(registryChecks.checkedAt)), asc(reviewCases.id))
        .limit(SWEEP_CANDIDATES);
      const unavailable =
        cases.length === 0
          ? []
          : await tx
              .select({
                caseId: registryChecks.caseId,
                system: registryChecks.system,
                reason: registryChecks.reason,
              })
              .from(registryChecks)
              .where(
                and(
                  inArray(
                    registryChecks.caseId,
                    cases.map((c) => c.caseId),
                  ),
                  eq(registryChecks.status, 'unavailable'),
                ),
              );
      return cases.map((request): SweepCandidate => {
        const calls: Record<string, number> = {};
        for (const row of unavailable.filter((entry) => entry.caseId === request.caseId)) {
          const system = row.reason === SUPPLIER_CHECK_UNAVAILABLE ? 'hr-suppliers' : row.system;
          calls[system] = (calls[system] ?? 0) + (CALLS_PER_LOOKUP[system] ?? 1);
        }
        return { request, calls };
      });
    });
    return planSweep(candidates, limits);
  }
}

/** A lookup that found nothing has no records. */
const NO_RECORDS: RegistryRecords = {
  kra: { taxpayers: [] },
  ntsa: { vehicles: [] },
  brs: { directorships: [] },
  ardhisasa: { parcels: [] },
};

function unavailable(reason: string | null, resultId: string | null): Unavailable {
  return { outcome: 'unavailable', reason, resultId };
}

/** An answered lookup as the matching module reads it. */
function answerOf({ outcome, resultId }: AnsweredLookup): RegistryAnswer {
  return { outcome, resultId };
}

/**
 * A gateway result's envelope as the check hands it on (`LookupOutcome`): its reason only when
 * unavailable.
 */
function outcomeOf(result: {
  outcome: LookupOutcome['outcome'];
  reason?: string | null;
  resultId: string;
  checkedAt: string;
}): LookupOutcome {
  return {
    outcome: result.outcome,
    reason: result.outcome === 'unavailable' ? (result.reason ?? null) : null,
    resultId: result.resultId,
    checkedAt: result.checkedAt,
  };
}

/**
 * A lookup as the matching module takes it: a found one with its records read back from the
 * gateway, a not-found one with none, or `unavailable`. A result the gateway no longer has is
 * unavailable (`result-missing`), one it refuses to give `gateway-rejected`, as a refused lookup
 * is; the gateway not answering propagates, so the activity retries.
 */
async function recordsOf(
  gateway: IntegrationGatewayClient,
  tenant: string,
  system: LookupSystem,
  lookup: LookupOutcome,
): Promise<NonNullable<PersonRegistryResults[LookupSystem]>> {
  if (!isAnswered(lookup)) return unavailable(lookup.reason, lookup.resultId);
  const answer = answerOf(lookup);
  if (lookup.outcome === 'not-found') return { ...answer, ...NO_RECORDS[system] };

  let stored;
  try {
    stored = await gateway.getStoredResult(lookup.resultId, tenant, SYSTEM_SUBJECT);
  } catch (error) {
    if (error instanceof InternalApiRejected) {
      logger.error(
        `The integration-gateway refused a ${system} result with ${String(error.status)}`,
      );
      return unavailable(GATEWAY_REJECTED, lookup.resultId);
    }
    throw error;
  }
  const records = stored && REGISTRY_RECORDS[system].safeParse(stored.payload);
  if (!records?.success) return unavailable(RESULT_MISSING, lookup.resultId);
  return { ...answer, ...records.data };
}

/**
 * The case's declarant and last check number, if the case still exists and is at the version
 * being checked.
 */
async function caseAt(
  db: Database<ReviewSchema>,
  check: RegistryCheckRequest,
): Promise<{ personId: string; sequence: number } | null> {
  const [found] = await withTenant(db, systemContext(check.tenant), (tx) =>
    tx
      .select({ personId: reviewCases.personId, sequence: reviewCases.registryCheckSequence })
      .from(reviewCases)
      .where(
        and(eq(reviewCases.id, check.caseId), eq(reviewCases.currentVersionId, check.versionId)),
      ),
  );
  return found ?? null;
}

/** As `caseAt`, handing out the next check number of the case. */
async function startCheck(
  db: Database<ReviewSchema>,
  check: RegistryCheckRequest,
): Promise<{ personId: string; sequence: number } | null> {
  const [started] = await withTenant(db, systemContext(check.tenant), (tx) =>
    tx
      .update(reviewCases)
      .set({ registryCheckSequence: sql`${reviewCases.registryCheckSequence} + 1` })
      .where(
        and(eq(reviewCases.id, check.caseId), eq(reviewCases.currentVersionId, check.versionId)),
      )
      .returning({ personId: reviewCases.personId, sequence: reviewCases.registryCheckSequence }),
  );
  return started ?? null;
}

/**
 * The version's document and the national ID of each of its people (the officer's from the
 * roster record, others' as declared), with the roster record for the employer code.
 */
async function household(
  declarations: DeclarationsClient,
  directory: DirectoryClient,
  check: RegistryCheckRequest,
) {
  const { pulled, document } = await pullVersion(declarations, check);
  const roster = await directory.getRosterRecord(check.tenant, pulled.rosterRecordId);
  return { document, roster, ids: householdIds(document, roster?.nationalId ?? null) };
}

/**
 * The version as declarations gives it, read as the service for the case, with its document
 * checked against declaration.v1. A version gone, or a document outside the contract, fails the
 * check for good: reading the immutable version again changes nothing.
 */
async function pullVersion(
  declarations: DeclarationsClient,
  check: RegistryCheckRequest,
): Promise<{ pulled: PulledVersion; document: DeclarationV1 }> {
  const pulled = await declarations.getVersionDocument(check.declarationId, check.version, {
    tenant: check.tenant,
    actingSubject: SYSTEM_SUBJECT,
    caseId: check.caseId,
  });
  if (pulled?.versionId !== check.versionId) {
    throw ApplicationFailure.nonRetryable(
      `Version ${String(check.version)} of ${check.declarationId} is no longer available`,
      VERSION_MISSING,
    );
  }
  try {
    return { pulled, document: declarationOf(pulled) };
  } catch (error) {
    if (error instanceof DeclarationOutsideContract) {
      throw ApplicationFailure.nonRetryable(error.message, DECLARATION_INVALID);
    }
    throw error;
  }
}

/**
 * One lookup; the gateway not answering (unreachable, or the lookup not recorded) is
 * `unavailable` with no result id, looked up again like a registry outage, and the gateway
 * refusing the request is `unavailable` (`gateway-rejected`), not looked up again. For a found
 * BRS lookup, the companies' registration numbers, for the supplier check.
 */
async function lookUp(
  gateway: IntegrationGatewayClient,
  system: LookupSystem,
  nationalId: string,
  context: RegistryContext,
): Promise<{ outcome: LookupOutcome; companies?: string[] }> {
  try {
    const result = await gateway.lookupRegistry(system, nationalId, context);
    return {
      outcome: outcomeOf(result),
      ...('directorships' in result && result.outcome === 'found'
        ? { companies: [...new Set(result.directorships.map((d) => d.companyRegistrationNumber))] }
        : {}),
    };
  } catch (error) {
    return { outcome: { ...gatewayFailure(error, system), checkedAt: null } };
  }
}

async function checkSupplier(
  gateway: IntegrationGatewayClient,
  registrationNumber: string,
  employerCode: string,
  context: RegistryContext,
): Promise<SupplierOutcome> {
  try {
    const result = await gateway.checkSupplier(registrationNumber, employerCode, context);
    return {
      ...outcomeOf(result),
      supplies: result.outcome === 'found' ? result.supplies : null,
    };
  } catch (error) {
    return { ...gatewayFailure(error, 'hr-suppliers'), checkedAt: null, supplies: null };
  }
}

function gatewayFailure(
  error: unknown,
  system: string,
): Pick<LookupOutcome, 'outcome' | 'reason' | 'resultId'> {
  if (error instanceof InternalApiRejected) {
    // A request the gateway refuses (the token lacks the scope, say) needs fixing, not waiting.
    logger.error(`The integration-gateway refused a ${system} lookup with ${String(error.status)}`);
    return { outcome: 'unavailable', reason: GATEWAY_REJECTED, resultId: null };
  }
  if (error instanceof IntegrationGatewayUnavailable) {
    return { outcome: 'unavailable', reason: GATEWAY_UNAVAILABLE, resultId: null };
  }
  throw error;
}
