import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { type DeclarationV1, validateDeclaration } from '@adili/forms';
import { ApplicationFailure } from '@temporalio/common';

import { createCase } from '../cases/case-creation.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeclarationsClient, type PulledVersion } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { type Flag, runRules } from '../rules/index.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import {
  type PreviousVersion,
  type ProcessingInput,
  type RulesRequest,
  type UpsertCaseOutcome,
  type UpsertCaseRequest,
  VERSION_MISSING,
  type VersionFacts,
} from './contract.js';

/**
 * The activities of `DeclarationProcessingWorkflow`, hosted by the review worker. Every public
 * method is an activity named after it (keep helpers out of this class); each is safe to retry.
 * A failed pull (`DeclarationsUnavailable`, `DirectoryUnavailable`) propagates, so Temporal
 * retries it with backoff.
 */
@Injectable()
export class ProcessingActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
  ) {}

  /** The version's metadata and read-model fields; null when declarations has no such version. */
  async pullVersion(input: ProcessingInput): Promise<VersionFacts | null> {
    const pulled = await this.declarations.getVersionDocument(input.declarationId, input.version, {
      tenant: input.tenant,
      actingSubject: SYSTEM_SUBJECT,
    });
    if (pulled?.versionId !== input.versionId) return null;
    return {
      personId: pulled.personId,
      reference: pulled.reference,
      type: pulled.type,
      statementDate: pulled.statementDate,
      submittedAt: pulled.submittedAt,
      late: pulled.late,
      dueDate: pulled.dueDate,
      declarantName: pulled.declarantName,
      personnelFileNumber: pulled.personnelFileNumber,
    };
  }

  /** The person's latest earlier submitted version at the Commission; null for a first. */
  async pullPreviousVersion(request: {
    tenant: string;
    personId: string;
    versionId: string;
  }): Promise<PreviousVersion | null> {
    const found = await this.declarations.findPreviousVersion(
      request.personId,
      request.tenant,
      request.versionId,
    );
    return found
      ? { declarationId: found.declarationId, versionId: found.versionId, version: found.version }
      : null;
  }

  /**
   * Pulls the version and the previous one and runs the deterministic rules on them. The
   * documents stay in this activity; the flags it returns hold clear facts only.
   */
  async runRules({ input, facts, previous }: RulesRequest): Promise<Flag[]> {
    const current = await pullDocument(
      this.declarations,
      input.tenant,
      input.declarationId,
      input.version,
    );
    const before = previous
      ? await pullDocument(
          this.declarations,
          input.tenant,
          previous.declarationId,
          previous.version,
        )
      : undefined;
    const checked = validateDeclaration(current.document);
    return runRules({
      current: current.document as unknown as DeclarationV1,
      previous: before?.document as unknown as DeclarationV1 | undefined,
      late: facts.late
        ? { dueDate: facts.dueDate, submittedOn: nairobiDate(facts.submittedAt) }
        : undefined,
      schemaIssues: checked.ok ? 0 : checked.errors.length,
    });
  }

  /**
   * Creates the case of the version, idempotently by version, with the clarification window of
   * the Commission's policy.
   */
  async upsertCase(request: UpsertCaseRequest): Promise<UpsertCaseOutcome> {
    const policy = await this.directory.getClarificationPolicy(request.input.tenant);
    return createCase(this.db, this.events, request, policy.issueWindowMonths);
  }
}

/** A version's document for the rules; one that disappeared since `pullVersion` is not retried. */
async function pullDocument(
  declarations: DeclarationsClient,
  tenant: string,
  declarationId: string,
  version: number,
): Promise<PulledVersion> {
  const pulled = await declarations.getVersionDocument(declarationId, version, {
    tenant,
    actingSubject: SYSTEM_SUBJECT,
  });
  if (!pulled) {
    throw ApplicationFailure.nonRetryable(
      `Version ${String(version)} of ${declarationId} is no longer available`,
      VERSION_MISSING,
    );
  }
  return pulled;
}

/** The calendar date in Nairobi of an instant, `YYYY-MM-DD`. */
function nairobiDate(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(instant));
}
