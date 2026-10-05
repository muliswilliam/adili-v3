import { randomUUID } from 'node:crypto';

import { type Apis, ok } from '../clients/api.js';
import { jsonBody, requestJson, waitFor } from '../clients/http.js';
import { triggerSchedule } from '../clients/temporal.js';
import type { SeedContext } from '../context.js';
import { CURRENT_CYCLE, PERSONAS, PREVIOUS_CYCLE } from '../data/personas.js';
import {
  EXTRA_PSC_REVIEWERS,
  PSC_REVIEWERS,
  PSC_SUPERVISOR,
  TEXT,
  TIMED_CASES,
  WORKED_PER_BAND,
} from '../data/review.js';
import {
  behaviourOf,
  cycleStatementDate,
  holdingsOf,
  type SyntheticOfficer,
  syntheticOfficers,
} from '../data/synthetic.js';
import { fixtureRoster } from '../data/roster.js';
import { declarantState, fileObligation } from '../filing.js';
import { type SeedStep, unchanged } from '../step.js';
import { syntheticDemoKey } from './onboarding.js';

const PSC = 'psc';
const key = () => ({ 'Idempotency-Key': randomUUID() });

type CaseItem = Awaited<ReturnType<typeof queue>>[number];

/** Every case of PSC's queue matching `query`, oldest pages first. */
async function queue(
  api: Apis,
  query: { status?: 'unassigned'; cycle?: number; band?: 'low' | 'medium' | 'high' } = {},
) {
  const items = [];
  let cursor: string | undefined;
  do {
    const page = ok(
      await api.review.GET('/v1/commissions/{slug}/review/queue', {
        params: { path: { slug: PSC }, query: { ...query, limit: 100, ...(cursor && { cursor }) } },
      }),
      'PSC queue',
    );
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** The subject (`sub`) of a demo account, as cases name their assignee. */
async function subjectOf(context: SeedContext, demoKey: string): Promise<string> {
  const token = await context.token(demoKey);
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as {
    sub: string;
  };
  return payload.sub;
}

/** Claims a case for `reviewer` unless they hold it already; whether it changed anything. */
async function claim(context: SeedContext, reviewer: string, item: CaseItem): Promise<boolean> {
  if (item.assignee?.subject === (await subjectOf(context, reviewer))) return false;
  if (item.assignee) {
    throw new Error(`${item.reference} is held by ${item.assignee.name}, not ${reviewer}`);
  }
  const api = await context.as(reviewer);
  ok(
    await api.review.POST('/v1/review/cases/{caseId}/claim', {
      params: { path: { caseId: item.id }, header: key() },
    }),
    `${reviewer} claims ${item.reference}`,
  );
  return true;
}

async function caseDetail(api: Apis, caseId: string) {
  return ok(
    await api.review.GET('/v1/review/cases/{caseId}', { params: { path: { caseId } } }),
    `case ${caseId}`,
  );
}

/** Switches review's demo windows (DEMO_MODE only, #371): ISO-8601 durations, or null for legal. */
async function reviewWindows(
  context: SeedContext,
  windows: Record<string, string | null>,
): Promise<void> {
  await requestJson(`${context.config.REVIEW_URL}/v1/demo/windows`, {
    method: 'PUT',
    ...jsonBody({ windows }),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await context.token('platform-admin')}`,
    },
    what: 'switch review demo windows (review needs DEMO_MODE=true)',
  });
}

const LEGAL = {
  DEMO_CLARIFICATION_REPLY_WINDOW: null,
  DEMO_LADDER_NOTICE_WINDOW: null,
  DEMO_LADDER_WARNING_WINDOW: null,
  DEMO_LADDER_STOPPAGE_WINDOW: null,
  DEMO_CASE_ISSUE_WINDOW: null,
};

/** Runs `work` with some of review's windows short, then every window legal again. */
async function withShortWindows<T>(
  context: SeedContext,
  windows: Partial<Record<keyof typeof LEGAL, string>>,
  work: () => Promise<T>,
): Promise<T> {
  await reviewWindows(context, { ...LEGAL, ...windows });
  try {
    return await work();
  } finally {
    await reviewWindows(context, LEGAL);
  }
}

/** The PSC personas' current-cycle cases, by `demo_key`. */
function personaCases(items: readonly CaseItem[]): Map<string, CaseItem> {
  const roster = fixtureRoster(PSC);
  const found = new Map<string, CaseItem>();
  for (const persona of PERSONAS.filter((p) => p.commission === PSC)) {
    const file = roster.find((r) => r.nationalId === persona.nationalId)?.personnelFileNumber;
    const item = items.find(
      (i) =>
        i.cycleYear === CURRENT_CYCLE &&
        i.personnelFileNumber.toUpperCase() === file?.toUpperCase(),
    );
    if (item) found.set(persona.demoKey, item);
  }
  return found;
}

/** PSC's synthetic officers, by personnel file number. */
async function pscOfficers(context: SeedContext): Promise<Map<string, SyntheticOfficer>> {
  const officers = (await syntheticOfficers(context)).get(PSC) ?? [];
  return new Map(officers.map((o) => [o.personnelFileNumber.toUpperCase(), o]));
}

/**
 * The current-cycle cases of synthetic officers in a band, sorted by personnel file number: the
 * pool the worked set and the timed states are picked from, the same on every fresh stack.
 */
async function volumeCases(
  context: SeedContext,
  items: readonly CaseItem[],
  band: 'low' | 'medium' | 'high',
): Promise<CaseItem[]> {
  const officers = await pscOfficers(context);
  // The bulk-closure cohort files later in the run: never part of the pool, so it stays the same.
  const cohort = new Set(
    closureCohort([...officers.values()]).map((o) => o.personnelFileNumber.toUpperCase()),
  );
  return items
    .filter((i) => !cohort.has(i.personnelFileNumber.toUpperCase()))
    .filter(
      (i) =>
        i.cycleYear === CURRENT_CYCLE &&
        i.type === 'biennial' &&
        i.band === band &&
        officers.has(i.personnelFileNumber.toUpperCase()),
    )
    .sort((a, b) => a.personnelFileNumber.localeCompare(b.personnelFileNumber));
}

/** The timed states' cases: excluded from the plain worked set. */
async function timedCases(context: SeedContext, items: readonly CaseItem[]) {
  const medium = await volumeCases(context, items, 'medium');
  const pick = (index: number) => {
    const item = medium[index];
    if (!item) throw new Error(`PSC has fewer than ${String(index + 1)} medium-band volume cases`);
    return item;
  };
  return {
    resolved: pick(TIMED_CASES.resolved),
    escalated: pick(TIMED_CASES.escalated),
    stoppage: pick(TIMED_CASES.stoppage),
  };
}

/** The `demo_key` of the synthetic officer a case is about. */
async function declarantOf(context: SeedContext, item: CaseItem): Promise<string> {
  const officer = (await pscOfficers(context)).get(item.personnelFileNumber.toUpperCase());
  if (!officer) throw new Error(`${item.reference} is not a synthetic officer's case`);
  return syntheticDemoKey(officer.nationalId);
}

/**
 * PSC's extra reviewers (no API creates Commission staff), so the queue's work is spread across
 * a team rather than one person.
 */
export const reviewTeam: SeedStep = {
  id: 'review-team',
  title: 'PSC review team: two more reviewers',
  async run(context) {
    let changed = 0;
    for (const reviewer of EXTRA_PSC_REVIEWERS) {
      const created = await context.keycloak.ensureStaffAccount({
        username: reviewer.demoKey,
        email: `${reviewer.demoKey}@demo.adili.go.ke`,
        firstName: reviewer.firstName,
        lastName: reviewer.lastName,
        role: 'reviewer',
        tenant: PSC,
        demoKey: reviewer.demoKey,
      });
      if (created) changed++;
    }
    return { changed, notes: [PSC_REVIEWERS.join(', ')] };
  },
};

/**
 * The worked part of PSC's queue (spec 07a): cases across the bands claimed by the three
 * reviewers, the personas' cases with the reviewers who handle them in the demo, and the rest of
 * the queue unassigned. Copilot summaries the seeding burst left failed are asked again for the
 * cases the demo opens.
 */
export const reviewQueue: SeedStep = {
  id: 'review-queue',
  title: 'PSC queue: worked cases across bands and reviewers',
  async run(context) {
    const api = await context.as(PSC_REVIEWERS[0] ?? 'reviewer');
    const items = await queue(api);
    const timed = await timedCases(context, items);
    const timedIds = new Set(Object.values(timed).map((i) => i.id));
    const personas = personaCases(items);
    let changed = 0;
    let worked = 0;
    for (const band of ['high', 'medium', 'low'] as const) {
      const pool = (await volumeCases(context, items, band)).filter((i) => !timedIds.has(i.id));
      for (const [index, item] of pool.slice(0, WORKED_PER_BAND[band]).entries()) {
        const reviewer = PSC_REVIEWERS[(worked + index) % PSC_REVIEWERS.length] ?? 'reviewer';
        if (await claim(context, reviewer, item)) changed++;
      }
      worked += WORKED_PER_BAND[band];
    }
    // Amina's amended declaration (version compare) with the second reviewer.
    const amina = personas.get('amina');
    if (amina && (await claim(context, PSC_REVIEWERS[1] ?? 'reviewer', amina))) changed++;
    // The copilot summaries of the cases the demo opens.
    const shown = [...personas.values(), ...Object.values(timed)];
    changed += await askCopilotAgain(context, shown);
    return {
      changed,
      notes: [`${String(worked)} worked volume cases, ${String(items.length)} in the queue`],
    };
  },
};

/**
 * Asks the copilot again for cases whose summary failed (the seeding burst trips the AI
 * gateway's breaker), one at a time with a pause, and waits for each. Cases of a Commission
 * whose AI gate keeps the copilot off are left alone.
 */
async function askCopilotAgain(context: SeedContext, items: readonly CaseItem[]): Promise<number> {
  // A supervisor may refresh any case's copilot; a reviewer only the cases they hold.
  const api = await context.as(PSC_SUPERVISOR);
  let asked = 0;
  for (const item of items) {
    const view = ok(
      await api.review.GET('/v1/review/cases/{caseId}/copilot', {
        params: { path: { caseId: item.id } },
      }),
      `${item.reference} copilot`,
    );
    if (view.status !== 'failed' && view.status !== 'stale') continue;
    for (let attempt = 1; attempt <= 4; attempt++) {
      ok(
        await api.review.POST('/v1/review/cases/{caseId}/copilot/refresh', {
          params: { path: { caseId: item.id } },
        }),
        `${item.reference} copilot refresh`,
      );
      const status = await waitFor(
        `${item.reference} copilot`,
        async () => {
          const now = ok(
            await (
              await context.as(PSC_SUPERVISOR)
            ).review.GET('/v1/review/cases/{caseId}/copilot', {
              params: { path: { caseId: item.id } },
            }),
            `${item.reference} copilot`,
          );
          return now.status === 'pending' ? undefined : now.status;
        },
        { timeoutMs: 5 * 60_000, intervalMs: 3000 },
      );
      if (status === 'ready') break;
      context.log(`    ${item.reference}: copilot ${status}, attempt ${String(attempt)}`);
      await new Promise((resolve) => setTimeout(resolve, 15_000 * attempt));
    }
    asked++;
  }
  return asked;
}

/** A draft clarification of the case with these items, then issued; the issued clarification. */
async function issueClarification(api: Apis, caseId: string, input: ClarificationInput) {
  const draft = ok(
    await api.review.POST('/v1/review/cases/{caseId}/clarifications', {
      params: { path: { caseId }, header: key() },
      body: input,
    }),
    `draft clarification of ${caseId}`,
  );
  return ok(
    await api.review.POST('/v1/review/clarifications/{clarificationId}/issue', {
      params: { path: { clarificationId: draft.id }, header: key() },
    }),
    `issue clarification ${draft.id}`,
  );
}

interface ClarificationInput {
  items: {
    sectionKey?: string | null;
    personKey?: string | null;
    itemId?: string | null;
    requirement: 'provide-omitted' | 'explain-discrepancy' | 'correct';
    text: string;
    aiJobId?: string | null;
  }[];
  opening?: string | null;
  openingAiJobId?: string | null;
  language?: 'en' | 'sw';
}

/**
 * Kiprono's tax flag: the reviewer asks the copilot to draft the clarification (spec 07c), edits
 * the first item and issues it with the legal reply window; it waits for his reply.
 */
async function kipronoClarification(context: SeedContext, item: CaseItem): Promise<number> {
  const reviewer = PSC_REVIEWERS[0] ?? 'reviewer';
  let changed = (await claim(context, reviewer, item)) ? 1 : 0;
  const api = await context.as(reviewer);
  const detail = await caseDetail(api, item.id);
  if (detail.clarifications.some((c) => c.status !== 'withdrawn')) return changed;
  const kra = detail.flags.find((flag) => flag.ruleId === 'kra-non-compliant');
  if (!kra) throw new Error(`${item.reference} has no kra-non-compliant flag`);
  let drafted;
  for (let attempt = 1; ; attempt++) {
    const started = ok(
      await api.review.POST('/v1/review/cases/{caseId}/copilot/drafts', {
        params: { path: { caseId: item.id }, header: key() },
        body: { flagIds: [kra.id], itemRefs: [], language: 'en' },
      }),
      `draft Kiprono's clarification with AI`,
    );
    drafted = await waitFor(
      'the AI-drafted clarification',
      async () => {
        const now = ok(
          await (
            await context.as(reviewer)
          ).review.GET('/v1/review/copilot/drafts/{draftId}', {
            params: { path: { draftId: started.id } },
          }),
          'AI draft',
        );
        return now.status === 'pending' ? undefined : now;
      },
      { timeoutMs: 5 * 60_000, intervalMs: 2000 },
    );
    if (drafted.status === 'ready') break;
    if (attempt >= 4) {
      throw new Error(
        `The AI draft of Kiprono's clarification failed: ${String(drafted.failureReason)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000 * attempt));
  }
  const [first, ...rest] = drafted.items;
  if (!first) throw new Error('The AI draft has no items');
  await issueClarification(api, item.id, {
    items: [{ ...first, text: `${first.text}${TEXT.kipronoEdit}` }, ...rest],
    opening: drafted.opening,
    openingAiJobId: drafted.opening ? drafted.jobId : null,
    language: 'en',
  });
  changed++;
  return changed;
}

/**
 * A clarification answered by the declarant and resolved by the reviewer; the case is then ready
 * for determination, the reviewer proposes `compliant` and the supervisor approves it.
 */
async function resolvedClarification(context: SeedContext, item: CaseItem): Promise<number> {
  const reviewer = PSC_REVIEWERS[1] ?? 'reviewer';
  let changed = (await claim(context, reviewer, item)) ? 1 : 0;
  const api = await context.as(reviewer);
  let detail = await caseDetail(api, item.id);
  let clarification = detail.clarifications.find((c) => c.status !== 'withdrawn');
  if (!clarification) {
    clarification = await issueClarification(api, item.id, {
      items: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: null,
          requirement: 'explain-discrepancy',
          text: TEXT.resolvedItem,
        },
      ],
    });
    changed++;
  }
  if (clarification.status === 'issued') {
    const declarant = await context.as(await declarantOf(context, item));
    ok(
      await declarant.review.POST('/v1/me/clarifications/{clarificationId}/response', {
        params: { path: { clarificationId: clarification.id }, header: key() },
        body: { items: [{ index: 0, text: TEXT.resolvedResponse, attachments: [] }] },
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
        body: { note: TEXT.resolvedNote },
      }),
      `resolve ${clarification.id}`,
    );
    changed++;
  }
  detail = await caseDetail(api, item.id);
  changed += await determined(context, reviewer, item.id, detail, 'approved', TEXT.resolvedReasons);
  return changed;
}

/**
 * Brings the case's determination to `want`: proposed `compliant` by `reviewer`, and approved by
 * the supervisor when `want` is `approved`.
 */
async function determined(
  context: SeedContext,
  reviewer: string,
  caseId: string,
  detail: Awaited<ReturnType<typeof caseDetail>>,
  want: 'proposed' | 'approved',
  reasons: string,
): Promise<number> {
  let changed = 0;
  let determination = detail.determinations.find(
    (d) => d.status === 'proposed' || d.status === 'approved',
  );
  if (!determination) {
    const api = await context.as(reviewer);
    determination = ok(
      await api.review.POST('/v1/review/cases/{caseId}/determinations', {
        params: { path: { caseId }, header: key() },
        body: { outcome: 'compliant', reasons },
      }),
      `propose the determination of ${caseId}`,
    );
    changed++;
  }
  if (want === 'approved' && determination.status === 'proposed') {
    const supervisor = await context.as(PSC_SUPERVISOR);
    ok(
      await supervisor.review.POST('/v1/review/determinations/{determinationId}/approve', {
        params: { path: { determinationId: determination.id }, header: key() },
      }),
      `approve determination ${determination.id}`,
    );
    changed++;
  }
  return changed;
}

/** PSC's enforcement ladders (spec 08). */
async function laddersOf(api: Apis) {
  const items = [];
  let cursor: string | undefined;
  do {
    const page = ok(
      await api.review.GET('/v1/commissions/{slug}/actions', {
        params: { path: { slug: PSC }, query: { limit: 100, ...(cursor && { cursor }) } },
      }),
      'PSC ladders',
    );
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** The ladder whose subject is `subjectId` (a clarification), once it exists. */
async function ladderOf(context: SeedContext, subjectId: string, timeoutMs = 5 * 60_000) {
  return waitFor(
    `the enforcement ladder of ${subjectId}`,
    async () =>
      (await laddersOf(await context.as(PSC_SUPERVISOR))).find(
        (ladder) => ladder.subjectId === subjectId,
      ),
    { timeoutMs, intervalMs: 5000 },
  );
}

/** The ladder's step `step`, once it is in one of `statuses`. */
async function stepIn(
  context: SeedContext,
  ladderId: string,
  step: 'notice-to-comply' | 'warning' | 'salary-stoppage',
  statuses: readonly string[],
) {
  return waitFor(
    `${step} ${statuses.join(' or ')} on ladder ${ladderId}`,
    async () => {
      const api = await context.as(PSC_SUPERVISOR);
      const ladder = ok(
        await api.review.GET('/v1/review/ladders/{ladderId}', { params: { path: { ladderId } } }),
        `ladder ${ladderId}`,
      );
      return ladder.steps.find((s) => s.step === step && statuses.includes(s.status));
    },
    { timeoutMs: 6 * 60_000, intervalMs: 3000 },
  );
}

/** The supervisor approves a proposed step; whether it did. */
async function approveStep(context: SeedContext, actionId: string): Promise<void> {
  const supervisor = await context.as(PSC_SUPERVISOR);
  ok(
    await supervisor.review.POST('/v1/review/actions/{actionId}/approve', {
      params: { path: { actionId }, header: key() },
    }),
    `approve action ${actionId}`,
  );
}

/**
 * A clarification left unanswered past its reply window (shortened for the seed): it goes
 * overdue and the enforcement ladder opens with a notice to comply (spec 08 S11). `upTo` carries
 * the ladder on: the notice approved and, after its window, the warning approved (`warning`); or
 * on through the warning's window to a salary stoppage approved and acknowledged by the payroll
 * (`stoppage`). The last step is issued with its legal window, so the ladder rests there.
 */
async function escalated(
  context: SeedContext,
  reviewer: string,
  item: CaseItem,
  upTo: 'warning' | 'stoppage',
): Promise<number> {
  let changed = (await claim(context, reviewer, item)) ? 1 : 0;
  const api = await context.as(reviewer);
  const detail = await caseDetail(api, item.id);
  let clarification = detail.clarifications.find((c) => c.status !== 'withdrawn');
  if (!clarification) {
    clarification = await withShortWindows(
      context,
      { DEMO_CLARIFICATION_REPLY_WINDOW: 'PT1M' },
      () =>
        issueClarification(api, item.id, {
          items: [
            {
              sectionKey: 'statement:officer',
              personKey: 'officer',
              itemId: null,
              requirement: 'provide-omitted',
              text: TEXT.unansweredItem,
            },
          ],
        }),
    );
    changed++;
  }
  const ladder = await ladderOf(context, clarification.id);
  const steps = (ladder.steps as { step: string; status: string }[]).map((s) => s.step);
  const done = (step: string) => steps.includes(step);
  const proposed = (step: 'notice-to-comply' | 'warning' | 'salary-stoppage') =>
    stepIn(context, ladder.id, step, [
      'proposed',
      'approved',
      'approved-pending-payroll',
      'issued',
    ]);

  // The notice, short when a later step follows, so the next one is proposed in a minute.
  const notice = await proposed('notice-to-comply');
  if (notice.status === 'proposed') {
    await withShortWindows(context, { DEMO_LADDER_NOTICE_WINDOW: 'PT1M' }, async () => {
      await approveStep(context, notice.id);
      await stepIn(context, ladder.id, 'notice-to-comply', ['issued']);
    });
    changed++;
  }
  const warning = await proposed('warning');
  if (warning.status === 'proposed') {
    if (upTo === 'warning') {
      await approveStep(context, warning.id);
    } else {
      await withShortWindows(context, { DEMO_LADDER_WARNING_WINDOW: 'PT1M' }, async () => {
        await approveStep(context, warning.id);
        await stepIn(context, ladder.id, 'warning', ['issued']);
      });
    }
    changed++;
  }
  await stepIn(context, ladder.id, 'warning', ['issued']);
  if (upTo === 'warning' || done('disciplinary-referral')) return changed;
  const stoppage = await proposed('salary-stoppage');
  if (stoppage.status === 'proposed') {
    await approveStep(context, stoppage.id);
    changed++;
  }
  // The payroll mock acknowledges at once; the stoppage is then issued.
  await stepIn(context, ladder.id, 'salary-stoppage', ['issued']);
  return changed;
}

/**
 * Clarifications and determinations (specs 07c, 08): Kiprono's AI-drafted clarification waiting
 * for his reply; one answered, resolved and determined compliant (approved); Otieno's clean case
 * proposed compliant and awaiting the supervisor; one unanswered past its window with the ladder
 * at a notice and a warning; one carried to a salary stoppage the payroll acknowledged.
 */
export const reviewClarifications: SeedStep = {
  id: 'review-clarifications',
  title: 'Clarifications, determinations and the enforcement ladder',
  async run(context) {
    const api = await context.as(PSC_REVIEWERS[0] ?? 'reviewer');
    const items = await queue(api);
    const personas = personaCases(items);
    const timed = await timedCases(context, items);
    let changed = 0;

    const kiprono = personas.get('kiprono');
    if (!kiprono) throw new Error("Kiprono's current case is missing");
    changed += await kipronoClarification(context, kiprono);

    changed += await resolvedClarification(context, timed.resolved);

    const otieno = personas.get('otieno');
    if (!otieno) throw new Error("Otieno's current case is missing");
    const reviewer = PSC_REVIEWERS[0] ?? 'reviewer';
    if (await claim(context, reviewer, otieno)) changed++;
    changed += await determined(
      context,
      reviewer,
      otieno.id,
      await caseDetail(api, otieno.id),
      'proposed',
      TEXT.proposedReasons,
    );

    changed += await escalated(context, PSC_REVIEWERS[2] ?? 'reviewer', timed.escalated, 'warning');
    changed += await escalated(context, PSC_REVIEWERS[2] ?? 'reviewer', timed.stoppage, 'stoppage');
    return { changed };
  },
};

/** PSC officers who leave the current cycle unfiled in the volume, clean enough to close in bulk. */
function closureCohort(officers: readonly SyntheticOfficer[]): SyntheticOfficer[] {
  const current = cycleStatementDate(CURRENT_CYCLE);
  const previous = cycleStatementDate(PREVIOUS_CYCLE);
  return officers.filter((officer) => {
    const behaviour = behaviourOf(officer);
    return (
      !behaviour.filesCurrent &&
      behaviour.filesPrevious &&
      !behaviour.omitsHolding &&
      officer.appointmentDate <= previous &&
      // No holding acquired between the cycles: nothing for the comparison to flag.
      !officer.holdings.some((h) => h.registeredOn > previous && h.registeredOn <= current)
    );
  });
}

/**
 * A bulk closure (spec 08): PSC officers who had not filed the current cycle file it now, while
 * review gives new cases a short clarification window; once it has passed, the closure sweep
 * proposes the clean, low-risk ones `compliant-no-issues` (diverting a sample to review) and the
 * supervisor approves them in bulk.
 */
export const reviewClosure: SeedStep = {
  id: 'review-closure',
  title: 'Bulk closure of clean low-risk cases',
  async run(context) {
    const summary = async () =>
      ok(
        await (
          await context.as(PSC_SUPERVISOR)
        ).review.GET('/v1/commissions/{slug}/closures', {
          params: { path: { slug: PSC }, query: { cycleYear: CURRENT_CYCLE, type: 'biennial' } },
        }),
        'PSC closures',
      );
    if ((await summary()).approved > 0) return unchanged('bulk closure approved already');

    const cohort = closureCohort((await syntheticOfficers(context)).get(PSC) ?? []);
    let changed = 0;
    await withShortWindows(context, { DEMO_CASE_ISSUE_WINDOW: 'PT2M' }, async () => {
      for (const officer of cohort) {
        const declarant = {
          demoKey: syntheticDemoKey(officer.nationalId),
          birth: { date: officer.dateOfBirth, place: officer.placeOfBirth },
        };
        const { obligations, declarations } = await declarantState(
          await context.as(declarant.demoKey),
        );
        const obligation = obligations.find(
          (o) => o.cycleKey === `biennial:${String(CURRENT_CYCLE)}` && o.status !== 'cancelled',
        );
        if (!obligation) continue;
        const existing = declarations.find(
          (d) => d.obligationId === obligation.id && d.status !== 'discarded',
        );
        changed += await fileObligation(
          context,
          declarant,
          obligation,
          existing,
          holdingsOf(officer, cycleStatementDate(CURRENT_CYCLE), CURRENT_CYCLE),
          holdingsOf(officer, cycleStatementDate(PREVIOUS_CYCLE), PREVIOUS_CYCLE),
        );
      }
      // Their cases are created while the short window holds.
      const names = new Set(cohort.map((o) => o.personnelFileNumber.toUpperCase()));
      await waitFor(
        `the closure cohort's ${String(cohort.length)} cases`,
        async () => {
          const items = await queue(await context.as(PSC_SUPERVISOR), { cycle: CURRENT_CYCLE });
          const found = items.filter((i) => names.has(i.personnelFileNumber.toUpperCase()));
          return found.length >= cohort.length ? found : undefined;
        },
        { timeoutMs: 10 * 60_000, intervalMs: 3000 },
      );
    });
    // Past the short window, the sweep proposes the clean ones.
    await new Promise((resolve) => setTimeout(resolve, 2 * 60_000 + 5000));
    await triggerSchedule(context.config, 'closure-sweep-schedule:review');
    const proposed = await waitFor(
      'the closure sweep',
      async () => {
        const now = await summary();
        return now.eligibleProposed > 0 ? now : undefined;
      },
      { timeoutMs: 5 * 60_000, intervalMs: 3000 },
    );
    const result = ok(
      await (
        await context.as(PSC_SUPERVISOR)
      ).review.POST('/v1/commissions/{slug}/closures', {
        params: {
          path: { slug: PSC },
          query: { cycleYear: CURRENT_CYCLE, type: 'biennial' },
          header: key(),
        },
      }),
      'approve the bulk closure',
    );
    changed += result.approved;
    return {
      changed,
      notes: [
        `${String(cohort.length)} filed, ${String(proposed.eligibleProposed)} proposed, ${String(proposed.sampled)} sampled, ${String(result.approved)} approved`,
      ],
    };
  },
};
