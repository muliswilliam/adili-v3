import { randomUUID } from 'node:crypto';

import { type Apis, ok } from '../clients/api.js';
import { mapLimit, waitFor } from '../clients/http.js';
import type { SeedContext } from '../context.js';
import { DEMO_COMMISSIONS } from '../data/commissions.js';
import { PERSONAS, TIMED_OFFICERS } from '../data/personas.js';
import { REFERRAL_OFFICER } from '../data/review.js';
import { fixtureRoster } from '../data/roster.js';
import { syntheticOfficers } from '../data/synthetic.js';
import type { SeedStep } from '../step.js';

/** An officer the seed onboards, and the `demo_key` their account gets. */
export interface Onboardee {
  commission: string;
  personnelFileNumber: string;
  nationalId: string;
  email: string;
  phone: string;
  demoKey: string;
}

/** The `demo_key` of a synthetic officer's account: only the seed signs in as them. */
export function syntheticDemoKey(nationalId: string): string {
  return `synthetic-${nationalId}`;
}

/** Every officer the demo has onboarded at `0-start`: the personas, the timed officers, the volume. */
export async function onboardees(context: SeedContext): Promise<Onboardee[]> {
  const people: Onboardee[] = [];
  for (const persona of PERSONAS) {
    const row = fixtureRoster(persona.commission).find((r) => r.nationalId === persona.nationalId);
    if (!row)
      throw new Error(`Persona ${persona.demoKey} is not in the ${persona.commission} fixture`);
    people.push({ ...row, commission: persona.commission, demoKey: persona.demoKey });
  }
  const referral = fixtureRoster(REFERRAL_OFFICER.commission).find(
    (r) => r.nationalId === REFERRAL_OFFICER.nationalId,
  );
  if (!referral) throw new Error('The referral officer is not in the eacc roster fixture');
  people.push({
    ...referral,
    commission: REFERRAL_OFFICER.commission,
    demoKey: REFERRAL_OFFICER.demoKey,
  });
  for (const timed of TIMED_OFFICERS)
    people.push({ ...timed.row, commission: 'psc', demoKey: timed.demoKey });
  for (const [slug, officers] of await syntheticOfficers(context)) {
    for (const officer of officers) {
      people.push({ ...officer, commission: slug, demoKey: syntheticDemoKey(officer.nationalId) });
    }
  }
  return people;
}

/** The roster records already onboarded, by personnel file number, with their OFR. */
async function onboardedRecords(api: Apis, slug: string): Promise<Map<string, string>> {
  const onboarded = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = ok(
      await api.directory.GET('/v1/commissions/{slug}/roster/records', {
        params: {
          path: { slug },
          query: { state: 'onboarded', limit: 200, ...(cursor && { cursor }) },
        },
      }),
      `list ${slug} onboarded records`,
    );
    for (const record of page.items) {
      if (record.ofr) onboarded.set(record.personnelFileNumber.toUpperCase(), record.ofr);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return onboarded;
}

/**
 * Onboards one officer through the portal's public onboarding API (spec 03), reading the codes
 * from Mailpit and the SMS inbox as the officer would read them, and returns their OFR (the
 * account's username).
 */
async function onboard(context: SeedContext, officer: Onboardee): Promise<string> {
  const api = context.anonymous.directory;
  const started = new Date(Date.now() - 1000);
  const session = ok(
    await api.POST('/v1/onboarding/sessions', {
      body: {
        commission: officer.commission,
        personnelFileNumber: officer.personnelFileNumber,
        nationalId: officer.nationalId,
      },
    }),
    `identify ${officer.personnelFileNumber}`,
  );
  const headers = { 'X-Onboarding-Secret': session.secret };
  const path = { sessionId: session.id };
  if (session.state !== 'email-pending') {
    throw new Error(`${officer.personnelFileNumber}: onboarding started in ${session.state}`);
  }
  const emailCode = await waitFor(`email code for ${officer.email}`, () =>
    context.inboxes.emailCode(officer.email, started),
  );
  // The phone code goes out as the email is verified: note the inbox before, so the new one shows.
  const before = await context.inboxes.smsCode(officer.phone);
  const afterEmail = ok(
    await api.POST('/v1/onboarding/sessions/{sessionId}/otp/{channel}/verify', {
      params: { header: headers, path: { ...path, channel: 'email' } },
      body: { code: emailCode },
    }),
    `verify ${officer.personnelFileNumber}'s email`,
  );
  if (afterEmail.state !== 'phone-pending') {
    throw new Error(
      `${officer.personnelFileNumber}: after email, onboarding is ${afterEmail.state}`,
    );
  }
  const sms = await waitFor(`SMS code for ${officer.phone}`, async () => {
    const latest = await context.inboxes.smsCode(officer.phone);
    return latest && latest.messageId !== before?.messageId ? latest : undefined;
  });
  ok(
    await api.POST('/v1/onboarding/sessions/{sessionId}/otp/{channel}/verify', {
      params: { header: headers, path: { ...path, channel: 'phone' } },
      body: { code: sms.code },
    }),
    `verify ${officer.personnelFileNumber}'s phone`,
  );
  const confirmed = ok(
    await api.POST('/v1/onboarding/sessions/{sessionId}/confirm', {
      params: { header: { ...headers, 'Idempotency-Key': randomUUID() }, path },
    }),
    `confirm ${officer.personnelFileNumber}`,
  );
  if (confirmed.outcome === 'identity-mismatch' || !confirmed.session.ofr) {
    throw new Error(`${officer.personnelFileNumber}: onboarding ended ${confirmed.outcome}`);
  }
  return confirmed.session.ofr;
}

/**
 * The personas, the timed officers and the synthetic officers onboarded (spec 03) and made demo
 * accounts. Officers onboarded already are only checked for their demo account.
 */
export const onboarding: SeedStep = {
  id: 'onboarding',
  title: 'Onboarding: personas, timed officers, synthetic volume',
  async run(context) {
    const people = await onboardees(context);
    const onboarded = new Map<string, Map<string, string>>();
    for (const commission of DEMO_COMMISSIONS) {
      const api = await context.as(commission.reportingOfficer.demoKey);
      onboarded.set(commission.slug, await onboardedRecords(api, commission.slug));
    }
    let changed = 0;
    let done = 0;
    await mapLimit(people, context.config.DEMO_SEED_CONCURRENCY, async (person) => {
      let ofr = onboarded.get(person.commission)?.get(person.personnelFileNumber.toUpperCase());
      if (!ofr) {
        ofr = await onboard(context, person);
        changed++;
      }
      const account = await waitFor(`account ${ofr}`, () => context.keycloak.userByUsername(ofr));
      if (await context.keycloak.ensureDemoAccount(account, person.demoKey)) changed++;
      done++;
      if (done % 250 === 0) context.log(`    ${String(done)} of ${String(people.length)} officers`);
    });
    return { changed, notes: [`${String(people.length)} officers onboarded`] };
  },
};
