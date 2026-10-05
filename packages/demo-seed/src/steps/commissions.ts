import { randomUUID } from 'node:crypto';

import { ok } from '../clients/api.js';
import { waitFor } from '../clients/http.js';
import { DEMO_COMMISSIONS } from '../data/commissions.js';
import type { SeedStep } from '../step.js';

/**
 * The demo's five Commissions, each with its reporting officer, as the platform admin sets them
 * up in the console (spec 01). An officer's account is the realm's demo account or the one the
 * directory creates on assignment, which is then made a demo account (`demo_key`, the demo
 * password) so the role switcher and the seed can sign in as it.
 */
export const commissions: SeedStep = {
  id: 'commissions',
  title: 'Commissions and their reporting officers',
  async run(context) {
    const admin = await context.as('platform-admin');
    let changed = 0;
    for (const demo of DEMO_COMMISSIONS) {
      const existing = await admin.directory.GET('/v1/commissions/{slug}', {
        params: { path: { slug: demo.slug } },
      });
      let commission =
        existing.response.status === 404 ? undefined : ok(existing, `read ${demo.slug}`);
      if (!commission) {
        commission = ok(
          await admin.directory.POST('/v1/commissions', {
            params: { header: { 'Idempotency-Key': randomUUID() } },
            body: {
              slug: demo.slug,
              name: demo.name,
              type: 'hosted',
              categories: demo.categories as never,
            },
          }),
          `create Commission ${demo.slug}`,
        );
        changed++;
      }
      const officer = demo.reportingOfficer;
      if (
        commission.reportingOfficer?.email !== officer.email ||
        commission.reportingOfficer.name !== officer.name
      ) {
        ok(
          await admin.directory.PUT('/v1/commissions/{slug}/reporting-officer', {
            params: { path: { slug: demo.slug }, header: { 'Idempotency-Key': randomUUID() } },
            body: { name: officer.name, email: officer.email, phone: officer.phone },
          }),
          `assign ${demo.slug}'s reporting officer`,
        );
        changed++;
      }
      const account = await waitFor(`${officer.email}'s Keycloak account`, () =>
        context.keycloak.userByEmail(officer.email),
      );
      if (await context.keycloak.ensureDemoAccount(account, officer.demoKey)) changed++;
      if (demo.reviewer !== 'reviewer') {
        const staff = {
          username: demo.reviewer,
          email: `${demo.reviewer}@demo.adili.go.ke`,
          firstName: 'Reviewer',
          lastName: demo.slug.toUpperCase(),
          role: 'reviewer',
          tenant: demo.slug,
          demoKey: demo.reviewer,
        };
        if (await context.keycloak.ensureStaffAccount(staff)) changed++;
      }
    }
    return { changed, notes: [DEMO_COMMISSIONS.map((c) => c.slug).join(', ')] };
  },
};
