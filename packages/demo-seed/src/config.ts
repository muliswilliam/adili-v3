import { z } from 'zod';

/**
 * Where the seed finds the stack. The defaults are the local stack (`pnpm infra:up`, `pnpm dev`);
 * the hosted VM runs the same ports behind its own host, so the defaults serve there too.
 */
const schema = z.object({
  DIRECTORY_URL: z.url().default('http://localhost:4001'),
  DECLARATIONS_URL: z.url().default('http://localhost:4002'),
  REVIEW_URL: z.url().default('http://localhost:4003'),
  ACCESS_URL: z.url().default('http://localhost:4004'),
  REPORTING_URL: z.url().default('http://localhost:4005'),
  DOCUMENTS_URL: z.url().default('http://localhost:4006'),
  AI_GATEWAY_URL: z.url().default('http://localhost:4008'),
  MOCKS_URL: z.url().default('http://localhost:8000'),
  MAILPIT_URL: z.url().default('http://localhost:8025'),
  KEYCLOAK_URL: z.url().default('http://localhost:8080'),
  /** Temporal, for triggering the services' daily sweeps instead of waiting for them. */
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('adili'),
  KEYCLOAK_REALM: z.string().default('adili'),
  KEYCLOAK_ADMIN_USER: z.string().default('admin'),
  KEYCLOAK_ADMIN_PASSWORD: z.string().default('admin_dev'),
  /** The confidential client the seed signs demo accounts in through (the portal's). */
  DEMO_SIGN_IN_CLIENT_ID: z.string().default('portal'),
  DEMO_SIGN_IN_CLIENT_SECRET: z.string().default('portal-dev-secret'),
  DEMO_SIGN_IN_REDIRECT_URI: z.url().default('http://localhost:3010/auth/callback'),
  /** Signs demo sign-in tickets; the Keycloak demo authenticator holds the same secret. */
  DEMO_TICKET_SECRET: z.string().default('adili-dev-demo-ticket-secret-change-me-for-real-use'),
  /** The password every demo account has, so it can also sign in by hand. */
  DEMO_PASSWORD: z.string().default('Adili-Demo-2026'),
  /** Postgres for `demo:fingerprint` only; the seed itself never touches a database. */
  DEMO_FINGERPRINT_DATABASE_URL: z
    .string()
    .default('postgres://postgres:postgres_dev@localhost:55432'),
  /**
   * Synthetic officers per volume Commission (psc gets a fifth: every PSC case runs the AI
   * copilot, which the other Commissions' gate keeps off).
   */
  DEMO_SEED_VOLUME: z.coerce.number().int().min(0).max(10_000).default(500),
  /** Fixes every generated date, so a re-run on a later day asks for the same people. */
  DEMO_SEED_ANCHOR: z.iso.date().default('2026-10-01'),
  /** Requests in flight at once for bulk steps. */
  DEMO_SEED_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
});

export type SeedConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SeedConfig {
  return schema.parse(env);
}
