/** The authenticated caller, derived only from verified token claims (ADR-013 §5). */
export interface Principal {
  /** Keycloak user or service-account ID (`sub`). */
  subject: string;
  /** Responsible Commission (or `eacc` / `platform`) the caller acts for. */
  tenant: string | null;
  roles: readonly string[];
  /** OAuth client that obtained the token (`azp`). */
  clientId: string | null;
}
