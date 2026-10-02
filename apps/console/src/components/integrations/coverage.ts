import type { IntegrationSystem, SystemCoverage } from '../../server/integration-gateway/client';
import { formatRelativeTime } from '../format';

/** Who runs a system and what Adili asks it, as the Integrations page describes it. */
export interface SystemInfo {
  name: string;
  /** The name is plural ("HR supplier lists are paused"). */
  plural?: boolean;
  owner: string;
  use: string;
  /**
   * What Adili sends a system it instructs rather than looks up (payroll, ICMS), as a sentence
   * starts ("Referrals are not sent..."). Instructions are acts: never cached, and a pause holds
   * them back (their callers retry) instead of marking lookups unavailable.
   */
  instructions?: string;
}

/** Every system the coverage response can list, as the prototype words them. */
const SYSTEM_INFO: Record<IntegrationSystem, SystemInfo> = {
  iprs: {
    name: 'IPRS',
    owner: 'National Registration Bureau',
    use: 'Identity checks at onboarding',
  },
  kra: {
    name: 'KRA iTax',
    owner: 'Kenya Revenue Authority',
    use: 'PIN, tax compliance and income declared to KRA',
  },
  ntsa: {
    name: 'NTSA TIMS',
    owner: 'National Transport and Safety Authority',
    use: 'Vehicles by owner',
  },
  brs: {
    name: 'BRS',
    owner: 'Business Registration Service',
    use: 'Directorships and shareholdings',
  },
  ardhisasa: {
    name: 'ArdhiSasa',
    owner: 'Ministry of Lands and Physical Planning',
    use: 'Land parcels by owner',
  },
  'hr-suppliers': {
    name: 'HR supplier lists',
    plural: true,
    owner: 'Employers (HR systems)',
    use: "Whether a declarant's company supplies their employer",
  },
  payroll: {
    name: 'Payroll (IPPD)',
    owner: 'State Department for Public Service',
    use: 'Salary stoppages and reinstatements of officers',
    instructions: 'Salary stoppages and reinstatements',
  },
  icms: {
    name: 'EACC ICMS',
    owner: 'Ethics and Anti-Corruption Commission',
    use: "Commissions' referrals, registered as EACC cases",
    instructions: 'Referrals',
  },
};

/** How the page names and describes a system of the coverage response. */
export function systemInfo(system: IntegrationSystem): SystemInfo {
  return SYSTEM_INFO[system];
}

/** Whether Adili instructs the system (payroll, ICMS) rather than looks it up. */
export const isInstructed = (system: SystemInfo): system is SystemInfo & { instructions: string } =>
  system.instructions !== undefined;

export interface CoverageSummary {
  calls24h: number;
  /** Calls to the systems that cache their answers (instructions never are). */
  cachedCalls24h: number;
  /** Across the systems that cache, weighted by their calls; 0 without calls. */
  cacheHitRate: number;
  /** Open breakers of systems that are not paused (a paused system is expected to be quiet). */
  open: SystemCoverage[];
  halfOpen: SystemCoverage[];
  paused: SystemCoverage[];
}

/** The tiles and alerts above the coverage list. */
export function summarise(rows: readonly SystemCoverage[]): CoverageSummary {
  const calls24h = rows.reduce((sum, row) => sum + row.calls24h, 0);
  const cached = rows.filter((row) => row.cacheTtlSeconds !== null);
  const cachedCalls24h = cached.reduce((sum, row) => sum + row.calls24h, 0);
  const hits = cached.reduce((sum, row) => sum + row.calls24h * row.cacheHitRate, 0);
  return {
    calls24h,
    cachedCalls24h,
    cacheHitRate: cachedCalls24h > 0 ? hits / cachedCalls24h : 0,
    open: rows.filter((row) => row.breaker === 'open' && !row.paused),
    halfOpen: rows.filter((row) => row.breaker === 'half-open' && !row.paused),
    paused: rows.filter((row) => row.paused),
  };
}

/** `42%`. */
export const formatPercent = (rate: number) => `${String(Math.round(rate * 100))}%`;

/** `Never`, `Just now`, `12 minutes ago`, `4 hours ago`, then days: when the registry last answered. */
export function formatLastSuccess(iso: string | null, now: Date, never: string): string {
  if (iso === null) return never;
  const relative = formatRelativeTime(iso, now);
  return relative.charAt(0).toUpperCase() + relative.slice(1);
}

/**
 * Whether the last success is worth a second look: the registry failed in the last 24 hours and
 * has not answered for over an hour (or ever). A quiet system with an old success is not.
 */
export function isLastSuccessStale(row: SystemCoverage, now: Date): boolean {
  if (row.paused || row.failures24h === 0) return false;
  if (row.lastSuccessAt === null) return true;
  return now.getTime() - new Date(row.lastSuccessAt).getTime() > 60 * 60_000;
}

/** `24 hours`, `30 minutes`, `45 seconds`. */
export function formatDuration(seconds: number): string {
  const unit = (value: number, one: string) => `${String(value)} ${value === 1 ? one : `${one}s`}`;
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, 'hour');
  if (seconds % 60 === 0) return unit(seconds / 60, 'minute');
  return unit(Math.round(seconds * 10) / 10, 'second');
}
