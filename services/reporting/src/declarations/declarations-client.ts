/**
 * An officer as the declarations service knows them for one obligation (BE-5 internal batch
 * details, `POST /internal/v1/obligations/details`): what a Form M non-filer row names.
 */
export interface OfficerDetails {
  obligationId: string;
  name: string;
  designation: string;
  /** Personnel file number, or another staff, ID or passport number. */
  fileNumber: string;
  appointmentDate: string | null;
  exitDate: string | null;
}

/** The most obligation ids one details request carries. */
export const OFFICER_DETAILS_PAGE = 1_000;

/** Declarations is unreachable or answered outside its contract; activities retry. */
export class DeclarationsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeclarationsUnavailable';
  }
}

/**
 * What the reporting service reads from the declarations internal API. A Nest token: the
 * service uses `HttpDeclarationsClient`, tests a fake.
 */
export abstract class DeclarationsClient {
  /**
   * The officers behind `obligationIds` of Commission `tenant`, pulled in pages of 1,000; an
   * obligation declarations does not know for the Commission is left out.
   */
  abstract officerDetails(tenant: string, obligationIds: string[]): Promise<OfficerDetails[]>;
}
