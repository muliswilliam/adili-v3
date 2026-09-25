/**
 * A dependency the service needs to serve traffic (database, broker, workflow engine...).
 * Implementations are Nest providers; list them in `CoreModule.forRoot({ readiness })`.
 */
export abstract class ReadinessCheck {
  abstract readonly name: string;
  /** Resolves when the dependency is usable; rejects with the reason otherwise. */
  abstract check(): Promise<void>;
}
