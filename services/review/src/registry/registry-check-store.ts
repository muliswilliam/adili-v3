import { type Database, withTenant } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewTransaction } from '../cases/case-lookup.js';
import { reviewCases, reviewFlags, reviewTimeline } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import {
  band,
  type Flag,
  REGISTRY_SYSTEMS,
  type RegistryCheckStatus,
  type RegistryMatch,
  type RegistrySystem,
  registrySystemOf,
  score,
} from '../rules/index.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import type { CheckStatus, RegistryCheckRequest, RegistryCheckResult } from './contract.js';
import { REVIEW_REGISTRY_CHECKED, type RegistryCheckedData } from './events.js';
import { registryChecks } from './schema.js';

/** How the timeline and messages name each registry. */
export const SYSTEM_LABELS: Record<RegistrySystem, string> = {
  kra: 'KRA',
  ntsa: 'NTSA',
  brs: 'BRS',
  ardhisasa: 'ArdhiSasa',
};

/**
 * Stores a registry check on the case, in one transaction under the case's lock, if the case is
 * still at the checked version and no check that started later (a higher `sequence`) is stored
 * already (`stale` otherwise, storing nothing): re-checks, the sweep and processing run checks of
 * a case on workflows of their own, so two may overlap, and the newer one wins whichever ends
 * last.
 *
 * - the version's registry flags are reconciled with the match: a flag the match raises again is
 *   kept as it is (reviewed or not, and open again if a check before had superseded it), a new
 *   one is added, and one the match no longer raises is closed `superseded-by-recheck`, with its
 *   note if reviewed, when its registry answered for its person this time. A registry still
 *   unavailable leaves its flags open: no answer is no reason to drop them.
 * - the statuses per person and registry replace the previous check's;
 * - the score and band are the version's deterministic flags and its open registry flags
 *   together, the open-flag count (unreviewed and not closed) is recounted and
 *   `registryUnavailable` set for the queue;
 * - a timeline entry and `review.registry.checked.v1`.
 *
 * Storing the same check (its `sequence`) again writes nothing and answers as the first time.
 */
export async function storeRegistryCheck(
  db: Database<ReviewSchema>,
  events: EventPublisher,
  check: RegistryCheckRequest,
  match: RegistryMatch,
  sequence: number,
): Promise<RegistryCheckResult> {
  return withTenant(db, systemContext(check.tenant), async (tx) => {
    const [found] = await tx
      .select()
      .from(reviewCases)
      .where(eq(reviewCases.id, check.caseId))
      .for('update');
    if (found?.currentVersionId !== check.versionId) return { outcome: 'stale' };
    if (sequence < found.storedRegistryCheck) return { outcome: 'stale' };
    // This check is stored already (the activity retried after its commit): the same lookups
    // match the same, so nothing to write, no second timeline entry or event.
    if (sequence === found.storedRegistryCheck) {
      return checkedResult(match, await lastCheckedAt(tx, found.id), false);
    }

    const versionFlags = await tx
      .select()
      .from(reviewFlags)
      .where(and(eq(reviewFlags.caseId, found.id), eq(reviewFlags.versionId, check.versionId)));
    const existing = new Map(
      versionFlags
        .filter((flag) => registrySystemOf(flag.ruleId) !== null)
        .map((flag) => [identity(flag), flag]),
    );
    const raised = new Set(match.flags.map(identity));
    const added = match.flags.filter((flag) => !existing.has(identity(flag)));
    // A registry that answered for a person settles that person's flags of it; one still
    // unavailable leaves them as they are.
    const answered = new Set(
      match.checks
        .filter((entry) => entry.status === 'matched' || entry.status === 'mismatched')
        .map((entry) => `${entry.personKey} ${entry.system}`),
    );
    const settled = (flag: (typeof versionFlags)[number]) =>
      flag.itemRefs.some((ref) =>
        answered.has(`${ref.personKey} ${String(registrySystemOf(flag.ruleId))}`),
      );
    const reopened: string[] = [];
    const superseded: string[] = [];
    const stillOpen: Pick<Flag, 'severity'>[] = [];
    for (const flag of existing.values()) {
      if (raised.has(identity(flag))) {
        if (flag.closedReason !== null) reopened.push(flag.id);
      } else if (flag.closedReason === null) {
        if (settled(flag)) superseded.push(flag.id);
        else stillOpen.push(flag);
      }
    }
    if (superseded.length > 0) {
      // Reviewed or not, a superseded flag stays with its note; it no longer counts.
      await tx
        .update(reviewFlags)
        .set({ closedReason: 'superseded-by-recheck' })
        .where(inArray(reviewFlags.id, superseded));
    }
    if (reopened.length > 0) {
      await tx
        .update(reviewFlags)
        .set({ closedReason: null })
        .where(inArray(reviewFlags.id, reopened));
    }
    if (added.length > 0) {
      await tx.insert(reviewFlags).values(
        added.map((flag) => ({
          id: uuidv7(),
          tenant: check.tenant,
          caseId: found.id,
          versionId: check.versionId,
          ruleId: flag.ruleId,
          severity: flag.severity,
          title: flag.title,
          indicator: flag.indicator,
          evidence: flag.evidence,
          itemRefs: flag.itemRefs,
        })),
      );
    }

    // The check's time is the database's, as the timeline's: the case's other entries are too.
    const before = await tx
      .select({
        personKey: registryChecks.personKey,
        system: registryChecks.system,
        status: registryChecks.status,
      })
      .from(registryChecks)
      .where(eq(registryChecks.caseId, found.id));
    await tx.delete(registryChecks).where(eq(registryChecks.caseId, found.id));
    if (match.checks.length > 0) {
      await tx.insert(registryChecks).values(
        match.checks.map((entry) => ({
          id: uuidv7(),
          tenant: check.tenant,
          caseId: found.id,
          versionId: check.versionId,
          personKey: entry.personKey,
          system: entry.system,
          status: entry.status,
          reason: entry.reason,
          resultId: entry.resultId,
        })),
      );
    }

    const rules = versionFlags.filter((flag) => registrySystemOf(flag.ruleId) === null);
    const caseScore = score([...rules, ...match.flags, ...stillOpen]);
    const caseBand = band(caseScore);
    const [open] = await tx
      .select({ count: count() })
      .from(reviewFlags)
      .where(
        and(
          eq(reviewFlags.caseId, found.id),
          isNull(reviewFlags.reviewedAt),
          isNull(reviewFlags.closedReason),
        ),
      );
    const statuses = statusesOf(match);
    const systems = systemStatuses(statuses);
    await tx
      .update(reviewCases)
      .set({
        score: caseScore,
        band: caseBand,
        openFlags: open?.count ?? 0,
        registryUnavailable: statuses.some((entry) => entry.status === 'unavailable'),
        storedRegistryCheck: sequence,
      })
      .where(eq(reviewCases.id, found.id));
    await tx.insert(reviewTimeline).values({
      id: uuidv7(),
      tenant: check.tenant,
      caseId: found.id,
      kind: 'registry-checked',
      ref: check.versionId,
      actor: SYSTEM_SUBJECT,
      summary: timelineSummary(match.flags.length, superseded.length, systems),
    });
    await events.record<RegistryCheckedData>(tx, {
      type: REVIEW_REGISTRY_CHECKED,
      subject: found.id,
      tenant: check.tenant,
      data: {
        caseId: found.id,
        versionId: check.versionId,
        band: caseBand,
        flags: match.flags.length,
        superseded: superseded.length,
        systems,
        checks: statuses,
      },
    });
    return checkedResult(match, await lastCheckedAt(tx, found.id), statusesChanged(before, match));
  });
}

function checkedResult(
  match: RegistryMatch,
  checkedAt: string,
  changed: boolean,
): RegistryCheckResult {
  return {
    outcome: 'checked',
    flags: match.flags.length,
    statuses: statusesOf(match),
    checkedAt,
    changed,
  };
}

/** The time the case's statuses were stored: the transaction's, when it stored none. */
async function lastCheckedAt(tx: ReviewTransaction, caseId: string): Promise<string> {
  const [row] = await tx
    .select({ at: sql<Date | string>`coalesce(max(${registryChecks.checkedAt}), now())` })
    .from(registryChecks)
    .where(eq(registryChecks.caseId, caseId));
  return new Date(row?.at ?? Date.now()).toISOString();
}

/** Whether any person's status in any registry differs between two checks of a case. */
function statusesChanged(
  before: readonly { personKey: string; system: string; status: string }[],
  match: RegistryMatch,
): boolean {
  const key = (entry: { personKey: string; system: string; status: string }) =>
    `${entry.personKey} ${entry.system} ${entry.status}`;
  const previous = new Set(before.map(key));
  const now = new Set(match.checks.map(key));
  return previous.size !== now.size || [...now].some((entry) => !previous.has(entry));
}

function statusesOf(match: RegistryMatch): CheckStatus[] {
  return match.checks.map(({ personKey, system, status, reason }) => ({
    personKey,
    system,
    status,
    reason,
  }));
}

/** What makes two flags the same indicator: the rule, the evidence and the items it points at. */
function identity(flag: { ruleId: string } & Pick<Flag, 'evidence' | 'itemRefs'>): string {
  return canonical([flag.ruleId, flag.evidence, flag.itemRefs]);
}

/** JSON with object keys sorted: jsonb does not keep the order a flag was written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

/** The order a registry's household status is taken in: the first any person has. */
const STATUS_PRECEDENCE: RegistryCheckStatus[] = [
  'unavailable',
  'mismatched',
  'matched',
  'not-checked',
  'no-id',
];

/** Each registry's status over the household: unavailable for anyone, else mismatched, and so on. */
export function systemStatuses(
  statuses: Pick<CheckStatus, 'system' | 'status'>[],
): Record<RegistrySystem, RegistryCheckStatus> {
  return Object.fromEntries(
    REGISTRY_SYSTEMS.map((system) => {
      const of = new Set(statuses.filter((s) => s.system === system).map((s) => s.status));
      return [system, STATUS_PRECEDENCE.find((status) => of.has(status)) ?? 'not-checked'];
    }),
  ) as Record<RegistrySystem, RegistryCheckStatus>;
}

function timelineSummary(
  flags: number,
  superseded: number,
  systems: Record<RegistrySystem, RegistryCheckStatus>,
): string {
  const unavailable = REGISTRY_SYSTEMS.filter((system) => systems[system] === 'unavailable');
  const parts = [
    `Registries checked: ${String(flags)} registry indicator${flags === 1 ? '' : 's'}`,
  ];
  if (superseded > 0) parts.push(`${String(superseded)} no longer raised`);
  if (unavailable.length > 0) {
    parts.push(`not reached: ${unavailable.map((s) => SYSTEM_LABELS[s]).join(', ')}`);
  }
  return parts.join('; ');
}
