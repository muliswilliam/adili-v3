/**
 * Keycloak realm roles (infra/compose/keycloak/adili-realm.json) and the groups of them that a
 * service enforces and an app shows, and the client scopes a service admits and its callers ask
 * for, defined once so the two sides cannot drift apart. A group lives
 * here only when both sides check it; a role list one side alone uses stays with that side.
 */

/** Holds declaration obligations and files declarations in the portal. */
export const DECLARANT = 'declarant';

/** Imports and maintains a Commission's roster. */
export const REPORTING_OFFICER = 'reporting-officer';

/** Analyses a Commission's declarations. */
export const REVIEWER = 'reviewer';

/** Approves what a Commission's reviewers propose. */
export const SUPERVISOR = 'supervisor';

/** Administers a Commission: its users, policies and templates. */
export const COMMISSION_ADMIN = 'commission-admin';

/** Decides Form K and law enforcement requests for declarations. */
export const ACCESS_OFFICER = 'access-officer';

/** EACC analyst: national oversight. */
export const EACC_ANALYST = 'eacc-analyst';

/** EACC supervisor: national oversight. */
export const EACC_SUPERVISOR = 'eacc-supervisor';

/** The tenant key of every EACC account (the `tenant` claim): national oversight, no Commission. */
export const EACC_TENANT = 'eacc';

/** Investigates the audit trail across the platform. */
export const AUDITOR = 'auditor';

/** Helps users unlock accounts and recover access. */
export const HELPDESK = 'helpdesk';

/** Runs the platform; reads every Commission. */
export const PLATFORM_ADMIN = 'platform-admin';

/** Requests access to declarations on behalf of a law enforcement agency. */
export const LAW_ENFORCEMENT = 'law-enforcement';

/**
 * The tenant key of every law-enforcement account (the `tenant` claim): officers belong to no
 * Commission, and request access from any of them (spec 10).
 */
export const LAW_ENFORCEMENT_TENANT = 'lea';

/**
 * A member of the public who applies to see a declaration (Form K, Act s.36(1)); holds no
 * Commission tenant.
 */
export const APPLICANT = 'applicant';

/** A Responsible Commission's own staff, who work on its declarants (spec 04: its obligations). */
export const COMMISSION_STAFF_ROLES = [
  REPORTING_OFFICER,
  REVIEWER,
  SUPERVISOR,
  COMMISSION_ADMIN,
] as const;

/** The Commission's staff who work on its roster: its reporting officer and commission admin. */
export const COMMISSION_ROSTER_ROLES = [REPORTING_OFFICER, COMMISSION_ADMIN] as const;

/**
 * The Commission's staff who see its Form M (spec 09 authorisation): the supervisor compiles and
 * reviews, the commission-admin confirms and submits, the reporting officer reads; all three read
 * the submitted report, its PDF and the receipt.
 */
export const FORM_M_ROLES = [SUPERVISOR, COMMISSION_ADMIN, REPORTING_OFFICER] as const;

/** EACC's oversight roles: counts for any Commission, never its declarants (spec 04). */
export const EACC_ROLES = [EACC_ANALYST, EACC_SUPERVISOR] as const;

/** National roles, who read every Commission: platform admins and EACC. */
export const NATIONAL_ROLES = [PLATFORM_ADMIN, ...EACC_ROLES] as const;

/*
 * OAuth client scopes of the realm's service clients: the scope a service's internal API admits
 * and the one its callers' tokens ask for, named once.
 */

/** The directory's internal pulls (roster records, policy, Commission references). */
export const DIRECTORY_INTERNAL_SCOPE = 'directory:internal';

/**
 * A person's verified contacts in the directory: personal data, so a scope of its own, held by
 * the notifications client alone (spec 04).
 */
export const DIRECTORY_PERSON_CONTACTS_SCOPE = 'directory:person-contacts';

/**
 * Applicants' particulars in the directory (identity document, identity status, contacts):
 * personal data, so a scope of its own, held by the access client alone, which reads them for
 * Form K and records an access officer's manual verification of a passport applicant (spec 10).
 */
export const DIRECTORY_APPLICANTS_SCOPE = 'directory:applicants';

/**
 * A roster record's national ID in the directory: personal data, so a scope of its own, held by
 * the review client alone for payroll's salary stoppage and the ICMS referral (spec 08).
 */
export const DIRECTORY_ROSTER_NATIONAL_ID_SCOPE = 'directory:roster-national-id';

/**
 * The declarations service's internal API, acting for the Commission: the fields of a submitted
 * version's acknowledgement slip, pulled by the documents service (spec 06), and a submitted
 * version's document and the version before it, read by the review service (spec 07a).
 */
export const DECLARATIONS_INTERNAL_SCOPE = 'declarations:internal';

/**
 * The declarations service's disclosures to third parties (spec 10): a grant's scoped disclosure
 * and a version in full for a certified copy, decrypted for someone other than a Commission's
 * staff. A scope of its own, held by the access client alone: nothing else in the platform
 * decrypts declarations for a third party.
 */
export const DECLARATIONS_DISCLOSURES_SCOPE = 'declarations:disclosures';

/**
 * Law-enforcement officers' accounts in the directory (names, agency, Keycloak account and its
 * state): personal data, so a scope of its own, held by the access client alone, which checks a
 * law-enforcement request's provenance against them (spec 10).
 */
export const DIRECTORY_LAW_ENFORCEMENT_SCOPE = 'directory:law-enforcement';

/**
 * A federated Commission's own system (client credentials, `tenant` = the Commission): files its
 * Form M through the reporting service's API and reads its own submitted report, its PDF and the
 * receipt (spec 09).
 */
export const REPORTS_SUBMIT_SCOPE = 'reports:submit';

/** The documents service's internal API (roster upload downloads, acting for a tenant). */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

/** The notifications messages API (`POST /internal/v1/messages`). */
export const MESSAGES_SCOPE = 'messages';

/** The review service's internal API: letter payloads the documents service renders (spec 07a). */
export const REVIEW_INTERNAL_SCOPE = 'review:internal';

/**
 * The integration-gateway's registry lookups (KRA, NTSA, BRS, ArdhiSasa and the employer-supplier
 * check) and stored result reads, acting for the Commission: registry data on officers and their
 * households, so a scope of its own, held by the review client (spec 07b).
 */
export const REGISTRY_SCOPE = 'registry';

/**
 * The integration-gateway's payroll instructions: salary stoppage and its reinstatement under the
 * Administrative Mechanisms, sent only after a recorded decision (ADR-009). A scope of its own,
 * held by the review client alone (spec 08).
 */
export const PAYROLL_SCOPE = 'payroll';

/**
 * The integration-gateway's ICMS referrals: registering a Commission's referral with EACC's case
 * management system (Regs r.20) and reading its case number. A scope of its own, held by the
 * reporting client alone (spec 09).
 */
export const ICMS_SCOPE = 'icms';

/**
 * The review service's disclosures to third parties (spec 10): the clarifications an access grant
 * discloses with the declarations. A scope of its own, held by the access client alone, like
 * `declarations:disclosures`.
 */
export const REVIEW_DISCLOSURES_SCOPE = 'review:disclosures';
