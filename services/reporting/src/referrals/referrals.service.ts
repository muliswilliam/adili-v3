import { setTimeout as sleep } from 'node:timers/promises';

import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';

import { requireEacc } from '../access.js';
import { Clock } from '../clock.js';
import { config } from '../config.js';
import type { ReportingSchema } from '../db/schema.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import {
  type IcmsReferral,
  type IcmsReferralRequest,
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
} from '../integration-gateway/integration-gateway-client.js';
import { InternalApiRejected } from '../internal-api/internal-api.js';
import { officerOf } from '../officer.js';
import { badRequest, notFound, workflowUnavailable } from '../problems.js';
import { ReviewClient, ReviewUnavailable } from '../review/review-client.js';
import { eaccContext } from '../system-context.js';
import {
  lockIntake,
  recordPushed,
  recordPushFailed,
  recordRegistered,
  type ReferralIntakeRow,
} from './intake.js';
import { ReferralWorkflows } from './referral-workflows.js';
import {
  type ReferralIntakeItem,
  referralIntakeItem,
  type ReferralIntakePage,
} from './representation.js';
import { type IcmsPushError, type IcmsStatus, referralIntake } from './schema.js';

const NOT_IN_INTAKE = 'No referral in the intake has this id.';

const EACC_ONLY = 'Only EACC analysts and supervisors work on the referrals intake.';

/** The most characters ICMS takes as a referral's details (integration-gateway.yaml). */
const ICMS_DETAILS_MAX = 8_000;

export interface IntakeQuery {
  icmsStatus?: IcmsStatus;
  cursor?: string;
  limit: number;
}

/** The push stopped short of a registration, for the reason `error`. */
class PushFailed extends Error {
  constructor(readonly error: IcmsPushError) {
    super(`The ICMS push failed: ${error}`);
    this.name = 'PushFailed';
  }
}

/**
 * EACC's referrals intake (spec 09): the referrals Commissions sent (`referral.sent.v1`) and
 * their hand-off to ICMS, for EACC analysts and supervisors (everyone else 403).
 *
 * A push pulls what ICMS needs from review's internal ICMS payload and registers the referral
 * through the integration-gateway's ICMS adapter, which ICMS keeps idempotent by the `RFL`
 * reference. While ICMS is unreachable the gateway is tried again with backoff; if it stays
 * unreachable (or review cannot be read, or ICMS refuses) the referral is left `push-failed` with
 * an error code and EACC pushes it again. A case number is stored at once (`registered`,
 * `referral.icms-registered.v1`); a registration ICMS has only accepted (`pushed`) is waited for
 * by `ReferralIcmsRegistrationWorkflow`. A registered referral is never pushed again. The
 * declarant's name and ID number pass from review to the gateway in memory only.
 */
@Injectable()
export class ReferralsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly review: ReviewClient,
    private readonly gateway: IntegrationGatewayClient,
    private readonly directory: DirectoryClient,
    private readonly workflows: ReferralWorkflows,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /** The intake, the latest sent first, optionally by ICMS status; pages by `cursor`. */
  async list(principal: Principal, query: IntakeQuery): Promise<ReferralIntakePage> {
    requireEacc(principal, EACC_ONLY);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await withTenant(this.db, eaccContext(principal.subject), (tx) => {
      const filters: (SQL | undefined)[] = [];
      if (query.icmsStatus !== undefined) {
        filters.push(eq(referralIntake.icmsStatus, query.icmsStatus));
      }
      if (after !== undefined) {
        filters.push(
          or(
            lt(referralIntake.sentAt, after.sentAt),
            and(
              eq(referralIntake.sentAt, after.sentAt),
              lt(referralIntake.referralId, after.referralId),
            ),
          ),
        );
      }
      return tx
        .select()
        .from(referralIntake)
        .where(and(...filters))
        .orderBy(desc(referralIntake.sentAt), desc(referralIntake.referralId))
        .limit(query.limit + 1);
    });
    const page = rows.slice(0, query.limit);
    const names = await this.commissionNames();
    const last = page.at(-1);
    return {
      items: page.map((row) => referralIntakeItem(row, names.get(row.tenant) ?? row.tenant)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * Pushes the referral to ICMS (see the class). Answers the referral as it stands: registered
   * (or registered already, with nothing sent again) or `pushed`; 502 `icms-push-failed` when it
   * was left `push-failed`; 404 for a referral not in the intake.
   */
  async push(principal: Principal, referralId: string): Promise<ReferralIntakeItem> {
    requireEacc(principal, EACC_ONLY);
    const claimed = await withTenant(this.db, eaccContext(principal.subject), async (tx) => {
      const row = await lockIntake(tx, referralId);
      if (!row) throw notFound(NOT_IN_INTAKE);
      if (row.icmsStatus === 'registered') return { row, attempt: null };
      const [pushing] = await tx
        .update(referralIntake)
        .set({
          pushAttempts: row.pushAttempts + 1,
          pushedAt: this.clock.now(),
          pushedBy: principal.subject,
          pushedByName: officerOf(principal).name,
        })
        .where(eq(referralIntake.referralId, referralId))
        .returning();
      if (!pushing) throw notFound(NOT_IN_INTAKE);
      return { row: pushing, attempt: pushing.pushAttempts };
    });
    if (claimed.attempt === null) return this.itemOf(claimed.row);

    let registration: IcmsReferral;
    try {
      registration = await this.register(claimed.row);
    } catch (error) {
      if (!(error instanceof PushFailed)) throw error;
      const failed = await withTenant(this.db, eaccContext(principal.subject), (tx) =>
        recordPushFailed(tx, this.events, referralId, error.error),
      );
      // Registered by a concurrent push meanwhile: that is the answer.
      if (failed?.icmsStatus === 'registered') return this.itemOf(failed);
      throw pushFailed(error.error);
    }

    const { caseNumber } = registration;
    if (registration.status === 'registered' && caseNumber !== null) {
      const registeredAt = new Date(registration.registeredAt ?? this.clock.now());
      const registered = await withTenant(this.db, eaccContext(principal.subject), (tx) =>
        recordRegistered(tx, this.events, referralId, { caseNumber, registeredAt }),
      );
      return this.itemOf(registered ?? claimed.row);
    }
    if (registration.status === 'failed') {
      const failed = await withTenant(this.db, eaccContext(principal.subject), (tx) =>
        recordPushFailed(tx, this.events, referralId, 'icms-failed'),
      );
      if (failed?.icmsStatus === 'registered') return this.itemOf(failed);
      throw pushFailed('icms-failed');
    }
    const pushed = await withTenant(this.db, eaccContext(principal.subject), (tx) =>
      recordPushed(tx, this.events, referralId),
    );
    if (pushed?.icmsStatus === 'pushed') await this.awaitRegistration(referralId, claimed.attempt);
    return this.itemOf(pushed ?? claimed.row);
  }

  /** Pulls the ICMS payload from review and registers it through the gateway, with retries. */
  private async register(row: ReferralIntakeRow): Promise<IcmsReferral> {
    let request: IcmsReferralRequest;
    try {
      const payload = await this.review.referralIcmsPayload(row.tenant, row.referralId);
      if (!payload) throw new PushFailed('payload-not-found');
      request = {
        referralReference: row.reference,
        nationalId: payload.declarant.nationalId,
        fullName: payload.declarant.name,
        referringCommission: payload.commission.issuerCode,
        grounds: payload.groundsLabel,
        details: payload.narrative.slice(0, ICMS_DETAILS_MAX),
      };
    } catch (error) {
      if (error instanceof ReviewUnavailable) throw new PushFailed('review-unavailable');
      throw error;
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.gateway.submitReferral(row.tenant, request);
      } catch (error) {
        if (error instanceof InternalApiRejected) throw new PushFailed('icms-rejected');
        if (!(error instanceof IntegrationGatewayUnavailable)) throw error;
        if (attempt >= config.ICMS_PUSH_ATTEMPTS) throw new PushFailed('icms-unavailable');
        await sleep(config.ICMS_PUSH_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }

  /**
   * Starts the workflow that waits for ICMS's case number. While Temporal is unreachable the
   * referral stays `pushed` and 503 asks EACC to push again, which ICMS answers as a replay.
   */
  private async awaitRegistration(referralId: string, attempt: number): Promise<void> {
    try {
      await this.workflows.awaitIcmsRegistration({ referralId, attempt });
    } catch {
      throw workflowUnavailable(
        'ICMS accepted the referral; push it again shortly to follow its case number.',
      );
    }
  }

  private async itemOf(row: ReferralIntakeRow): Promise<ReferralIntakeItem> {
    const names = await this.commissionNames();
    return referralIntakeItem(row, names.get(row.tenant) ?? row.tenant);
  }

  /** Commission names by slug; none while the directory is unreachable (the slug is shown). */
  private async commissionNames(): Promise<Map<string, string>> {
    try {
      const commissions = await this.directory.listCommissions();
      return new Map(commissions.map((commission) => [commission.slug, commission.name]));
    } catch (error) {
      if (error instanceof DirectoryUnavailable) return new Map();
      throw error;
    }
  }
}

interface Cursor {
  sentAt: Date;
  referralId: string;
}

function encodeCursor(row: ReferralIntakeRow): string {
  return Buffer.from(JSON.stringify([row.sentAt.toISOString(), row.referralId])).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return { sentAt: new Date(parsed[0]), referralId: parsed[1] };
    }
  } catch {
    // Reported below.
  }
  throw badRequest('The cursor is not one this list gave.');
}

/** 502 `icms-push-failed`: the referral is `push-failed` with `error`; push again to retry. */
function pushFailed(error: IcmsPushError): ProblemException {
  return new ProblemException(
    {
      type: 'about:blank',
      title: 'Bad Gateway',
      status: HttpStatus.BAD_GATEWAY,
      detail: 'The referral could not be registered with ICMS. Push it again to retry.',
    },
    { code: 'icms-push-failed', error },
  );
}
