import { randomUUID } from 'node:crypto';

import type { Apis } from '../clients/api.js';
import { ok } from '../clients/api.js';
import { waitFor } from '../clients/http.js';
import type { SeedContext } from '../context.js';
import {
  EXPIRED_PACKAGE_MARKER,
  FORM_K_SCOPE,
  type FormKPlan,
  LEA_REQUEST,
  PSC_FORM_K,
} from '../data/access.js';
import { CURRENT_CYCLE, PERSONAS } from '../data/personas.js';
import { fixtureRoster, type RosterRow } from '../data/roster.js';
import { syntheticOfficers } from '../data/synthetic.js';
import type { SeedStep } from '../step.js';
import { syntheticPlans } from './filings.js';
import { syntheticDemoKey } from './onboarding.js';

/** The JSC access officer the seed adds (the realm's `access-officer` is PSC's). */
export const JSC_ACCESS_OFFICER = 'jsc-access-officer';

const APPLICANT = 'applicant';
const PSC_ACCESS_OFFICER = 'access-officer';
const LAW_ENFORCEMENT = 'law-enforcement';

const DECIDED = new Set(['granted', 'partially-granted', 'denied']);

type OfficerView = Awaited<ReturnType<typeof officerView>>;

async function officerView(api: Apis, requestId: string) {
  return ok(
    await api.access.GET('/v1/access/requests/{requestId}/officer', {
      params: { path: { requestId } },
    }),
    `access request ${requestId} (officer)`,
  );
}

function formKOf(plan: FormKPlan, officer: RosterRow) {
  return {
    schemaVersion: 'form-k.v1',
    responsibleCommission: plan.commission,
    // Part I's name, identity document and contacts come from the applicant's directory record.
    partI: {
      name: 'Njoki Wambua',
      identityDocument: { kind: 'national-id', number: '00000000' },
      postalAddress: 'P.O. Box 46010-00100, Nairobi',
      physicalAddress: 'Upper Hill, Nairobi',
      telephone: '+254700000013',
      email: 'applicant@demo.adili.go.ke',
      occupation: plan.occupation,
    },
    partII: {
      name: officer.fullName,
      entity: officer.reportingEntity,
      workStation: officer.reportingEntity,
      personnelFileNumber: officer.personnelFileNumber,
    },
    partIII: {
      informationSought: plan.informationSought,
      reason: plan.reason,
      otherInformation: 'I am accredited with the Media Council of Kenya.',
    },
    partIV: {
      text: 'I declare that the information I have given above is true, complete and correct to the best of my knowledge.',
      declaredAt: new Date().toISOString(),
    },
    scope: FORM_K_SCOPE,
  };
}

/** The applicant's request with `marker` in its reason, filed if missing. */
async function ensureFormK(
  context: SeedContext,
  plan: FormKPlan,
  officer: RosterRow,
): Promise<{ id: string; created: boolean }> {
  const applicant = await context.as(APPLICANT);
  const mine = ok(await applicant.access.GET('/v1/access/requests'), 'my access requests');
  const found = mine.find(
    (r) =>
      r.status !== 'withdrawn' &&
      ((r.formK as { partIII?: { reason?: string } }).partIII?.reason ?? '').includes(plan.marker),
  );
  if (found) return { id: found.id, created: false };
  const created = ok(
    await applicant.access.POST('/v1/access/requests', {
      params: { header: { 'Idempotency-Key': randomUUID() } },
      body: formKOf(plan, officer),
    }),
    `file Form K (${plan.marker})`,
  );
  return { id: created.id, created: true };
}

interface RosterCandidates {
  items: { id: string; personnelFileNumber: string }[];
}

/** The officer's roster record, as the access officer finds it by personnel file number. */
function rosterRecordIn(candidates: RosterCandidates, officer: RosterRow): string {
  const record = candidates.items.find(
    (c) => c.personnelFileNumber === officer.personnelFileNumber,
  );
  if (!record) throw new Error(`${officer.fullName} is not found on the roster`);
  return record.id;
}

/**
 * Takes a Form K request to its plan's outcome, from wherever it stands: identified, the declarant
 * notified, their consent, the decision, the package. Returns the steps it took.
 */
async function advanceFormK(
  context: SeedContext,
  plan: FormKPlan,
  officer: RosterRow,
  requestId: string,
  accessOfficerKey: string,
): Promise<number> {
  const accessOfficer = await context.as(accessOfficerKey);
  let changed = 0;
  let view: OfficerView = await officerView(accessOfficer, requestId);

  if (view.resolvedRosterRecordId === null && view.status !== 'cannot-identify') {
    const rosterRecordId = rosterRecordIn(
      ok(
        await accessOfficer.access.GET('/v1/access/requests/{requestId}/roster-candidates', {
          params: { path: { requestId }, query: { q: officer.personnelFileNumber } },
        }),
        `roster candidates for ${officer.fullName}`,
      ),
      officer,
    );
    ok(
      await accessOfficer.access.POST('/v1/access/requests/{requestId}/resolve', {
        params: { path: { requestId }, header: { 'Idempotency-Key': randomUUID() } },
        body: { rosterRecordId },
      }),
      `identify ${officer.fullName} (${plan.marker})`,
    );
    changed++;
  }

  // The workflow notifies the declarant online once the officer is identified.
  view = await waitFor(
    `${plan.marker}: declarant notified`,
    async () => {
      const current = await officerView(accessOfficer, requestId);
      return current.status === 'submitted' || current.status === 'officer-unresolved'
        ? undefined
        : current;
    },
    { timeoutMs: 120_000, intervalMs: 1000 },
  );
  if (plan.outcome === 'awaiting-representations') return changed;

  if (view.status === 'awaiting-representations' && plan.consent) {
    const declarant = await context.as(plan.declarantKey);
    ok(
      await declarant.access.PUT('/v1/me/access-notices/{requestId}/representations', {
        params: { path: { requestId }, header: { 'Idempotency-Key': randomUUID() } },
        body: { stance: 'consent', text: plan.consent, attachments: [] },
      }),
      `${plan.declarantKey} consents (${plan.marker})`,
    );
    changed++;
    view = await officerView(accessOfficer, requestId);
  }

  if (!DECIDED.has(view.status) && plan.decision) {
    ok(
      await accessOfficer.access.POST('/v1/access/requests/{requestId}/decision', {
        params: { path: { requestId }, header: { 'Idempotency-Key': randomUUID() } },
        body: {
          outcome: plan.outcome === 'granted' ? 'grant' : 'deny',
          ...(plan.decision.grounds.length > 0 ? { grounds: plan.decision.grounds } : {}),
          reasons: plan.decision.reasons,
        },
      }),
      `decide ${plan.marker}`,
    );
    changed++;
  }

  if (plan.outcome === 'granted') {
    await waitFor(
      `${plan.marker}: access package issued`,
      async () => {
        const current = await officerView(accessOfficer, requestId);
        if (current.packageFailedAt !== null) {
          throw new Error(`${plan.marker}: issuing the access package failed`);
        }
        return current.package ?? undefined;
      },
      { timeoutMs: 180_000, intervalMs: 2000 },
    );
  }
  return changed;
}

async function ensureLeaRequest(context: SeedContext, officer: RosterRow): Promise<number> {
  const agency = await context.as(LAW_ENFORCEMENT);
  const accessOfficer = await context.as(PSC_ACCESS_OFFICER);
  let changed = 0;
  const mine = ok(await agency.access.GET('/v1/lea/requests'), 'my law enforcement requests');
  let request = mine.find(
    (r) => r.caseReference === LEA_REQUEST.caseReference && r.status !== 'withdrawn',
  );
  if (!request) {
    request = ok(
      await agency.access.POST('/v1/lea/requests', {
        params: { header: { 'Idempotency-Key': randomUUID() } },
        body: {
          commission: LEA_REQUEST.commission,
          officerSought: {
            name: officer.fullName,
            entity: officer.reportingEntity,
            personnelFileNumber: officer.personnelFileNumber,
          },
          reason: LEA_REQUEST.reason,
          caseReference: LEA_REQUEST.caseReference,
          scope: LEA_REQUEST.scope,
        },
      }),
      'file the law enforcement request',
    );
    changed++;
  }
  const leaRequestId = request.id;
  if (request.status === 'received') {
    const rosterRecordId = rosterRecordIn(
      ok(
        await accessOfficer.access.GET('/v1/lea/requests/{leaRequestId}/roster-candidates', {
          params: { path: { leaRequestId }, query: { q: officer.personnelFileNumber } },
        }),
        `roster candidates for ${officer.fullName}`,
      ),
      officer,
    );
    ok(
      await accessOfficer.access.POST('/v1/lea/requests/{leaRequestId}/verify', {
        params: { path: { leaRequestId }, header: { 'Idempotency-Key': randomUUID() } },
        body: {
          provenanceConfirmed: true,
          reasonConfirmed: true,
          rosterRecordId,
          note: LEA_REQUEST.verifyNote,
        },
      }),
      'verify the law enforcement request',
    );
    changed++;
    request = { ...request, status: 'verified' };
  }
  if (request.status === 'verified') {
    ok(
      await accessOfficer.access.POST('/v1/lea/requests/{leaRequestId}/decision', {
        params: { path: { leaRequestId }, header: { 'Idempotency-Key': randomUUID() } },
        body: { outcome: 'grant', reasons: LEA_REQUEST.decision.reasons },
      }),
      'grant the law enforcement request',
    );
    changed++;
  }
  await waitFor(
    'law enforcement package issued',
    async () => {
      const current = ok(
        await agency.access.GET('/v1/lea/requests/{leaRequestId}', {
          params: { path: { leaRequestId } },
        }),
        'law enforcement request',
      );
      return current.package ? true : undefined;
    },
    { timeoutMs: 180_000, intervalMs: 2000 },
  );
  return changed;
}

/** Amina's certified copy of her amended declaration (version 2). */
async function ensureCertifiedCopy(context: SeedContext): Promise<number> {
  const amina = await context.as('amina');
  const copies = ok(await amina.access.GET('/v1/me/certified-copies'), 'my certified copies');
  const declarations = ok(await amina.declarations.GET('/v1/me/declarations'), 'my declarations');
  const amended = declarations.find((d) => d.status === 'submitted' && d.currentVersion === 2);
  if (!amended) throw new Error('Amina has no amended declaration (version 2)');
  let changed = 0;
  if (!copies.some((c) => c.declarationId === amended.id && c.version === 2)) {
    ok(
      await amina.access.POST('/v1/me/certified-copies', {
        params: { header: { 'Idempotency-Key': randomUUID() } },
        body: { commission: 'psc', declarationId: amended.id, version: 2 },
      }),
      'request a certified copy',
    );
    changed++;
  }
  await waitFor(
    'certified copy issued',
    async () => {
      const current = ok(await amina.access.GET('/v1/me/certified-copies'), 'my certified copies');
      const copy = current.find((c) => c.declarationId === amended.id && c.version === 2);
      if (copy?.status === 'failed') throw new Error('Issuing the certified copy failed');
      return copy?.status === 'issued' ? true : undefined;
    },
    { timeoutMs: 180_000, intervalMs: 2000 },
  );
  return changed;
}

/** A JSC officer who filed the current cycle: the subject of the grant whose package expires. */
async function jscDeclarant(context: SeedContext): Promise<RosterRow & { demoKey: string }> {
  const jsc = (await syntheticOfficers(context)).get('jsc') ?? [];
  const officer = jsc.find((o) =>
    syntheticPlans(o).some((p) => p.cycleKey === `biennial:${String(CURRENT_CYCLE)}`),
  );
  if (!officer) throw new Error('No JSC officer filed the current cycle');
  return { ...officer, demoKey: syntheticDemoKey(officer.nationalId) };
}

function personaRow(nationalId: string): RosterRow {
  const persona = PERSONAS.find((p) => p.nationalId === nationalId);
  const row = fixtureRoster(persona?.commission ?? 'psc').find((r) => r.nationalId === nationalId);
  if (!row) throw new Error(`No roster row for ${nationalId}`);
  return row;
}

/**
 * Access requests (#620, spec 10): Form K requests waiting for the declarant's representations,
 * granted with the watermarked, signed package, and denied on a Regulation 24 ground; a law
 * enforcement request granted; a certified copy; and a JSC grant whose package the verify app
 * shows as expired. The declarants' "Who accessed my declaration" lists these.
 */
export const access: SeedStep = {
  id: 'access',
  title: 'Access requests: Form K, law enforcement, certified copy',
  async run(context) {
    let changed = 0;
    const notes: string[] = [];

    for (const plan of PSC_FORM_K) {
      const officer = personaRow(plan.nationalId);
      const { id, created } = await ensureFormK(context, plan, officer);
      changed +=
        (created ? 1 : 0) + (await advanceFormK(context, plan, officer, id, PSC_ACCESS_OFFICER));
      notes.push(`${plan.declarantKey}: ${plan.outcome}`);
    }

    changed += await ensureLeaRequest(context, personaRow(LEA_REQUEST.nationalId));
    notes.push(`law enforcement ${LEA_REQUEST.caseReference}: granted`);

    changed += await ensureCertifiedCopy(context);
    notes.push('amina: certified copy of version 2');

    if (
      await context.keycloak.ensureStaffAccount({
        username: JSC_ACCESS_OFFICER,
        email: `${JSC_ACCESS_OFFICER}@demo.adili.go.ke`,
        firstName: 'Access Officer',
        lastName: 'JSC',
        role: 'access-officer',
        tenant: 'jsc',
        demoKey: JSC_ACCESS_OFFICER,
      })
    ) {
      changed++;
    }
    const declarant = await jscDeclarant(context);
    const expiring: FormKPlan = {
      marker: EXPIRED_PACKAGE_MARKER,
      commission: 'jsc',
      declarantKey: declarant.demoKey,
      nationalId: declarant.nationalId,
      occupation: 'Researcher',
      informationSought: `The officer's declared income for ${String(CURRENT_CYCLE)}.`,
      reason: `Research on ${EXPIRED_PACKAGE_MARKER} and how court staff declare their interests.`,
      outcome: 'granted',
      consent: 'I consent.',
      decision: {
        grounds: [],
        reasons: 'Research purpose stated and the declarant consented. Granted.',
      },
    };
    const { id, created } = await ensureFormK(context, expiring, declarant);
    changed +=
      (created ? 1 : 0) +
      (await advanceFormK(context, expiring, declarant, id, JSC_ACCESS_OFFICER));
    notes.push(`jsc ${declarant.fullName}: granted (package expires on the demo's short validity)`);

    return { changed, notes };
  },
};
