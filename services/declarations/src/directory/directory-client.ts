/**
 * A roster record as the directory's internal pulls give it (`InternalRosterRecord`), the fields
 * the declarations service keeps.
 */
export interface PulledRosterRecord {
  id: string;
  tenant: string;
  personnelFileNumber: string;
  fullName: string;
  state: 'not_onboarded' | 'onboarded' | 'exited';
  appointmentDate: string | null;
  exitDate: string | null;
  personId: string | null;
  ofr: string | null;
  onboardedAt: string | null;
  updatedAt: string;
}

/** The Commission policy version in force (`TenantPolicyVersion`), the fields the rules read. */
export interface PulledPolicy {
  id: string;
  version: number;
  obligationsStartDate: string;
  initialDueAfterAppointmentDays: number;
  biennial: { statementDate: string; dueDate: string };
  finalDueAfterExitDays: number;
  reminderOffsetsDays: number[];
}

/** How a Commission is named (`InternalCommission`). */
export interface PulledCommission {
  slug: string;
  issuerCode: string;
  name: string;
}

/** Which records to pull: those an import had rows for, or those an exit batch exited. */
export type RosterRecordSelector = { importId: string } | { exitBatchId: string };

export interface PulledRosterRecordPage {
  items: PulledRosterRecord[];
  /** Pass back for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * The directory is unreachable, refused the service's token, or answered something outside its
 * contract. Event consumers let it propagate so the event is retried (the inbox entry is not
 * written).
 */
export class DirectoryUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DirectoryUnavailable';
  }
}

/**
 * What the declarations service pulls from the directory's internal API after a roster event
 * (ADR-013 local read models), acting for the event's Commission. A Nest token: the service uses
 * `HttpDirectoryClient`, tests a fake.
 */
export abstract class DirectoryClient {
  /** One page (up to 1,000) of the records an import or exit batch touched, each as it is now. */
  abstract listRosterRecords(
    slug: string,
    selector: RosterRecordSelector,
    cursor: string | null,
  ): Promise<PulledRosterRecordPage>;

  /** One record; null when the Commission has no such record. */
  abstract getRosterRecord(slug: string, recordId: string): Promise<PulledRosterRecord | null>;

  /** The policy version in force for the Commission. */
  abstract getPolicy(slug: string): Promise<PulledPolicy>;

  /** The Commission's slug, issuer code and name. */
  abstract getCommission(slug: string): Promise<PulledCommission>;

  /** Every Commission of the platform, by slug (no tenant to act for). */
  abstract listCommissions(): Promise<PulledCommission[]>;
}
