/** A Commission as Form M Part I names it (directory.yaml `InternalCommission`). */
export interface CommissionFacts {
  slug: string;
  /** The issuer segment of its reference numbers (ADR-011), e.g. `PSC`. */
  issuerCode: string;
  name: string;
}

/** A staff account of a Commission holding a role (BE-5 staff by role). */
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
 * What the reporting service reads from the directory's internal API. A Nest token: the service
 * uses `HttpDirectoryClient`, tests a fake.
 */
export abstract class DirectoryClient {
  /** The Commission's name and issuer code; throws `DirectoryUnavailable` for no Commission. */
  abstract getCommission(slug: string): Promise<CommissionFacts>;

  /** The Commission's staff accounts holding `role`, with the email they sign in with. */
  abstract staffWithRole(slug: string, role: string): Promise<StaffMember[]>;

  /**
   * Every active Responsible Commission, as EACC's intake lists them and its chase goes through
   * them.
   */
  abstract listCommissions(): Promise<CommissionFacts[]>;
}
