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
}) satisfies z.ZodType<Principal>;
