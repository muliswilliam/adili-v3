import type { IntegrationSystem, SystemCoverage } from '../../server/integration-gateway/client';
import { formatRelativeTime } from '../format';

/** Who runs a system and what Adili asks it, as the Integrations page describes it. */
export interface SystemInfo {
  name: string;
  /** Null for a system the page has no description of. */
  owner: string | null;
  use: string | null;
}

/**
 * The systems the coverage response lists today, as the prototype words them. The page shows
 * whatever coverage returns; a system it does not know here shows its id.
 */
const SYSTEM_INFO: Partial<Record<IntegrationSystem, SystemInfo>> = {
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
    owner: 'Employers (HR systems)',
    use: "Whether a declarant's company supplies their employer",
  },
};

/** How the page names and describes a system of the coverage response. */
export function systemInfo(system: IntegrationSystem): SystemInfo {
  return SYSTEM_INFO[system] ?? { name: system.toUpperCase(), owner: null, use: null };
}

export interface CoverageSummary {
  calls24h: number;
  /** Across systems, weighted by their calls; 0 without calls. */
  cacheHitRate: number;
  /** Open breakers of systems that are not paused (a paused system is expected to be quiet). */
  open: SystemCoverage[];
  halfOpen: SystemCoverage[];
  paused: SystemCoverage[];
}

/** The tiles and alerts above the coverage list. */
export function summarise(rows: readonly SystemCoverage[]): CoverageSummary {
  const calls24h = rows.reduce((sum, row) => sum + row.calls24h, 0);
  const hits = rows.reduce((sum, row) => sum + row.calls24h * row.cacheHitRate, 0);
  return {
    calls24h,
    cacheHitRate: calls24h > 0 ? hits / calls24h : 0,
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
