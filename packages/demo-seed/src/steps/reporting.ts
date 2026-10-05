import { randomUUID } from 'node:crypto';

import { type Apis, ApiError, ok } from '../clients/api.js';
import { jsonBody, requestJson, waitFor } from '../clients/http.js';
import { triggerSchedule } from '../clients/temporal.js';
import type { components } from '../clients/reporting-api.gen.js';
import type { SeedContext } from '../context.js';
import {
  COMMISSION_ADMIN_DESIGNATION,
  FORM_M_FY,
  FORM_M_MANUAL,
  FORM_M_OFFICERS,
  FORM_M_PLANS,
  type FormMPlan,
  SUPERVISOR_DESIGNATION,
  WITHDRAW_REASON,
} from '../data/reporting.js';
import { type SeedStep, unchanged } from '../step.js';

type Report = components['schemas']['ComplianceReport'];
type Release = components['schemas']['OpenDataRelease'];
type NationalReport = components['schemas']['NationalReport'];

/** EACC's yearly chase of the Commissions that have not reported (reporting's schedule). */
const CHASE_SCHEDULE = 'national-consolidation-chase:reporting';
const EACC_ANALYST = 'eacc-analyst';
const EACC_SUPERVISOR = 'eacc-supervisor';

const key = () => ({ 'Idempotency-Key': randomUUID() });

/** Nairobi's date today, as Part III dates its sign-off. */
function nairobiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}

/** The Commission's report for the year; `not-started` (no report yet) reads as 404. */
async function report(api: Apis, slug: string): Promise<Report | { status: 'not-started' }> {
  const result = await api.reporting.GET('/v1/commissions/{slug}/compliance-reports/{fy}', {
    params: { path: { slug, fy: FORM_M_FY } },
  });
  if (result.response.status === 404) return { status: 'not-started' };
  return ok(result, `read ${slug}'s Form M`);
}

async function draftOf(api: Apis, slug: string): Promise<Report> {
  const current = await report(api, slug);
  if (!('id' in current)) throw new Error(`${slug} has no Form M for ${String(FORM_M_FY)}`);
  return current;
}

async function intake(context: SeedContext) {
  const api = await context.as(EACC_ANALYST);
  return ok(
    await api.reporting.GET('/v1/eacc/compliance-reports', {
      params: { query: { fy: FORM_M_FY } },
    }),
    'read the intake',
  );
}

/**
 * The Form M officers of TSC, JSC and NPSC (supervisors and commission-admins) the realm file
 * does not hold: demo accounts made through Keycloak admin, since no API creates Commission staff.
 */
export const formMOfficers: SeedStep = {
  id: 'form-m-officers',
  title: 'Form M officers for TSC, JSC and NPSC',
  async run(context) {
    let changed = 0;
    for (const officer of FORM_M_OFFICERS) {
      const made = await context.keycloak.ensureStaffAccount({
        username: officer.demoKey,
        email: `${officer.demoKey}@demo.adili.go.ke`,
        firstName: officer.firstName,
        lastName: officer.lastName,
        role: officer.role,
        tenant: officer.tenant,
        demoKey: officer.demoKey,
      });
      if (made) changed++;
    }
    return { changed, notes: [FORM_M_OFFICERS.map((officer) => officer.demoKey).join(', ')] };
  },
};

/**
 * EACC's chase (spec 09): its schedule runs on 1 August, past for this year, so the seed runs it
 * once now, while no Commission has reported: every one is chased by email and the chase is in
 * the intake. A Commission that files afterwards files late; NPSC never does.
 */
export const formMChase: SeedStep = {
  id: 'form-m-chase',
  title: "EACC's chase of the Commissions that have not reported",
  async run(context) {
    const before = await intake(context);
    if (before.commissions.some((item) => item.chases.count > 0)) {
      return unchanged(`${String(before.commissions.length)} Commissions, chased already`);
    }
    await triggerSchedule(context.config, CHASE_SCHEDULE);
    const after = await waitFor(
      'the chase of every Commission not reported',
      async () => {
        const now = await intake(context);
        const missing = now.commissions.filter(
          (item) => item.status === 'not-reported' && item.chases.count === 0,
        );
        return missing.length === 0 ? now : undefined;
      },
      { timeoutMs: 120_000, intervalMs: 2000 },
    );
    const chased = after.commissions.filter((item) => item.chases.count > 0).length;
    return { changed: chased, notes: [`${String(chased)} Commissions chased`] };
  },
};

/** Compiles the year's report as the supervisor if it has none yet, and waits for the draft. */
async function compiled(context: SeedContext, slug: string, supervisor: string): Promise<boolean> {
  const api = await context.as(supervisor);
  let changed = false;
  if ((await report(api, slug)).status === 'not-started') {
    ok(
      await api.reporting.POST('/v1/commissions/{slug}/compliance-reports/{fy}/compile', {
        params: { path: { slug, fy: FORM_M_FY } },
      }),
      `compile ${slug}'s Form M`,
    );
    changed = true;
  }
  await waitFor(
    `${slug}'s Form M compiled`,
    async () => {
      const now = await report(api, slug);
      return now.status === 'compiling' ? undefined : now;
    },
    { timeoutMs: 180_000, intervalMs: 2000 },
  );
  return changed;
}

/** Part I contact details and Part B (no complaints) as the commission-admin, if not entered. */
async function partIEntered(context: SeedContext, slug: string, commissionAdmin: string) {
  const api = await context.as(commissionAdmin);
  const current = await draftOf(api, slug);
  const manual = FORM_M_MANUAL[slug];
  if (!manual) throw new Error(`No Part I details for ${slug}`);
  const partI = current.document?.partI as { emailAddress?: string | null } | undefined;
  if (partI?.emailAddress === manual.emailAddress) return false;
  ok(
    await api.reporting.PATCH('/v1/commissions/{slug}/compliance-reports/{fy}/manual', {
      params: { path: { slug, fy: FORM_M_FY } },
      body: { ...manual, complaintsRegisterMaintained: true, complaints: [] },
    }),
    `enter ${slug}'s Part I`,
  );
  return true;
}

async function reviewed(context: SeedContext, slug: string, supervisor: string): Promise<boolean> {
  const api = await context.as(supervisor);
  if ((await report(api, slug)).status !== 'draft') return false;
  ok(
    await api.reporting.POST('/v1/commissions/{slug}/compliance-reports/{fy}/reviewed', {
      params: { path: { slug, fy: FORM_M_FY } },
      body: { designation: SUPERVISOR_DESIGNATION },
    }),
    `mark ${slug}'s Form M reviewed`,
  );
  return true;
}

/** Confirms and submits as the commission-admin, with the fresh step-up confirming asks for. */
async function confirmed(context: SeedContext, slug: string, commissionAdmin: string) {
  const api = await context.as(commissionAdmin, { fresh: true });
  if ((await report(api, slug)).status !== 'reviewed') return false;
  ok(
    await api.reporting.POST('/v1/commissions/{slug}/compliance-reports/{fy}/confirm', {
      params: { path: { slug, fy: FORM_M_FY }, header: key() },
      body: { designation: COMMISSION_ADMIN_DESIGNATION },
    }),
    `confirm ${slug}'s Form M`,
  );
  return true;
}

/** A client-credentials token for a federated Commission's own system (`<slug>-reports`). */
async function federatedToken(context: SeedContext, slug: string): Promise<string> {
  const { config } = context;
  const { body } = await requestJson<{ access_token: string }>(
    `${config.KEYCLOAK_URL}/realms/${config.KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: `${slug}-reports`,
        client_secret: config.FEDERATED_REPORTS_CLIENT_SECRET,
      }),
      what: `${slug}'s reports client token`,
    },
  );
  return body.access_token;
}

/**
 * Files TSC's report from its own system (spec 09 federated, ADR-009): the figures a compile on
 * the platform gives, signed off in that system, submitted with its client-credentials token.
 */
async function federated(
  context: SeedContext,
  plan: Extract<FormMPlan, { state: 'federated' }>,
): Promise<boolean> {
  const api = await context.as(plan.supervisor);
  const draft = await draftOf(api, plan.slug);
  if (draft.status === 'submitted') return false;
  if (!draft.document) throw new Error(`${plan.slug}'s compiled draft has no document`);
  const manual = FORM_M_MANUAL[plan.slug];
  if (!manual) throw new Error(`No Part I details for ${plan.slug}`);
  const today = nairobiToday();
  const document = {
    ...draft.document,
    partI: { ...draft.document.partI, ...manual },
    partIII: {
      compiledBy: { ...plan.compiledBy, date: today },
      confirmedBy: { ...plan.confirmedBy, date: today },
    },
  };
  await requestJson(`${context.config.REPORTING_URL}/v1/compliance-reports`, {
    method: 'POST',
    ...jsonBody(document),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await federatedToken(context, plan.slug)}`,
      'idempotency-key': randomUUID(),
    },
    what: `file ${plan.slug}'s Form M through the federated API`,
  });
  return true;
}

/**
 * Every Commission's Form M for the year: PSC's draft compiled, Part I entered and reviewed, for
 * the commission-admin to confirm live; JSC and NPSC confirmed; TSC filed from its own system;
 * EACC left unreported.
 */
export const formM: SeedStep = {
  id: 'form-m',
  title: "Form M: PSC's draft ready to confirm, JSC and NPSC confirmed, TSC federated",
  async run(context) {
    let changed = 0;
    const notes: string[] = [];
    const count = (did: boolean) => {
      if (did) changed++;
    };
    for (const plan of FORM_M_PLANS) {
      if (plan.state === 'not-reported') {
        notes.push(`${plan.slug}: not reported`);
        continue;
      }
      const current = await report(await context.as(plan.supervisor), plan.slug);
      if ('id' in current && current.status === 'submitted') {
        notes.push(`${plan.slug}: ${current.reference ?? 'submitted'}`);
        continue;
      }
      count(await compiled(context, plan.slug, plan.supervisor));
      if (plan.state === 'federated') {
        count(await federated(context, plan));
      } else {
        count(await partIEntered(context, plan.slug, plan.commissionAdmin));
        count(await reviewed(context, plan.slug, plan.supervisor));
        if (plan.state === 'confirmed')
          count(await confirmed(context, plan.slug, plan.commissionAdmin));
      }
      const after = await draftOf(await context.as(plan.supervisor), plan.slug);
      notes.push(`${plan.slug}: ${after.reference ?? after.status}`);
    }
    return { changed, notes };
  },
};

/** The gate rule letting EACC's national figures of the demo's synthetic data be narrated. */
const EACC_NARRATIVE_RULE = {
  dataClass: 'restricted',
  providerClass: 'external',
  allowed: true,
  tasks: ['narrate-compliance-report'],
} as const;

/**
 * EACC's AI gate (spec 07c, ADR-007): the narrative draft sends the year's national figures as
 * `restricted`, which the gate blocks for an external provider by default. The demo's figures
 * come from synthetic declarations only, so the platform admin allows that one task for EACC,
 * through the gate's own API (audited, with the approval reference), as `db:seed` does for PSC's
 * copilot.
 */
export const eaccAiPolicy: SeedStep = {
  id: 'eacc-ai-policy',
  title: "EACC's AI gate: the national report's narrative on synthetic figures",
  async run(context) {
    const admin = await context.as('platform-admin');
    const policies = ok(await admin.aiGateway.GET('/v1/ai/policies'), 'read the AI gate');
    const rules = policies.tenants.find((tenant) => tenant.tenant === 'eacc')?.rules ?? [];
    const allowed = rules.some(
      (rule) =>
        rule.dataClass === EACC_NARRATIVE_RULE.dataClass &&
        rule.providerClass === EACC_NARRATIVE_RULE.providerClass &&
        rule.allowed &&
        (rule.tasks === null || rule.tasks.includes('narrate-compliance-report')),
    );
    if (allowed) return unchanged('eacc: narrate-compliance-report allowed');
    ok(
      await admin.aiGateway.PUT('/v1/ai/policies/{tenant}', {
        params: { path: { tenant: 'eacc' } },
        body: {
          rules: [{ ...EACC_NARRATIVE_RULE, tasks: [...EACC_NARRATIVE_RULE.tasks] }],
          approvalRef: 'Demo set-up: national figures of synthetic declarations only (spec 09b)',
        },
      }),
      "allow EACC's narrative",
    );
    return { changed: 1, notes: ['eacc: narrate-compliance-report allowed'] };
  },
};

async function nationalReport(api: Apis): Promise<NationalReport | undefined> {
  const result = await api.reporting.GET('/v1/eacc/national-reports/{fy}', {
    params: { path: { fy: FORM_M_FY } },
  });
  if (result.response.status === 404) return undefined;
  return ok(result, 'read the national report');
}

/**
 * The national consolidated report (spec 09b): built by the analyst from the reports filed, its
 * overview, findings (from the pattern candidates) and recommendations drafted by the AI, and
 * approved by the EACC supervisor, which ends the year's chase and publishes the annual open-data
 * release.
 */
export const nationalConsolidatedReport: SeedStep = {
  id: 'ncr',
  title: 'National consolidated report: built, AI-drafted narrative, approved',
  async run(context) {
    const analyst = await context.as(EACC_ANALYST);
    let ncr = await nationalReport(analyst);
    if (ncr?.status === 'approved') {
      return unchanged(`${ncr.reference ?? 'approved'}, ${String(ncr.reportsIncluded)} reports`);
    }
    let changed = 0;
    if (!ncr) {
      ncr = ok(
        await analyst.reporting.POST('/v1/eacc/national-reports/{fy}/build', {
          params: { path: { fy: FORM_M_FY } },
        }),
        'build the national report',
      );
      changed++;
    }
    const candidates = ok(
      await analyst.reporting.GET('/v1/eacc/national-reports/{fy}/candidates', {
        params: { path: { fy: FORM_M_FY } },
      }),
      'read the pattern candidates',
    );
    if (ncr.narrativeParagraphs.length === 0) {
      ok(
        await analyst.reporting.POST('/v1/eacc/national-reports/{fy}/narrative/draft', {
          params: { path: { fy: FORM_M_FY }, header: key() },
          body: { section: 'all', replaceAll: false },
        }),
        'draft the narrative',
      );
      changed++;
      await waitFor(
        'the AI-drafted narrative',
        async () => {
          const now = await nationalReport(analyst);
          if (now?.narrativeDraft?.status === 'failed') {
            throw new Error('The narrative draft failed: is the AI provider up?');
          }
          return now &&
            now.narrativeParagraphs.length > 0 &&
            now.narrativeDraft?.status !== 'drafting'
            ? now
            : undefined;
        },
        { timeoutMs: 300_000, intervalMs: 3000 },
      );
    }
    const supervisor = await context.as(EACC_SUPERVISOR);
    const approved = ok(
      await supervisor.reporting.POST('/v1/eacc/national-reports/{fy}/approve', {
        params: { path: { fy: FORM_M_FY }, header: key() },
      }),
      'approve the national report',
    );
    changed++;
    return {
      changed,
      notes: [
        `${approved.reference ?? 'approved'}, ${String(approved.reportsIncluded)} reports`,
        `${String(approved.narrativeParagraphs.length)} narrative paragraphs, ${String(candidates.length)} pattern candidates`,
      ],
    };
  },
};

async function releases(api: Apis): Promise<Release[]> {
  const all = ok(await api.reporting.GET('/v1/eacc/open-data/releases'), 'list releases');
  return all.filter((release) => release.fy === FORM_M_FY && release.kind === 'annual');
}

/**
 * The year's open data (spec 09b): the annual release published on approval is withdrawn with a
 * public reason, and version 2, built again from the approved report, is published. The public
 * page shows version 2 and the withdrawn one with its reason.
 */
export const openDataReleases: SeedStep = {
  id: 'open-data',
  title: 'Open data: annual release withdrawn, version 2 published',
  async run(context) {
    const analyst = await context.as(EACC_ANALYST);
    const supervisor = await context.as(EACC_SUPERVISOR);
    let changed = 0;
    // Approval publishes version 1 right after, through the release workflow.
    const first = await waitFor(
      'the annual release published on approval',
      async () =>
        (await releases(analyst)).find(
          (release) => release.version === 1 && release.status !== 'preview',
        ),
      { timeoutMs: 120_000, intervalMs: 2000 },
    );
    if (first.status === 'published') {
      ok(
        await supervisor.reporting.POST('/v1/eacc/open-data/releases/{releaseId}/withdraw', {
          params: { path: { releaseId: first.id }, header: key() },
          body: { reason: WITHDRAW_REASON },
        }),
        'withdraw version 1',
      );
      changed++;
    }
    let second = (await releases(analyst)).find((release) => release.version === 2);
    if (!second) {
      second = ok(
        await analyst.reporting.POST('/v1/eacc/open-data/releases', {
          params: { header: key() },
          body: { fy: FORM_M_FY, kind: 'annual' },
        }),
        'build version 2',
      );
      changed++;
    }
    if (second.status === 'preview') {
      ok(
        await supervisor.reporting.POST('/v1/eacc/open-data/releases/{releaseId}/publish', {
          params: { path: { releaseId: second.id }, header: key() },
        }),
        'publish version 2',
      );
      changed++;
    }
    return { changed, notes: ['annual v1 withdrawn, v2 published'] };
  },
};

/** Every referral EACC received pushed to ICMS with its case number (spec 09; #618 makes one). */
export const icmsReferrals: SeedStep = {
  id: 'icms-referrals',
  title: 'Referrals pushed to ICMS',
  async run(context) {
    const analyst = await context.as(EACC_ANALYST);
    const { items } = ok(await analyst.reporting.GET('/v1/eacc/referrals'), 'list referrals');
    let changed = 0;
    for (const item of items.filter(
      (referral) => referral.icmsStatus === 'not-pushed' || referral.icmsStatus === 'push-failed',
    )) {
      try {
        ok(
          await analyst.reporting.POST('/v1/eacc/referrals/{referralId}/push', {
            params: { path: { referralId: item.referralId }, header: key() },
          }),
          `push ${item.reference}`,
        );
        changed++;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
      }
    }
    const registered = await waitFor(
      'ICMS case numbers',
      async () => {
        const now = ok(await analyst.reporting.GET('/v1/eacc/referrals'), 'list referrals');
        return now.items.every((referral) => referral.icmsCaseNumber) ? now.items : undefined;
      },
      { timeoutMs: 180_000, intervalMs: 3000 },
    );
    return {
      changed,
      notes: registered.map(
        (referral) => `${referral.reference}: ${referral.icmsCaseNumber ?? ''}`,
      ),
    };
  },
};
