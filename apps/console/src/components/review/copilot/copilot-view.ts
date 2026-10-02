import { formatCalendarDate, formatDate } from '@adili/ui';

import type { Copilot } from '../../../server/copilot.server';
import type { CaseDetail, Flag } from '../../../server/review/types';
import { messages as t } from './messages';

/**
 * What the Copilot panel shows, worked out from the copilot view and the case (spec 07c FE-2):
 * pure, so each state is tested without rendering.
 */

/** Who is looking: the reviewer holding the case rates and refreshes; a supervisor reads and refreshes. */
export type CopilotAccess = 'assignee' | 'supervisor' | 'viewer';

export type LauncherTone = 'ready' | 'busy' | 'warning' | 'off';

/** The launcher's status line and its look, while the copilot loads and in each state. */
export function launcherStatus(
  copilot: Copilot | null,
  error: string | null,
): { text: string; tone: LauncherTone } {
  if (!copilot) {
    return error
      ? { text: t.launcher.failed, tone: 'warning' }
      : { text: t.launcher.loading, tone: 'busy' };
  }
  switch (copilot.status) {
    case 'ready':
      return { text: t.launcher.ready, tone: 'ready' };
    case 'pending':
      return { text: t.launcher.pending, tone: 'busy' };
    case 'stale':
      return { text: t.launcher.stale, tone: 'busy' };
    case 'failed':
      return { text: t.launcher.failed, tone: 'warning' };
    case 'not-enabled':
      return { text: t.launcher.notEnabled, tone: 'off' };
  }
}

/** "AI service unavailable", "declined by the AI model": the reason a job failed, in words. */
export function failureReasonText(reason: string | null): string {
  return (reason ? t.reasons[reason] : undefined) ?? t.unknownReason;
}

/** The first day of next month in Kenyan time, when a monthly budget starts again: `1 Nov 2026`. */
export function budgetResetDate(now: Date): string {
  const [year = 0, month = 1] = formatCalendarDate(now.getTime()).split('-').map(Number);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return formatDate(
    `${String(next.year)}-${String(next.month).padStart(2, '0')}-01T00:00:00+03:00`,
  );
}

/** The version number the copilot was produced for, as the case lists its versions. */
export function versionNumber(
  forVersionId: string | null,
  versions: CaseDetail['versions'],
): string {
  const found = versions.find((each) => each.versionId === forVersionId);
  if (found) return String(found.version);
  const latest = versions.at(-1);
  return latest ? String(latest.version) : '1';
}

const SEVERITY_ORDER: Record<Flag['severity'], number> = { high: 0, medium: 1, low: 2, info: 3 };

/** A flag the reviewer has dealt with: reviewed, or closed by a registry re-check. */
export const flagDone = (flag: Flag): boolean =>
  flag.reviewed !== null || Boolean(flag.closedReason);

/** Open flags first, then reviewed, then closed; each by severity, high first. */
export function sortFlags(flags: Flag[]): Flag[] {
  const stage = (flag: Flag) => (flag.closedReason ? 2 : flag.reviewed ? 1 : 0);
  return flags
    .slice()
    .sort((a, b) => stage(a) - stage(b) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * The version an output is for had an earlier declaration to compare with: not a first
 * declaration on Adili (`firstOnAdili`, which the rules' `no-previous-version` set). Read from
 * the case's versions, not its flags: an amendment replaces the earlier version's flags, so a
 * stale output of version 1 would otherwise read version 2's. No version (none ready yet) reads
 * the current one.
 */
export function hasPreviousDeclaration(
  versions: CaseDetail['versions'],
  versionId: string | null,
): boolean {
  const version = versions.find((each) => each.versionId === versionId) ?? versions.at(-1);
  return version ? !version.firstOnAdili : true;
}

/** The blocks of a summary, each rated on its own (review.yaml `CopilotBlock`). */
export type SummaryBlock = 'overview' | 'changes' | 'sections' | 'worth-attention';

/** A rated block: a summary block, or one flag's explanation (`flag:<flagId>`). */
export type CopilotBlock = SummaryBlock | `flag:${string}`;

/** The block key of a flag's explanation. */
export const explanationBlock = (flagId: string): CopilotBlock => `flag:${flagId}`;
