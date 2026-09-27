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
