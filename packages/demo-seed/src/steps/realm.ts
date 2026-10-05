import { repoScript } from '../repo.js';
import type { SeedStep } from '../step.js';

/**
 * Demo sign-in on the realm (#616), before anything signs in: the demo authenticator, the
 * admin-only `demo_key` attribute, its claim on portal and console tokens, and the realm's demo
 * users' keys. Keycloak imports the realm file only when the realm is missing, so a stack whose
 * realm predates any of these never gets them from the file: without the claim, the apps' role
 * switcher cannot tell who is signed in ("Act as" instead of "Acting as Kiprono Chebet"). The
 * script that applies them to a deployed realm (`pnpm keycloak:demo-sign-in`, run by every Azure
 * deploy) does it here too, so every seeded stack has them.
 */
export const demoSignIn: SeedStep = {
  id: 'demo-sign-in',
  title: 'Demo sign-in on the realm: authenticator, demo_key attribute and claim',
  async run({ config }) {
    const outcome = await repoScript('scripts/keycloak-demo-sign-in.mjs', {
      // Admin calls: the hosted VM serves Keycloak's admin API on loopback only.
      KEYCLOAK_URL: config.KEYCLOAK_ADMIN_URL ?? config.KEYCLOAK_URL,
      KEYCLOAK_ADMIN_USER: config.KEYCLOAK_ADMIN_USER,
      KEYCLOAK_ADMIN_PASSWORD: config.KEYCLOAK_ADMIN_PASSWORD,
    });
    return { changed: outcome === 'changed' ? 1 : 0 };
  },
};
