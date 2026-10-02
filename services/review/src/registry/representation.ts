import { z } from 'zod';

import {
  flagSchema,
  type RegistryCheckView,
  registryCheckStatusSchema,
  type RegistrySummary,
  registrySystemSchema,
} from '../cases/representation.js';
import { REGISTRY_SYSTEMS, type RegistryRow, type RegistrySystem } from '../rules/index.js';
import type { registryChecks } from './schema.js';

/**
 * Bodies of the registry API (spec 07b). They are the contract: the OpenAPI document,
 * packages/schemas/internal/review.yaml, is generated from them (`pnpm contracts`).
 */

type CheckRow = typeof registryChecks.$inferSelect;

const registryRowSchema = z.object({
  registryRecord: z.record(z.string(), z.unknown()).meta({
    description:
      "The registry's record as the gateway holds it (parcel, vehicle or directorship; for KRA pinPresent, complianceStatus, validUntil and the income difference as a percentage, never an amount). For not-in-registry, the declared identifier alone.",
  }),
  declaredItemId: z.uuid().nullable(),
  relation: z.enum(['matched', 'not-declared', 'not-in-registry']),
}) satisfies z.ZodType<RegistryRow>;

export const registrySystemViewSchema = z.object({
  system: registrySystemSchema,
  status: registryCheckStatusSchema,
  reason: z.string().nullable(),
  checkedAt: z.iso.datetime().nullable(),
  resultId: z.uuid().nullable(),
  rows: z.array(registryRowSchema).meta({
    description: 'Registry record paired with the declared item it matched, if any',
  }),
  flags: z.array(flagSchema),
});
export type RegistrySystemView = z.infer<typeof registrySystemViewSchema>;

/** review.yaml `RegistryView`: the Registry tab of a case. */
export const registryViewSchema = z.object({
  checkedAt: z.iso.datetime().nullable(),
  persons: z.array(
    z.object({
      personKey: z.string(),
      personName: z.string(),
      hasNationalId: z.boolean(),
      systems: z.array(registrySystemViewSchema),
    }),
  ),
});
export type RegistryView = z.infer<typeof registryViewSchema>;

/**
 * review.yaml `RegistryStatus`: when the case's latest registry check was stored, and nothing
 * else, so a client waiting for a re-check can ask often without an audited read each time.
 */
export const registryStatusSchema = z.object({
  checkedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "When the current version's latest check was stored; null before one" }),
});
export type RegistryStatus = z.infer<typeof registryStatusSchema>;

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
