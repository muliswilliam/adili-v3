import type { DataClass, ProviderClass } from '../../server/ai-gateway/types';
import { formatNumber } from '../format';

/**
 * Copy of the AI policy page (platform admins) and the Commission's AI status line (spec 07c
 * frontend, FE-4), as the 07c prototype words it. One English string per key; the Swahili slot
 * stays empty until translations are reviewed by EACC.
 */
export const en = {
  title: 'AI policy',
  enabledCount: (enabled: number, total: number) =>
    `${formatNumber(enabled)} of ${formatNumber(total)} Commissions enabled`,
  tabsLabel: 'AI policy',
  tabCommissions: 'Commissions',
  tabRouting: 'Routing',

  dataClass: {
    synthetic: 'Synthetic',
    restricted: 'Restricted',
    'highly-confidential': 'Highly confidential',
  } satisfies Record<DataClass, string>,
  providerClass: { external: 'External', 'self-hosted': 'Self-hosted' } satisfies Record<
    ProviderClass,
    string
  >,
  dataClassesTip:
    'Synthetic: generated demo declarations. Restricted: aggregates and non-personal data. Highly confidential: real declarations.',
  dataClassesTipLabel: 'About data classes',

  // Commissions tab
  searchLabel: 'Search Commissions',
  searchPlaceholder: 'Commission',
  filterLabel: 'Show',
  filterAll: 'All',
  filterEnabled: 'Enabled',
  filterNotEnabled: 'Not enabled',
  filterBudget: 'Budget 80%+',
  filterCountLabel: 'Commissions',
  caption: 'Classification gate, usage and rate limit per Commission',
  columnCommission: 'Commission',
  columnUsage: (month: string) => `Usage, ${month}`,
  columnUsageThisMonth: 'Usage this month',
  columnRateLimit: 'Rate limit',
  blocked: 'Blocked',
  notEnabled: 'Not enabled',
  notEnabledBlocked: (blocked: number) => `Not enabled · ${formatNumber(blocked)} blocked`,
  usageUnavailable: 'Usage unavailable',
  perMinuteShort: (limit: number) => `${formatNumber(limit)}/min`,
  pagination: 'Commissions pages',
  pageRange: (from: number, to: number, total: number) =>
    `Showing ${formatNumber(from)}-${formatNumber(to)} of ${formatNumber(total)} Commissions`,
  pageRows: (count: number) => `Showing ${formatNumber(count)} Commissions`,
  previousPage: 'Previous page',
  nextPage: 'Next page',
  noMatchesTitle: 'No Commissions here',
  noMatchesText: 'Try another search or filter.',
  clearFilters: 'Clear filters',
  emptyTitle: 'No Commissions yet',
  emptyText: 'Commissions created in the Commissions workspace appear here, with the default gate.',
  loadErrorTitle: 'AI policy could not be loaded.',
  loadErrorDetail: 'Nothing has changed. Try again in a moment.',
  tryAgain: 'Try again',
  forbiddenTitle: 'You do not have access to AI policy',
  forbiddenText: 'Only platform administrators can see AI policy.',
  backToOverview: 'Go to overview',

  // Routing tab
  routingCaption: 'Routing: task to provider and model',
  routingAudited: 'Changes take effect at the next request and are recorded in the audit trail.',
  addRoute: "Add a Commission's route",
  editRoute: 'Edit',
  editRouteLabel: (task: string, scope: string) => `Edit route of ${task} for ${scope}`,
  columnTask: 'Task',
  columnScope: 'Scope',
  columnProvider: 'Provider',
  columnModel: 'Model',
  columnParameters: 'Parameters',
  allCommissions: 'All Commissions',
  routingErrorTitle: 'Routing could not be loaded.',
  routingEmpty: 'No routes are configured.',
  paramMaxTokens: 'Max output tokens',
  paramEffort: 'Effort',
  effort: (effort: string) =>
    (({ low: 'Low', medium: 'Medium', high: 'High' }) as Record<string, string>)[effort] ?? effort,
  paramTimeout: 'Timeout',
  taskDefaults: 'Task defaults',
  seconds: (seconds: number) => `${formatNumber(seconds)} s`,

  // Route dialog
  routeTitleEdit: 'Edit route',
  routeTitleAdd: "Add a Commission's route",
  routeTask: 'Task',
  routeScope: 'Commission',
  routeProvider: 'Provider',
  routeProviderHint: 'A provider the AI gateway is configured to reach, for example anthropic.',
  routeModel: 'Model',
  routeMaxTokens: 'Max output tokens',
  routeEffort: 'Effort',
  routeTimeout: 'Timeout (seconds)',
  routeOptionalHint: "Leave a parameter empty to use the task's own.",
  routeTaskDefault: 'Task default',
  routeProviderRequired: 'Enter the provider.',
  routeModelRequired: 'Enter the model.',
  routeNumberError: 'Enter a whole number above 0, or leave it empty.',
  routeProviderUnknown: 'The AI gateway cannot reach this provider.',
  saveRoute: 'Save route',
  removeRoute: 'Remove route',
  routeSaved: 'Route saved and recorded in the audit trail',
  routeRemoved: 'Route removed and recorded in the audit trail',
  routeError: 'The route could not be saved.',
  routeRejected: 'The gateway refused this route.',

  // Commission drawer
  enabled: 'Enabled',
  gatePolicy: 'Gate policy',
  gateCaption: 'Provider classes allowed per data class',
  columnDataClass: 'Data class',
  allowed: 'Allowed',
  usageHeading: (month: string) => `Usage, ${month}`,
  usedUpCallout: (resetsOn: string) =>
    `Budget used up. New AI requests are blocked until ${resetsOn}.`,
  jobs: 'Jobs',
  blockedJobs: 'Blocked',
  failedJobs: 'Failed',
  cost: 'Cost',
  monthlyBudget: 'Monthly budget',
  rateLimit: 'Rate limit',
  tokens: (tokens: number) => `${formatNumber(tokens)} tokens`,
  perMinute: (limit: number) => `${formatNumber(limit)} a minute`,
  usageLoadError: 'Usage could not be loaded. Try again in a moment.',
  changes: 'Changes',
  noChanges: 'No changes. The default applies: external providers see no data.',
  defaultRule: 'Default',
  changeAllowed: (provider: string, data: string) =>
    `Allowed ${provider.toLowerCase()} providers for ${data.toLowerCase()} data`,
  changeBlocked: (provider: string, data: string) =>
    `Blocked ${provider.toLowerCase()} providers for ${data.toLowerCase()} data`,
  editBudget: 'Edit budget',
  editPolicy: 'Edit policy',

  // Edit gate policy dialog
  editTitle: 'Edit gate policy',
  editCaption: 'Allow provider classes per data class',
  allowLabel: (provider: string, data: string) =>
    `Allow ${provider.toLowerCase()} providers for ${data.toLowerCase()} data`,
  selfHostedNote:
    'No self-hosted provider is routed yet. Allowing it has no effect until one is configured.',
  cancel: 'Cancel',
  continue: 'Continue',

  // Confirm dialog
  confirmTitle: 'Confirm policy change',
  confirmAllow: (provider: string, data: string, commission: string) =>
    `${provider} providers may process ${data.toLowerCase()} data for ${commission}.`,
  confirmBlock: (provider: string, data: string, commission: string) =>
    `${provider} providers will no longer process ${data.toLowerCase()} data for ${commission}. New AI requests are blocked; outputs already shown stay.`,
  approvalRef: 'Record the approval reference.',
  approvalRefPlaceholder: 'For example EACC/AI/2026/022',
  approvalRefRequired: 'Enter the approval reference.',
  auditNote: 'Recorded in the audit trail with your name.',
  back: 'Back',
  savePolicy: 'Save policy',
  saving: 'Saving…',
  policySaved: 'Policy saved and recorded in the audit trail',
  saveError: 'The policy could not be saved.',
  saveErrorText: 'Nothing was changed. Try again in a moment.',
  saveForbidden: 'You no longer have access to change AI policy.',
  saveRejected: 'The gateway refused this change.',

  // Budget dialog
  budgetTitle: 'Edit budget',
  monthlyTokens: 'Monthly tokens',
  usedThisMonth: (tokens: number) => `Used this month: ${formatNumber(tokens)}`,
  requestsPerMinute: 'Requests a minute',
  monthlyTokensError: 'Enter a whole number of tokens, 0 or more.',
  perMinuteError: 'Enter at least 1 request a minute.',
  belowUsage: (resetsOn: string) =>
    `Below this month's usage. New AI requests are blocked until ${resetsOn}.`,
  saveBudget: 'Save budget',
  budgetSaved: 'Budget saved',
  budgetError: 'The budget could not be saved.',

  // Commission status line (the Commission's policy card)
  aiAssistance: 'AI assistance',
  aiEnabledText: (provider: string, data: string, only: boolean) =>
    `${provider} provider, ${data} data${only ? ' only' : ''}`,
  aiNotEnabledText: 'No declaration data is sent to an AI provider',
  /** The status line's detail after Enabled or Not enabled: "(external provider, …)". */
  statusDetail: (text: string) => `(${text.charAt(0).toLowerCase()}${text.slice(1)})`,
  /** After the detail: which provider, by name. */
  statusProvider: (provider: string) => ` · ${provider}`,
  aiStatusUnavailable: 'Could not be checked. Reload the page to try again.',
} as const;

/** Swahili translations, key by key; empty until reviewed. */
export const sw: Partial<Record<keyof typeof en, string>> = {};

export const messages = en;
