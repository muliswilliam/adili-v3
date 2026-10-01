/**
 * Identity provisioning: the directory's only seam onto the identity provider (Keycloak).
 * Staff accounts are created, activated and retired through this interface, declarant accounts
 * are created or linked to further Commissions when onboarding confirms, and so are the API
 * clients Commissions' HR systems authenticate with; the Keycloak adapter is used in every
 * environment and the in-memory adapter in API tests.
 */

/** Keycloak required actions a staff account must complete before first use. */
export type RequiredAction = 'VERIFY_EMAIL' | 'UPDATE_PASSWORD' | 'CONFIGURE_TOTP';

/** What a new staff account must do on activation: verify email, set a password, enrol MFA. */
export const STAFF_REQUIRED_ACTIONS: readonly RequiredAction[] = [
  'VERIFY_EMAIL',
  'UPDATE_PASSWORD',
  'CONFIGURE_TOTP',
];

/** What a new declarant account must do before first sign-in: set a password. */
export const DECLARANT_REQUIRED_ACTIONS: readonly RequiredAction[] = ['UPDATE_PASSWORD'];

/** An existing account, as far as provisioning decisions need to know. */
export interface IdentityUser {
  userId: string;
  /** Tenant key on the account, or null when the account belongs to no tenant. */
  tenant: string | null;
  enabled: boolean;
  /**
   * Realm roles granted to the account directly, e.g. `reviewer`, `reporting-officer`. The
   * realm's default roles, which every account has, are left out.
   */
  roles: string[];
}

export interface CreateStaffUserInput {
  email: string;
  /** Full name as entered; adapters split it into given and family names. */
  name: string;
  /** E.164. */
  phone: string;
  /** Tenant key; becomes the `tenant` attribute and token claim. */
  tenant: string;
  /** Realm role granted on creation, e.g. `reporting-officer`. */
  role: string;
  requiredActions: readonly RequiredAction[];
}

/**
 * A declarant's account (spec 03), created when onboarding confirms a roster record for a person
 * who has none yet. Their email and phone were verified during onboarding.
 */
export interface CreateDeclarantUserInput {
  /** Officer reference (ADR-011); the account's username and `ofr` attribute. */
  ofr: string;
  /** Verified during onboarding: the account is created with its email verified. */
  email: string;
  /** Full name from the roster record; adapters split it into given and family names. */
  name: string;
  /** E.164, verified during onboarding. */
  phone: string;
  /** Tenant key of the Commission onboarded with: the `tenant` attribute and the first `tenants`. */
  tenant: string;
  /** The directory's person id: the `person_id` attribute. */
  personId: string;
}

/**
 * A law-enforcement officer's account (spec 10), provisioned by a platform admin for an agency.
 * A staff account in all but its attributes: the email as username, tenant `lea`, the
 * `law-enforcement` role and the staff required actions, so the officer verifies the email, sets
 * a password and enrols TOTP, which the staff flow then asks for at every sign-in.
 */
export interface CreateLawEnforcementUserInput {
  /** Official email; the username. */
  email: string;
  /** Full name as entered; adapters split it into given and family names. */
  name: string;
  /** E.164. */
  phone: string;
  /** Agency code, e.g. `DCI`: the `agency` attribute. */
  agency: string;
  /** The directory's person id: the `person_id` attribute (and token claim). */
  personId: string;
}

/** How a staff member is named and reached, as entered by the admin who assigned them. */
export interface StaffProfile {
  /** Full name as entered; adapters split it into given and family names. */
  name: string;
  /** E.164. */
  phone: string;
}

/**
 * A machine client of one tenant (spec #27): a confidential OAuth client that obtains tokens with
 * the client credentials grant. Its tokens carry the `tenant` claim, the `adili-api` audience and
 * `scopes` in the `scope` claim, and no user.
 */
export interface CreateApiClientInput {
  /** Tenant key; every token of the client carries it as the `tenant` claim. */
  tenant: string;
  /** OAuth client id, unique in the realm, e.g. `roster-psc-3f9a2c1d`. */
  clientId: string;
  /** Client scopes granted to every token, e.g. `roster:write`. They must exist in the realm. */
  scopes: readonly string[];
}

/** A client secret as issued. Shown to the caller once; the directory does not store it. */
export interface ApiClientSecret {
  clientId: string;
  secret: string;
}

/** Puts back what a change replaced. */
export type Restore = () => Promise<void>;

/** Keycloak's execute-actions email: a link that walks the user through `actions`. */
export interface ExecuteActionsEmailOptions {
  /** Actions the emailed link walks the user through. */
  actions: readonly RequiredAction[];
  /** How long the link stays valid. */
  lifespanSeconds: number;
  /** Where the user lands after completing the actions; must be a valid redirect of `clientId`. */
  redirectUri: string;
  /** OAuth client the redirect belongs to, e.g. `console`. */
  clientId: string;
}

export interface ActivationEmailOptions extends ExecuteActionsEmailOptions {
  /** Display name of the account's Commission, which the email names ("Teachers Service Commission"). */
  commissionName: string;
  /** Realm role the account is invited to, e.g. `reporting-officer`; the email names it and its duties. */
  role: string;
}

/** The email already belongs to an account. */
export class EmailTaken extends Error {
  override readonly name = 'EmailTaken';

  constructor(readonly email: string) {
    super(`An account with email ${email} already exists`);
  }
}

/**
 * The username belongs to an account that may not be replaced, e.g. an OFR held by an account
 * that is not a declarant account left behind for that OFR. Needs an operator: retrying fails
 * the same way.
 */
export class UsernameTaken extends Error {
  override readonly name = 'UsernameTaken';

  constructor(readonly username: string) {
    super(`An account with username ${username} already exists`);
  }
}

/** The identity provider could not be reached or failed; the operation may be retried. */
export class IdentityUnavailable extends Error {
  override readonly name = 'IdentityUnavailable';
}

/** No account has the given id (for example, it was deleted in Keycloak by hand). */
export class IdentityUserNotFound extends Error {
  override readonly name = 'IdentityUserNotFound';

  constructor(readonly userId: string) {
    super(`No account with id ${userId}`);
  }
}

/** An API client with the requested client id already exists. */
export class ApiClientExists extends Error {
  override readonly name = 'ApiClientExists';

  constructor(readonly clientId: string) {
    super(`An API client ${clientId} already exists`);
  }
}

/** No API client has the given client id (for example, it was deleted in Keycloak by hand). */
export class ApiClientNotFound extends Error {
  override readonly name = 'ApiClientNotFound';

  constructor(readonly clientId: string) {
    super(`No API client ${clientId}`);
  }
}

/**
 * Nest injection token and contract. Emails are compared case-insensitively. Operations are
 * small and idempotent so that callers can undo exactly what they changed when a later step of
 * their unit of work fails. Every operation may throw IdentityUnavailable.
 */
export abstract class IdentityProvisioning {
  /** The account whose email matches, or null. */
  abstract findByEmail(email: string): Promise<IdentityUser | null>;

  /** The account with this id, or null (for example, it was deleted in Keycloak by hand). */
  abstract findById(userId: string): Promise<IdentityUser | null>;

  /**
   * Creates an enabled staff account with the email as username, the tenant attribute,
   * the role and the required actions. Returns the new user id.
   * @throws EmailTaken when an account with that email (or username) exists.
   */
  abstract createStaffUser(input: CreateStaffUserInput): Promise<string>;

  /**
   * Creates an enabled law-enforcement account (see CreateLawEnforcementUserInput): the email as
   * username, the `tenant` (`lea`), `agency`, `person_id` and `phone` attributes, the
   * `law-enforcement` role and the staff required actions. Returns the new user id.
   * @throws EmailTaken when an account with that email (or username) exists.
   */
  abstract createLawEnforcementUser(input: CreateLawEnforcementUserInput): Promise<string>;

  /**
   * Creates an enabled declarant account: the OFR as username, the verified email, the `tenant`,
   * `tenants`, `ofr`, `person_id` and `phone` attributes, the `declarant` role and the
   * `UPDATE_PASSWORD` required action. Returns the new user id.
   *
   * The caller has just allocated the OFR in its transaction, so no committed person has it: an
   * account already holding it is one an earlier attempt created before its transaction rolled
   * back (and whose undo failed). Such a leftover, a declarant account whose `ofr` attribute is
   * this OFR, is deleted and the account created, so the reference can be used again.
   * @throws EmailTaken when another account has the email.
   * @throws UsernameTaken when an account that is not such a leftover has the OFR as username.
   */
  abstract createDeclarantUser(input: CreateDeclarantUserInput): Promise<string>;

  /**
   * Adds `tenant` to the account's multi-valued `tenants` attribute (a person onboarded with
   * another Commission), keeping the single `tenant` attribute as it is, or setting it when the
   * account has none. Returns the call that undoes exactly this change: it takes `tenant` out of
   * `tenants` again (and out of `tenant` if this call set it), leaving any tenant added since in
   * place; or null when the account already had `tenant`.
   * @throws IdentityUserNotFound
   */
  abstract addTenantToUser(userId: string, tenant: string): Promise<Restore | null>;

  /** Adds a realm role. Idempotent. @throws IdentityUserNotFound */
  abstract grantRole(userId: string, role: string): Promise<void>;

  /** Removes a realm role. Idempotent. @throws IdentityUserNotFound */
  abstract revokeRole(userId: string, role: string): Promise<void>;

  /** Enables or disables sign-in, keeping everything else. Idempotent. @throws IdentityUserNotFound */
  abstract setEnabled(userId: string, enabled: boolean): Promise<void>;

  /**
   * Sets the account's name and phone, keeping everything else. Returns the call that puts the
   * previous name and phone back exactly, or null when the account already had these.
   * @throws IdentityUserNotFound
   */
  abstract updateProfile(userId: string, profile: StaffProfile): Promise<Restore | null>;

  /** Deletes the account. Idempotent: an account that does not exist is not an error. */
  abstract deleteUser(userId: string): Promise<void>;

  /**
   * Emails the user a link that performs `actions`, in an email that names the Commission and
   * role they are invited to. Adapters record both on the account first (Keycloak renders the
   * email from the account), overwriting what an earlier invitation recorded.
   * @throws IdentityUserNotFound
   */
  abstract sendActivationEmail(userId: string, options: ActivationEmailOptions): Promise<void>;

  /**
   * Emails the user a link that performs `options.actions`, without recording anything on the
   * account (e.g. a declarant's set-password email). Each call sends a new email.
   * @throws IdentityUserNotFound
   */
  abstract sendExecuteActionsEmail(
    userId: string,
    options: ExecuteActionsEmailOptions,
  ): Promise<void>;

  /**
   * Creates an enabled API client of `tenant` with a generated secret (see CreateApiClientInput)
   * and returns the secret.
   * @throws ApiClientExists when a client with that client id exists, enabled or not.
   */
  abstract createApiClient(input: CreateApiClientInput): Promise<ApiClientSecret>;

  /**
   * Replaces the client's secret with a new one and returns it. The previous secret stops
   * working at once; tokens already issued stay valid until they expire.
   * @throws ApiClientNotFound
   */
  abstract rotateApiClientSecret(clientId: string): Promise<ApiClientSecret>;

  /**
   * Disables the client: it obtains no more tokens (tokens already issued stay valid until they
   * expire). Idempotent: a client that is already disabled, or does not exist, is not an error.
   */
  abstract disableApiClient(clientId: string): Promise<void>;
}
