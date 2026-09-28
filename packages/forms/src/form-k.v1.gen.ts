/* Generated from @adili/schemas/forms/form-k.v1.json by scripts/generate-types.ts. Do not edit. */

/**
 * The prescribed Form K: Part I applicant, Part II the public officer whose declaration is sought, Part III information sought, Part IV declaration of truth; plus the platform's scope fields. Draft: spec 10.
 */
export interface FormKV1 {
  schemaVersion: 'form-k.v1';
  /**
   * Tenant key of the Responsible Commission addressed
   */
  responsibleCommission: string;
  /**
   * Information on applicant
   */
  partI: {
    /**
     * Person or entity applying
     */
    name: string;
    identityDocument: {
      kind: 'national-id' | 'passport';
      number: string;
      /**
       * Issuing country for passports
       */
      country?: string;
    };
    postalAddress: string;
    physicalAddress: string;
    telephone: string;
    email: string;
    occupation: string;
  };
  /**
   * Information on the person whose declaration is sought to be accessed
   */
  partII: {
    name: string;
    /**
     * Entity of the public officer
     */
    entity: string;
    workStation: string;
    /**
     * Optional, if known
     */
    personnelFileNumber?: string;
  };
  /**
   * Information sought
   */
  partIII: {
    informationSought: string;
    /**
     * Reason for requiring the information (legitimate interest and good cause, Act s.36(1))
     */
    reason: string;
    otherInformation: string;
  };
  /**
   * Declaration
   */
  partIV: {
    text: 'I declare that the information I have given above is true, complete and correct to the best of my knowledge.';
    declaredAt: string;
  };
  /**
   * Platform scope fields (Admin Mechanism 31 scoped access)
   */
  scope: {
    /**
     * @minItems 1
     * @maxItems 50
     */
    years: number[];
    includeSpouses: boolean;
    includeChildren: boolean;
    /**
     * @minItems 1
     */
    sections: ('bio' | 'income' | 'assets' | 'liabilities' | 'other')[];
    includeClarifications: boolean;
  };
  meta?: {
    reference?: string;
    submittedAt?: string;
  };
}
