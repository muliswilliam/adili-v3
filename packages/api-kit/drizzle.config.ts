import { defineConfig } from 'drizzle-kit';

// Migrations for the integration tests only; services generate their own from this schema.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/idempotency/schema.ts',
  out: './test/migrations',
  casing: 'snake_case',
});
