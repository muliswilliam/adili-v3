import { randomUUID } from 'node:crypto';

import { type Apis, ok } from '../clients/api.js';
import type { SeedContext } from '../context.js';
import { DEMO_COMMISSIONS, commissionIndex } from '../data/commissions.js';
import { CURRENT_CYCLE } from '../data/personas.js';
import {
  SUPERVISORS,
  VOLUME_REVIEW,
  VOLUME_REVIEW_COMMISSIONS,
  VOLUME_TEXT,
} from '../data/reporting.js';
import { behaviourOf, type SyntheticOfficer, syntheticOfficers } from '../data/synthetic.js';
import type { SeedStep } from '../step.js';
import { syntheticDemoKey } from './onboarding.js';

const key = () => ({ 'Idempotency-Key': randomUUID() });

type CaseItem = Awaited<ReturnType<typeof casesOf>>[number];
type CaseDetail = Awaited<ReturnType<typeof caseDetail>>;

/** Every case of the Commission's queue, determined ones included. */
async function casesOf(api: Apis, slug: string) {
  const items = [];
  for (const status of [undefined, 'determined'] as const) {
    let cursor: string | undefined;
    do {
      const page = ok(
        await api.review.GET('/v1/commissions/{slug}/review/queue', {
          params: {
            path: { slug },
            query: {
              cycle: CURRENT_CYCLE,
              limit: 100,
              ...(status && { status }),
              ...(cursor && { cursor }),
            },
          },
        }),
        `${slug} queue`,
      );
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return items;
}

async function caseDetail(api: Apis, caseId: string) {
  return ok(
    await api.review.GET('/v1/review/cases/{caseId}', { params: { path: { caseId } } }),
    `case ${caseId}`,
  );
}

function subjectOf(token: string): string {
  return (
    JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { sub: string }
  ).sub;
}

/**
 * The officers whose cases the step works: clean current-cycle filers (no holding left out),
 * by personnel file number, so a fresh stack picks the same people every run.
 */
function workedOfficers(officers: readonly SyntheticOfficer[]): SyntheticOfficer[] {
  return officers
    .filter((officer) => {
      const behaviour = behaviourOf(officer);
      return behaviour.filesCurrent && !behaviour.omitsHolding;
    })
    .sort((a, b) => a.personnelFileNumber.localeCompare(b.personnelFileNumber))
    .slice(0, VOLUME_REVIEW.determined + VOLUME_REVIEW.clarified);
}

/** Claims the case for the reviewer unless they hold it; whether it changed anything. */
async function claimed(context: SeedContext, reviewer: string, item: CaseItem): Promise<boolean> {
  if (item.assignee?.subject === subjectOf(await context.token(reviewer))) return false;
  if (item.assignee) throw new Error(`${item.reference} is held by ${item.assignee.name}`);
  const api = await context.as(reviewer);
  ok(
    await api.review.POST('/v1/review/cases/{caseId}/claim', {
      params: { path: { caseId: item.id }, header: key() },
    }),
    `${reviewer} claims ${item.reference}`,
  );
  return true;
}

/** Asks, has the officer answer, and resolves one clarification on the case. */
async function clarified(
  context: SeedContext,
  reviewer: string,
  officer: SyntheticOfficer,
  detail: CaseDetail,
): Promise<number> {
  const api = await context.as(reviewer);
  let changed = 0;
  let clarification = detail.clarifications.find((c) => c.status !== 'withdrawn');
  if (!clarification) {
    const draft = ok(
      await api.review.POST('/v1/review/cases/{caseId}/clarifications', {
        params: { path: { caseId: detail.case.id }, header: key() },
        body: {
          items: [
            {
              sectionKey: 'statement:officer',
              personKey: 'officer',
              itemId: null,
              requirement: 'explain-discrepancy',
              text: VOLUME_TEXT.item,
            },
          ],
        },
      }),
      `draft a clarification of ${detail.case.id}`,
    );
    clarification = ok(
      await api.review.POST('/v1/review/clarifications/{clarificationId}/issue', {
        params: { path: { clarificationId: draft.id }, header: key() },
      }),
      `issue clarification ${draft.id}`,
    );
    changed++;
  }
  if (clarification.status === 'issued') {
    const declarant = await context.as(syntheticDemoKey(officer.nationalId));
    ok(
      await declarant.review.POST('/v1/me/clarifications/{clarificationId}/response', {
        params: { path: { clarificationId: clarification.id }, header: key() },
        body: { items: [{ index: 0, text: VOLUME_TEXT.response, attachments: [] }] },
      }),
      `respond to ${clarification.id}`,
    );
    changed++;
    clarification = { ...clarification, status: 'responded' };
  }
  if (clarification.status === 'responded') {
    ok(
      await api.review.POST('/v1/review/clarifications/{clarificationId}/resolve', {
        params: { path: { clarificationId: clarification.id }, header: key() },
        body: { note: VOLUME_TEXT.note },
      }),
      `resolve ${clarification.id}`,
    );
    changed++;
  }
  return changed;
}

/** Proposes the case compliant as the reviewer and approves it as the supervisor. */
async function determined(
  context: SeedContext,
  reviewer: string,
  supervisor: string,
  detail: CaseDetail,
): Promise<number> {
  let changed = 0;
  let determination = detail.determinations.find(
    (d) => d.status === 'proposed' || d.status === 'approved',
  );
  if (!determination) {
    const api = await context.as(reviewer);
    determination = ok(
      await api.review.POST('/v1/review/cases/{caseId}/determinations', {
        params: { path: { caseId: detail.case.id }, header: key() },
        body: { outcome: 'compliant', reasons: VOLUME_TEXT.reasons },
      }),
      `propose the determination of ${detail.case.id}`,
    );
    changed++;
  }
  if (determination.status === 'proposed') {
    const api = await context.as(supervisor);
    ok(
      await api.review.POST('/v1/review/determinations/{determinationId}/approve', {
        params: { path: { determinationId: determination.id }, header: key() },
      }),
      `approve determination ${determination.id}`,
    );
    changed++;
  }
  return changed;
}

/** Approves every notice to comply the Commission's ladders propose (spec 08). */
async function noticesApproved(context: SeedContext, slug: string, supervisor: string) {
  const api = await context.as(supervisor);
  const ladders = [];
  let cursor: string | undefined;
  do {
    const page = ok(
      await api.review.GET('/v1/commissions/{slug}/actions', {
        params: { path: { slug }, query: { limit: 100, ...(cursor && { cursor }) } },
      }),
      `${slug} ladders`,
    );
    ladders.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  let approved = 0;
  for (const summary of ladders) {
    const ladder = ok(
      await api.review.GET('/v1/review/ladders/{ladderId}', {
        params: { path: { ladderId: summary.id } },
      }),
      `ladder ${summary.id}`,
    );
    const notice = ladder.steps.find(
      (step) => step.step === 'notice-to-comply' && step.status === 'proposed',
    );
    if (!notice) continue;
    ok(
      await api.review.POST('/v1/review/actions/{actionId}/approve', {
        params: { path: { actionId: notice.id }, header: key() },
      }),
      `approve notice ${notice.id}`,
    );
    approved++;
  }
  return approved;
}

/**
 * Review work in TSC, JSC and NPSC (spec 07a, 08): cases determined compliant, cases clarified
 * then determined, and the overdue officers' notices to comply issued, each by the Commission's
 * own reviewer and supervisor. Their Form M (compiled after) and the national figures then count
 * real determinations, clarifications and actions, not only PSC's.
 */
export const reviewVolume: SeedStep = {
  id: 'review-volume',
  title: 'Review work in TSC, JSC and NPSC: determinations, clarifications, notices',
  async run(context) {
    const officersBySlug = await syntheticOfficers(context);
    let changed = 0;
    const notes: string[] = [];
    for (const slug of VOLUME_REVIEW_COMMISSIONS) {
      const reviewer = DEMO_COMMISSIONS[commissionIndex(slug)]?.reviewer;
      const supervisor = SUPERVISORS[slug];
      if (!reviewer || !supervisor) throw new Error(`No review team for ${slug}`);
      const api = await context.as(reviewer);
      const cases = new Map(
        (await casesOf(api, slug))
          .filter((item) => item.type === 'biennial')
          .map((item) => [item.personnelFileNumber.toUpperCase(), item]),
      );
      const worked = workedOfficers(officersBySlug.get(slug) ?? []);
      for (const [index, officer] of worked.entries()) {
        const item = cases.get(officer.personnelFileNumber.toUpperCase());
        if (!item)
          throw new Error(`${slug}: no current-cycle case for ${officer.personnelFileNumber}`);
        if (await claimed(context, reviewer, item)) changed++;
        let detail = await caseDetail(api, item.id);
        if (index >= VOLUME_REVIEW.determined) {
          changed += await clarified(context, reviewer, officer, detail);
          detail = await caseDetail(api, item.id);
        }
        changed += await determined(context, reviewer, supervisor, detail);
      }
      const notices = await noticesApproved(context, slug, supervisor);
      changed += notices;
      notes.push(
        `${slug}: ${String(worked.length)} cases worked, ${String(notices)} notices approved now`,
      );
    }
    return { changed, notes };
  },
};
