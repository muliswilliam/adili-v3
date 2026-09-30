import { z } from 'zod';

/** The authenticated caller, derived only from verified token claims (ADR-013 §5). */
export interface Principal {
  /** Keycloak user or service-account ID (`sub`). */
  subject: string;
  /** Responsible Commission (or `eacc` / `platform`) the caller acts for. */
  tenant: string | null;
  roles: readonly string[];
  /** OAuth scopes granted to the token (`scope`), e.g. `messages` for service clients. */
  scopes: readonly string[];
  /** OAuth client that obtained the token (`azp`). */
  clientId: string | null;
  /**
   * Display name for audit fields ("created by"): the `name` claim, else `preferred_username`
   * (a service account's is `service-account-<client id>`). Never used for access decisions.
   */
  name: string | null;
  /**
   * When the token was issued (`iat`), in seconds since the epoch; null when it has none. Lets a
   * service refuse tokens issued before a credential was rotated or revoked.
   */
  issuedAt: number | null;
  /**
   * The declarant's person (`person_id` claim, set when onboarding links the account to a person);
   * null for staff and service tokens. Declarant data is keyed by it, not by tenant.
   */
  personId: string | null;
  /**
   * Authentication context class the token was issued at (`acr`): `step-up` after a fresh
   * one-time code (spec 06), else Keycloak's level such as `1`; null when the token has none.
   * A legal act checks it with `authTime` itself, never trusting the BFF.
   */
  acr: string | null;
  /**
   * When the user last actively authenticated (`auth_time`), in seconds since the epoch; null
   * for tokens without it, such as service accounts'.
   */
  authTime: number | null;
}

/**
 * The calling service: its OAuth client (`azp`), else the token subject. Services key what
 * they keep for a caller (messages, jobs) by it, so only that caller can read it back.
 */
export function callerOf(principal: Principal): string {
  return principal.clientId ?? principal.subject;
}

/** `Principal` for API documentation, e.g. a service's `/v1/me`. */
export const principalSchema = z.object({
  subject: z.string().meta({ description: 'Keycloak user or service-account ID (`sub`)' }),
  tenant: z.string().nullable().meta({
    description: 'Responsible Commission (or `eacc` / `platform`) the caller acts for',
  }),
  roles: z.array(z.string()).meta({ description: 'Realm roles from the token' }),
  scopes: z.array(z.string()).meta({
    description: 'OAuth scopes granted to the token (`scope`), e.g. `messages` for service clients',
  }),
  clientId: z
    .string()
    .nullable()
    .meta({ description: 'OAuth client that obtained the token (`azp`)' }),
  name: z.string().nullable().meta({
    description: 'Display name: the `name` claim, else `preferred_username`',
  }),
  issuedAt: z.int().nullable().meta({
    description: 'When the token was issued (`iat`), in seconds since the epoch',
  }),
  personId: z.uuid().nullable().meta({
    description: 'Person the declarant account is linked to (`person_id`); null for staff',
  }),
  acr: z.string().nullable().meta({
    description: 'Authentication context class of the token (`acr`), e.g. `step-up`',
  }),
  authTime: z.int().nullable().meta({
    description: 'When the user last authenticated (`auth_time`), in seconds since the epoch',
  }),
}) satisfies z.ZodType<Principal>;
