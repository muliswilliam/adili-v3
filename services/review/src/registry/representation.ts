import type { FlagView, RegistryCheckView, RegistrySummary } from '../cases/representation.js';
import {
  REGISTRY_SYSTEMS,
  type RegistryCheckStatus,
  type RegistryRow,
  type RegistrySystem,
} from '../rules/index.js';
import type { registryChecks } from './schema.js';

type CheckRow = typeof registryChecks.$inferSelect;

/** review.yaml `RegistryView`: the Registry tab of a case. */
export interface RegistryView {
  checkedAt: string | null;
  persons: {
    personKey: string;
    personName: string;
    hasNationalId: boolean;
    systems: RegistrySystemView[];
  }[];
}

export interface RegistrySystemView {
  system: RegistrySystem;
  status: RegistryCheckStatus;
  reason: string | null;
  checkedAt: string | null;
  resultId: string | null;
  rows: RegistryRow[];
  flags: FlagView[];
}

/** People in the order the Registry tab lists them: the officer, then the household by key. */
export function byPersonAndSystem<T extends { personKey: string; system: RegistrySystem }>(
  a: T,
  b: T,
): number {
  const officerFirst = Number(b.personKey === 'officer') - Number(a.personKey === 'officer');
  return (
    officerFirst ||
    a.personKey.localeCompare(b.personKey) ||
    REGISTRY_SYSTEMS.indexOf(a.system) - REGISTRY_SYSTEMS.indexOf(b.system)
  );
}

export function checkView(row: CheckRow): RegistryCheckView {
  return {
    personKey: row.personKey,
    system: row.system,
    status: row.status,
    reason: row.reason,
    checkedAt: row.checkedAt.toISOString(),
    resultId: row.resultId,
  };
}

/** The statuses of a case's latest registry check, as the case detail shows them. */
export function registrySummary(rows: CheckRow[]): RegistrySummary {
  const checks = rows.map(checkView).sort(byPersonAndSystem);
  return { checkedAt: latestCheck(rows), checks };
}

/** When the latest check was stored; null before the first. */
export function latestCheck(rows: CheckRow[]): string | null {
  const latest = Math.max(...rows.map((row) => row.checkedAt.getTime()));
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}
