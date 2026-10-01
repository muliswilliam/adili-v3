import { formatNumber } from '../format';

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
  openTile: 'Breakers open',
  halfOpenCount: (count: number) => `${formatNumber(count)} half-open`,
  pausedTile: 'Paused',
  noneHint: 'None',
  // Alerts
  allWorking: 'All systems are working normally.',
  notResponding: (system: string) => `${system} is not responding.`,
  notRespondingDetail: (lastSuccess: string) => `Breaker open. Last success ${lastSuccess}.`,
  recovering: (system: string) => `${system} is recovering.`,
  recoveringDetail: 'Breaker half-open, testing with a few calls.',
  paused: (system: string) => `${system} is paused.`,
  pausedSince: (by: string, time: string) => `Paused by ${by} since ${time}.`,
  pausedDetail: 'Lookups are marked unavailable until it is resumed. Cached answers still serve.',
  // Coverage
  coverageLabel: 'Integration coverage',
  calls: 'Calls (24 h)',
  hitRate: 'Cache hit rate',
  lastSuccess: 'Last success',
  never: 'Never',
  pausedBadge: 'Paused',
  // Details
  breakerOpenCallout:
    'Opened after repeated failures. Calls are not being sent until the breaker lets a probe through.',
  breakerHalfOpenCallout:
    'Testing recovery: the next call is a probe. One success closes the breaker.',
  pausedCallout: 'Paused by a platform administrator. Nothing is sent until it is resumed.',
  pausedByCallout: (by: string, at: string) =>
    `Paused by ${by} on ${at}. Nothing is sent until it is resumed.`,
  // Pause and resume
  pause: 'Pause',
  resume: 'Resume',
  pauseLabel: (system: string) => `Pause ${system}`,
  resumeLabel: (system: string) => `Resume ${system}`,
  pauseTitle: (system: string) => `Pause ${system}?`,
  pauseText: (system: string) =>
    `Lookups to ${system} will be marked unavailable until it is resumed.`,
  pauseNothingSent: (system: string) => `Nothing is sent to ${system} while it is paused.`,
  pauseCasesFlow: (system: string) =>
    `Cases keep flowing. Their Registry tab shows ${system} as unavailable.`,
  pauseRechecked: 'Affected cases are re-checked every hour until it answers.',
  pauseOnboarding: 'Declarants cannot confirm their identity at onboarding until it is resumed.',
  pauseCached: 'Answers already in the cache are still served.',
  auditNote: 'Recorded in the audit trail with your name.',
  pausing: 'Pausing…',
  pauseFailed: (system: string) => `Could not pause ${system}. Nothing changed. Try again.`,
  pausedToast: (system: string) => `${system} paused`,
  resumeTitle: (system: string) => `Resume ${system}?`,
  resumeText: (system: string, perMinute: number) =>
    `Lookups to ${system} start again, within its rate limit of ${formatNumber(perMinute)} calls a minute.`,
  resuming: 'Resuming…',
  resumeFailed: (system: string) => `Could not resume ${system}. It is still paused. Try again.`,
  resumedToast: (system: string) => `${system} resumed`,
  cancel: 'Cancel',
  actionForbidden: 'You do not have access to pause or resume integrations.',
  operatedBy: 'Operated by',
  rateLimit: 'Rate limit',
  rateLimitValue: (perMinute: number) => `${formatNumber(perMinute)} calls a minute`,
  cacheLifetime: 'Cache lifetime',
  cacheLifetimeValue: (lifetime: string) => `${lifetime}, hits and misses`,
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
