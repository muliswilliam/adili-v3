import { Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import type { DeclarationV1 } from '@adili/forms';
import { ApplicationFailure } from '@temporalio/common';
import { eq } from 'drizzle-orm';

import { reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeclarationsClient, type PulledVersion } from '../declarations/declarations-client.js';
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
  REGISTRY_SYSTEMS,
  type RegistryRecords,
  type SupplierCheckResult,
  type Unavailable,
} from '../rules/index.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import {
  GATEWAY_REJECTED,
  GATEWAY_UNAVAILABLE,
  type LookupOutcome,
  type LookupRequest,
  type MatchRequest,
  PROCESSING_LEGAL_BASIS,
  type RegistryCheckRequest,
  type RegistryCheckResult,
  type RegistryLookups,
  RESULT_MISSING,
  type SupplierOutcome,
} from './contract.js';
import { storeRegistryCheck } from './registry-check-store.js';

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
   * unavailable. Null when the case is no longer at the version (nothing is looked up).
   */
  async lookupRegistries({ check, previous }: LookupRequest): Promise<RegistryLookups | null> {
    if (!(await atVersion(this.db, check))) return null;
    const pulled = await pullVersion(this.declarations, check);
    const roster = await this.directory.getRosterRecord(check.tenant, pulled.rosterRecordId);
    const ids = householdIds(
      pulled.document as unknown as DeclarationV1,
      roster?.nationalId ?? null,
    );
    const context: RegistryContext = {
      tenant: check.tenant,
      legalBasis: PROCESSING_LEGAL_BASIS,
      caseRef: check.caseId,
    };
    const lookups: RegistryLookups = { persons: {}, suppliers: { ...previous?.suppliers } };
    let officerCompanies: string[] | undefined;

    for (const [personKey, nationalId] of Object.entries(ids)) {
      if (nationalId === null) continue;
      const before = previous?.persons[personKey] ?? {};
      // One person's registries at once; people in turn, so no registry sees a burst.
      const answers = await Promise.all(
        REGISTRY_SYSTEMS.map(async (system) => {
          const known = before[system];
          if (known && known.outcome !== 'unavailable') return { system, outcome: known };
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

    const employerCode = roster?.employerCode ?? null;
    if (employerCode !== null) {
      // Companies BRS named now are checked; those of an earlier attempt are known by number.
      const companies = officerCompanies ?? Object.keys(lookups.suppliers);
      for (const registrationNumber of companies) {
        const known = lookups.suppliers[registrationNumber];
        if (known && known.outcome !== 'unavailable') continue;
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
  async matchRegistries({ check, lookups }: MatchRequest): Promise<RegistryCheckResult> {
    if (!(await atVersion(this.db, check))) return { outcome: 'stale' };
    const pulled = await pullVersion(this.declarations, check);
    const document = pulled.document as unknown as DeclarationV1;
    const roster = await this.directory.getRosterRecord(check.tenant, pulled.rosterRecordId);

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
      suppliers[registrationNumber] =
        supplier.outcome === 'unavailable'
          ? unavailable(supplier.reason, supplier.resultId)
          : {
              resultId: supplier.resultId ?? '',
              system: 'brs',
              outcome: supplier.outcome,
              reason: null,
              cached: false,
              checkedAt: supplier.checkedAt ?? new Date().toISOString(),
              supplies: supplier.supplies,
            };
    }

    const match = matchRegistries({
      document,
      householdIds: householdIds(document, roster?.nationalId ?? null),
      results,
      suppliers,
    });
    return storeRegistryCheck(this.db, this.events, check, match);
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

/**
 * A lookup as the matching module takes it: a found one with its records read back from the
 * gateway, a not-found one with none, or `unavailable`. A result the gateway no longer has is
 * unavailable (`result-missing`); the gateway not answering propagates, so the activity retries.
 */
async function recordsOf(
  gateway: IntegrationGatewayClient,
  tenant: string,
  system: LookupSystem,
  lookup: LookupOutcome,
): Promise<NonNullable<PersonRegistryResults[LookupSystem]>> {
  if (lookup.outcome === 'unavailable' || lookup.resultId === null) {
    return unavailable(lookup.reason, lookup.resultId);
  }
  const envelope = {
    resultId: lookup.resultId,
    system,
    outcome: lookup.outcome,
    reason: null,
    cached: false,
    checkedAt: lookup.checkedAt ?? new Date().toISOString(),
  };
  if (lookup.outcome === 'not-found') return { ...envelope, ...NO_RECORDS[system] };

  let stored;
  try {
    stored = await gateway.getStoredResult(lookup.resultId, tenant);
  } catch (error) {
    if (error instanceof InternalApiRejected) {
      throw ApplicationFailure.nonRetryable(error.message, GATEWAY_REJECTED);
    }
    throw error;
  }
  const records = stored && REGISTRY_RECORDS[system].safeParse(stored.payload);
  if (!records?.success) return unavailable(RESULT_MISSING, lookup.resultId);
  return { ...envelope, ...records.data };
}

/** Whether the case still exists and is at the version being checked. */
async function atVersion(
  db: Database<ReviewSchema>,
  check: RegistryCheckRequest,
): Promise<boolean> {
  const [found] = await withTenant(db, systemContext(check.tenant), (tx) =>
    tx
      .select({ versionId: reviewCases.currentVersionId })
      .from(reviewCases)
      .where(eq(reviewCases.id, check.caseId)),
  );
  return found?.versionId === check.versionId;
}

/** The version as declarations gives it, read as the service for the case. */
async function pullVersion(
  declarations: DeclarationsClient,
  check: RegistryCheckRequest,
): Promise<PulledVersion> {
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
  return pulled;
}

/**
 * One lookup; the gateway not answering (unreachable, or the lookup not recorded) or refusing
 * the request is `unavailable` with no result id, looked up again like a registry outage. For a
 * found BRS lookup, the companies' registration numbers, for the supplier check.
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
      outcome: {
        outcome: result.outcome,
        reason: result.outcome === 'unavailable' ? (result.reason ?? null) : null,
        resultId: result.resultId,
        checkedAt: result.checkedAt,
      },
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
      outcome: result.outcome,
      reason: result.outcome === 'unavailable' ? (result.reason ?? null) : null,
      resultId: result.resultId,
      checkedAt: result.checkedAt,
      supplies: result.outcome === 'found' ? result.supplies : null,
    };
  } catch (error) {
    return { ...gatewayFailure(error, 'brs'), checkedAt: null, supplies: null };
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
