/**
 * A clarification as the review service describes it for Form M section 4 (BE-5 internal batch
 * details): the officer asked and the nature of the request in general terms, never its content.
 */
export interface ClarificationDetails {
  clarificationId: string;
  /** `CLR-...`; null for one never issued. */
  reference: string | null;
  name: string;
  designation: string;
  /** Personnel file number, or another staff, ID or passport number. */
  identifier: string;
  /** Labels of the requirement kinds asked for, e.g. "Source of income". */
  requirementLabels: string[];
}

/**
 * What ICMS needs of a referral (BE-5 `GET /internal/v1/review/referrals/{id}/icms-payload`), in
 * the names of review's `ReferralPackagePayload` (#212): the `RFL` reference, the grounds and
 * their label, the referring Commission, the declarant's name and national ID, and the narrative.
 * Personal data: it passes to the gateway only, never into the database, events or workflow
 * history.
 */
export interface ReferralIcmsPayload {
  reference: string;
  grounds: string;
  groundsLabel: string;
  commission: { name: string; issuerCode: string };
  declarant: { name: string; nationalId: string };
  narrative: string;
}

/** Review is unreachable or answered outside its contract; activities retry. */
export class ReviewUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReviewUnavailable';
  }
}

/**
 * What the reporting service reads from the review internal API. A Nest token: the service uses
 * `HttpReviewClient`, tests a fake.
 */
export abstract class ReviewClient {
  /**
   * The clarifications `clarificationIds` of Commission `tenant`; one review does not know for
   * the Commission is left out.
   */
  abstract clarificationDetails(
    tenant: string,
    clarificationIds: string[],
  ): Promise<ClarificationDetails[]>;

  /**
   * What ICMS needs of the referral `referralId` of Commission `tenant`; null when review knows
   * no sent referral by that id. Throws `ReviewUnavailable` when review cannot be reached.
   */
  abstract referralIcmsPayload(
    tenant: string,
    referralId: string,
  ): Promise<ReferralIcmsPayload | null>;
}
