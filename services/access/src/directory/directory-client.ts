/** A Commission as requests name it (directory.yaml `InternalCommission`). */
export interface CommissionFacts {
  slug: string;
  /** The issuer segment of its reference numbers (ADR-011), e.g. `PSC`. */
  issuerCode: string;
  name: string;
}

/**
 * A roster record the access officer resolves the officer named in a request to
 * (directory.yaml `InternalRosterRecord`): its declarant's person, once onboarded.
 */
export interface RosterRecordFacts {
  id: string;
  personnelFileNumber: string;
  fullName: string;
  /** Null until the officer has onboarded (no declarant account yet). */
  personId: string | null;
}

/**
 * Whether an applicant's identity is established (directory.yaml `InternalApplicant`): a national
 * ID matched against IPRS at onboarding, or a passport an access officer verified.
 */
export type ApplicantIdentityStatus = 'verified' | 'pending-verification';

/** What a request needs of its applicant's person record (directory.yaml `InternalApplicant`). */
export interface ApplicantFacts {
  personId: string;
  identityStatus: ApplicantIdentityStatus;
}

/** An access officer's verification of a passport applicant, recorded in the directory. */
export interface ApplicantVerificationInput {
  personId: string;
  /** The Commission the access officer acts for (`X-Acting-Tenant`). */
  tenant: string;
  /** The access officer's token subject. */
  verifiedBy: string;
  /** The same key for the same verification, so a retry records it once. */
  idempotencyKey: string;
}

/** A staff account of a Commission holding a role (e.g. its access officers, for reminders). */
export interface StaffMember {
  subject: string;
  email: string;
}

/** The directory is unreachable or answered outside its contract; callers retry. */
export class DirectoryUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DirectoryUnavailable';
  }
}

/**
 * What the access service reads from the directory's internal API. A Nest token: the service
 * uses `HttpDirectoryClient`, tests a fake.
 */
export abstract class DirectoryClient {
  /** The Commission's name and issuer code; null when no active Commission has this slug. */
  abstract findCommission(slug: string): Promise<CommissionFacts | null>;

  /** Every active Responsible Commission, as applicants choose among them. */
  abstract listCommissions(): Promise<CommissionFacts[]>;

  /** One roster record of the Commission; null when it has none with this id. */
  abstract rosterRecord(slug: string, recordId: string): Promise<RosterRecordFacts | null>;

  /** The Commission's staff accounts holding `role`, with the email they sign in with. */
  abstract staffWithRole(slug: string, role: string): Promise<StaffMember[]>;

  /**
   * The applicant person `personId` as the directory holds them (identity status included: it
   * lives in the directory, not in tokens, so a verification counts at once), read for `tenant`;
   * null when no applicant has this id.
   */
  abstract applicant(personId: string, tenant: string): Promise<ApplicantFacts | null>;

  /**
   * Records that an access officer verified the applicant's particulars: their identity status
   * becomes `verified`, on the person and the account. Idempotent (an applicant verified already
   * is returned as is); null when no applicant has this id.
   */
  abstract verifyApplicantIdentity(
    input: ApplicantVerificationInput,
  ): Promise<ApplicantFacts | null>;
}
