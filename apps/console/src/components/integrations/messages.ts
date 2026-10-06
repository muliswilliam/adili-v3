import { formatNumber } from '../format';

/** A system as the copy names it: "HR supplier lists" is plural ("are paused", "until they are"). */
export interface SystemName {
  name: string;
  plural?: boolean;
}

/**
 * The copy of a system Adili instructs (payroll, ICMS) rather than looks up: what it sends it, and
 * who sends again what a pause refused (the gateway queues nothing).
 */
export interface Instructed {
  /** As a sentence starts: "Referrals get...". */
  instructions: string;
  /** Who sends again what a pause refuses (pause dialog, paused alert). */
  retries: string;
  /** What becomes of what the pause refused, once resumed (resume dialog). */
  resumed: string;
}

/** A system Adili instructs, with its copy. */
export interface InstructedSystem extends SystemName {
  instructed: Instructed;
}

const is = (system: SystemName) => `${system.name} ${system.plural ? 'are' : 'is'}`;
const itIs = (system: SystemName) => (system.plural ? 'they are' : 'it is');
const its = (system: SystemName) => (system.plural ? 'their' : 'its');

/** Reporting tries an ICMS push a few times, then gives up: what a pause refused is not sent. */
const ICMS_RETRIES =
  'Pushes from EACC fail after a few quick retries; EACC must push those referrals again.';

/**
 * Copy of the Integrations page (spec 07b frontend, FE-3; prototype 07b-registry). One English
 * string per key; the Swahili slot stays empty until translations are reviewed by EACC. System
 * names are the registries' own and are not translated.
 */
export const en = {
  title: 'Integrations',
  workspaceDescription: 'Registry call volume, cache hit rate, breakers and last success.',
  updatedAt: (time: string) => `Updated ${time}`,
  refresh: 'Refresh',
  // Tiles
  summaryLabel: 'Summary',
  callsTile: 'Calls (24 h)',
  callsAcross: (systems: number) =>
    `Across ${formatNumber(systems)} ${systems === 1 ? 'system' : 'systems'}`,
  hitRateTile: 'Cache hit rate',
  hitRateHint: 'Answers served from the cache',
  noCalls: 'No calls',
  noCallsHint: 'No lookups in the last 24 hours',
  openTile: 'Breakers open',
  halfOpenCount: (count: number) => `${formatNumber(count)} half-open`,
  pausedTile: 'Paused',
  noneHint: 'None',
  // Alerts
  allWorking: 'All systems are working normally.',
  notResponding: (system: SystemName) => `${is(system)} not responding.`,
  notRespondingDetail: (lastSuccess: string) => `Breaker open. Last success ${lastSuccess}.`,
  recovering: (system: SystemName) => `${is(system)} recovering.`,
  recoveringDetail: 'Breaker half-open, testing with a few calls.',
  paused: (system: SystemName) => `${is(system)} paused.`,
  pausedSince: (by: string, time: string) => `Paused by ${by} since ${time}.`,
  pausedDetail: (system: SystemName) =>
    `Lookups are marked unavailable until ${itIs(system)} resumed, cached answers included.`,
  pausedInstructionsDetail: (system: InstructedSystem) =>
    `${system.instructed.instructions} get "unavailable" until ${itIs(system)} resumed; nothing is queued. ${system.instructed.retries}`,
  // Coverage
  coverageLabel: 'Integration coverage',
  calls: 'Calls (24 h)',
  hitRate: 'Cache hit rate',
  lastSuccess: 'Last success',
  never: 'Never',
  pausedBadge: 'Paused',
  breaker: 'Breaker',
  // Details
  breakerOpenCallout:
    'Opened after repeated failures. Calls are not being sent until the breaker lets a probe through.',
  breakerHalfOpenCallout:
    'Testing recovery: the next call is a probe. One success closes the breaker.',
  pausedCallout: (system: SystemName) =>
    `Paused by a platform administrator. Nothing is sent until ${itIs(system)} resumed.`,
  pausedByCallout: (system: SystemName, by: string, at: string) =>
    `Paused by ${by} on ${at}. Nothing is sent until ${itIs(system)} resumed.`,
  // Pause and resume
  pause: 'Pause',
  resume: 'Resume',
  pauseLabel: (system: string) => `Pause ${system}`,
  resumeLabel: (system: string) => `Resume ${system}`,
  pauseTitle: (system: string) => `Pause ${system}?`,
  pauseText: (system: SystemName) =>
    `Lookups to ${system.name} will be marked unavailable until ${itIs(system)} resumed.`,
  pauseInstructionsText: (system: InstructedSystem) =>
    `${system.instructed.instructions} to ${system.name} get "unavailable" until ${itIs(system)} resumed.`,
  pauseNothingQueued: 'Adili does not queue them to send later.',
  pauseNothingSent: (system: SystemName) =>
    `Nothing is sent to ${system.name} while ${itIs(system)} paused.`,
  pauseCasesFlow: (system: SystemName) =>
    `Cases keep flowing. Their Registry tab shows ${system.name} as unavailable.`,
  pauseRechecked: (system: SystemName) =>
    `Affected cases are re-checked every hour until ${system.plural ? 'they answer' : 'it answers'}.`,
  pauseOnboarding: 'Declarants cannot confirm their identity at onboarding until it is resumed.',
  pauseCached: 'Answers already in the cache are held back too.',
  auditNote: 'Recorded in the audit trail with your name.',
  pausing: 'Pausing…',
  pauseFailed: (system: string) => `Could not pause ${system}. Try again.`,
  pausedToast: (system: string) => `${system} paused`,
  resumeTitle: (system: string) => `Resume ${system}?`,
  resumeText: (system: SystemName, perMinute: number) =>
    `Lookups to ${system.name} start again, within ${its(system)} rate limit of ${formatNumber(perMinute)} calls a minute.`,
  resumeInstructionsText: (system: InstructedSystem, perMinute: number) =>
    `${system.instructed.instructions} are sent to ${system.name} again, within ${its(system)} rate limit of ${formatNumber(perMinute)} calls a minute.`,
  resuming: 'Resuming…',
  resumeFailed: (system: string) => `Could not resume ${system}. Try again.`,
  resumedToast: (system: string) => `${system} resumed`,
  cancel: 'Cancel',
  // Instructed systems. Review retries every unacknowledged payroll instruction with backoff of at
  // most 5 minutes and no attempt limit; reporting tries an ICMS push a few times, then gives up.
  payrollInstructions: 'Salary stoppages and reinstatements',
  payrollRetries:
    'The review service keeps retrying them (at most 5 minutes apart) and they are sent once payroll is resumed.',
  payrollResumed:
    'Those refused while it was paused are sent within about 5 minutes: the review service keeps retrying them.',
  icmsInstructions: 'Referrals',
  icmsRetries: ICMS_RETRIES,
  icmsResumed: `Nothing refused while it was paused is sent on its own. ${ICMS_RETRIES}`,
  actionForbidden: 'You do not have access to pause or resume integrations.',
  operatedBy: 'Operated by',
  rateLimit: 'Rate limit',
  rateLimitValue: (perMinute: number) => `${formatNumber(perMinute)} calls a minute`,
  cacheLifetime: 'Cache lifetime',
  cacheLifetimeValue: (lifetime: string) => `${lifetime}, hits and misses`,
  notCached: 'Not cached',
  failedCalls: 'Failed calls (24 h)',
  breakerRule: 'Breaker rule',
  breakerRuleValue: (threshold: number, cooldown: string) =>
    `Opens after ${formatNumber(threshold)} failures in a row, tries again after ${cooldown}`,
  timeout: 'Timeout',
  timeoutValue: (duration: string) => `${duration} per call`,
  configNote:
    'Rate limits and cache lifetimes are configuration; contact the platform team to change them.',
  // States
  errorTitle: 'Coverage could not be loaded.',
  errorDetail: 'Registries may still be working. Try again in a moment.',
  tryAgain: 'Try again',
  forbidden: 'You do not have access to integrations.',
  backToOverview: 'Back to overview',
  emptyTitle: 'No integrations yet',
  emptyText: 'Systems appear here once their adapters are configured.',
  loadingLabel: 'Integration coverage (loading)',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
