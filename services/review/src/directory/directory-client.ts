/**
 * The clarification periods of a Commission's policy in force (directory.yaml
 * `TenantPolicyVersion.clarification`, Act s.35).
 */
export interface ClarificationPolicy {
  /** How long after receipt the Commission may request clarification. */
  issueWindowMonths: number;
  /** How long the declarant has to respond. */
  replyWindowDays: number;
}

/**
 * The enforcement ladder's windows of a Commission's policy (spec 08, Administrative Mechanisms):
 * how long the declarant has to act after a notice to comply, a warning and a salary stoppage.
 */
export interface LadderPolicy {
  noticeWindowDays: number;
  warningWindowDays: number;
  stoppageWindowDays: number;
}

/**
 * The windows while the directory's policy has no `ladder` fields (directory.yaml
 * `TenantPolicyVersion` does not carry them yet): 14 days after a notice, 14 after a warning, 30
 * after a stoppage, as spec 08 sets them.
 */
export const DEFAULT_LADDER_POLICY: LadderPolicy = {
  noticeWindowDays: 14,
  warningWindowDays: 14,
  stoppageWindowDays: 30,
};

/** A Commission as its letters and messages name it (directory.yaml `InternalCommission`). */
export interface CommissionFacts {
  slug: string;
  /** The issuer segment of its reference numbers (ADR-011), e.g. `PSC`. */
  issuerCode: string;
  name: string;
}

/**
 * What payroll needs of a roster record (directory.yaml `InternalRosterRecord`, and
 * `RosterNationalId` for the national ID), read at send time
 * (spec 08). Personal data: used where it is read, never stored, logged or put in workflow history.
 */
export interface PayrollRosterFacts {
  /** The personal number payroll knows the officer by: the roster's personnel file number. */
  personalNumber: string;
  nationalId: string;
  /**
   * The payroll employer code; null while the directory's roster record does not carry one
   * (directory.yaml has no such field yet).
   */
  employerCode: string | null;
  /** The reporting entity (the employer the disciplinary referral is for); null when none. */
  reportingEntityId: string | null;
}

/** The directory is unreachable or answered outside its contract; activities retry. */
export class DirectoryUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DirectoryUnavailable';
  }
}

/**
 * What the review service reads from the directory's internal API. A Nest token: the service
 * uses `HttpDirectoryClient` behind a cache, tests a fake.
 */
export abstract class DirectoryClient {
  /** The Commission's clarification periods; throws `DirectoryUnavailable` for no policy. */
  abstract getClarificationPolicy(slug: string): Promise<ClarificationPolicy>;

  /**
   * The Commission's ladder windows (`ladder` of its policy in force), each defaulting to
   * `DEFAULT_LADDER_POLICY`; throws `DirectoryUnavailable` for no policy.
   */
  abstract getLadderPolicy(slug: string): Promise<LadderPolicy>;

  /** The Commission's name and issuer code; throws `DirectoryUnavailable` for no Commission. */
  abstract getCommission(slug: string): Promise<CommissionFacts>;

  /**
   * What payroll needs of one roster record of the Commission (`internalGetRosterRecord` and
   * `internalGetRosterNationalId`); null when the Commission has no such record. Never cached: read each time an instruction is sent.
   */
  abstract getRosterRecord(slug: string, recordId: string): Promise<PayrollRosterFacts | null>;
}
