/* Generated from @adili/schemas/forms/form-m.v1.json by scripts/generate-types.ts. Do not edit. */

/**
 * One compliance report per Responsible Commission per financial year (1 July to 30 June), mirroring the prescribed Form M: Part I description, Part II declarations (sections 1-5) and complaints (sections 6-7), Part III authentication. Draft: spec 09.
 */
export interface FormMV1 {
  schemaVersion: 'form-m.v1';
  /**
   * Description of the Responsible Commission
   */
  partI: {
    commissionName: string;
    issuerCode: string;
    contactDetails: string;
    physicalAddress: string;
    emailAddress: string;
    period: {
      /**
       * 1 July of the FY start year
       */
      from: string;
      /**
       * 30 June of the following year
       */
      to: string;
      financialYearStart: number;
    };
  };
  partII: {
    initial: DeclarationSection;
    biennial: DeclarationSection & {
      /**
       * True in a financial year with no biennial statement date
       */
      noCycleInPeriod?: boolean;
    };
    final: DeclarationSection;
    /**
     * Section 4: public officers from whom clarification was sought and status of compliance
     */
    clarifications: {
      items: {
        name: string;
        designation: string;
        /**
         * Staff, file, ID or passport number
         */
        identifier: string;
        natureInGeneralTerms: string;
        statusOfCompliance: 'responded' | 'resolved' | 'pending' | 'overdue' | 'withdrawn';
        clarificationReference?: string;
      }[];
    };
    /**
     * Section 5: access to information in declarations or clarifications (Act s.36)
     */
    accessRequests: {
      received: number;
      granted: number;
      declined: number;
      declineReasons: {
        /**
         * Regs r.24 grounds
         */
        reason:
          | 'public-interest'
          | 'prejudice-proceeding'
          | 'frivolous-vexatious'
          | 'not-objectives'
          | 'other';
        count: number;
      }[];
      /**
       * True when access-request data is not yet captured on the platform
       */
      dataUnavailable: boolean;
    };
    /**
     * Part B, sections 6-7: complaints and investigations (entered manually)
     */
    complaints: {
      registerMaintained: boolean | null;
      items: {
        name: string;
        designation: string;
        identifier: string;
        nature: string;
        status: string;
      }[];
    };
  };
  /**
   * Authentication of information
   */
  partIII: {
    compiledBy: Signatory;
    confirmedBy: Signatory;
  };
  /**
   * Platform metadata, not part of the prescribed form
   */
  meta?: {
    compiledAt?: string;
    reference?: string;
    source?: 'hosted' | 'federated';
  };
}
/**
 * Sections 1-3: counts and the list of officers who did not declare
 */
export interface DeclarationSection {
  /**
   * Appointed (initial), in service (biennial) or exited (final) within the period
   */
  expected: number;
  declared: number;
  notDeclared: number;
  nonFilers: NonFilerRow[];
  noCycleInPeriod?: boolean;
}
export interface NonFilerRow {
  name: string;
  designation: string;
  /**
   * Staff, file, ID or passport number
   */
  identifier: string;
  /**
   * Date of appointment (initial, biennial) or of exit (final)
   */
  date: string;
  /**
   * Latest administrative action step or none
   */
  actionTaken:
    | 'none'
    | 'notice-to-comply'
    | 'warning'
    | 'salary-stoppage'
    | 'disciplinary-referral'
    | 'referred-to-eacc';
  complied: 'yes' | 'no' | 'pending';
  remarks?: string;
  obligationId?: string;
}
export interface Signatory {
  name: string | null;
  designation: string | null;
  date: string | null;
}
