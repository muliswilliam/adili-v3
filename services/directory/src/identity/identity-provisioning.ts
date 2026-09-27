/**
 * Identity provisioning: the directory's only seam onto the identity provider (Keycloak).
 * Staff accounts are created, activated and retired through this interface; the Keycloak
 * adapter is used in every environment and the in-memory adapter in API tests.
 */

/** Keycloak required actions a staff account must complete before first use. */
export type RequiredAction = 'VERIFY_EMAIL' | 'UPDATE_PASSWORD' | 'CONFIGURE_TOTP';

/** What a new staff account must do on activation: verify email, set a password, enrol MFA. */
export const STAFF_REQUIRED_ACTIONS: readonly RequiredAction[] = [
  'VERIFY_EMAIL',
  'UPDATE_PASSWORD',
  'CONFIGURE_TOTP',
];

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

export interface ActivationEmailOptions {
  /** Actions the emailed link walks the user through. */
  actions: readonly RequiredAction[];
  /** How long the link stays valid. */
  lifespanSeconds: number;
  /** Where the user lands after completing the actions; must be a valid redirect of `clientId`. */
  redirectUri: string;
  /** OAuth client the redirect belongs to, e.g. `console`. */
  clientId: string;
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

  /** Adds a realm role. Idempotent. @throws IdentityUserNotFound */
  abstract grantRole(userId: string, role: string): Promise<void>;

  /** Removes a realm role. Idempotent. @throws IdentityUserNotFound */
  abstract revokeRole(userId: string, role: string): Promise<void>;

  /** Enables or disables sign-in, keeping everything else. Idempotent. @throws IdentityUserNotFound */
  abstract setEnabled(userId: string, enabled: boolean): Promise<void>;

  /** Deletes the account. Idempotent: an account that does not exist is not an error. */
  abstract deleteUser(userId: string): Promise<void>;

  /**
   * Emails the user a link that performs `actions`, in an email that names the Commission and
   * role they are invited to. Adapters record both on the account first (Keycloak renders the
   * email from the account), overwriting what an earlier invitation recorded.
   * @throws IdentityUserNotFound
   */
  abstract sendActivationEmail(userId: string, options: ActivationEmailOptions): Promise<void>;
}
