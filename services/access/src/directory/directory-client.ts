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
}
