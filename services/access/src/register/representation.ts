import type { AccessRegisterKind } from '@adili/events/contracts';
import { z } from 'zod';

import type { RegisterRow } from './access-register.js';

/**
 * The register kinds a timeline shows: every one but `identified` (who resolved the officer
 * named), which the register and its event record but the front ends do not show yet.
 */
export const TIMELINE_KINDS = [
  'received',
  'verified',
  'notified',
  'representations',
  'decided',
  'package-issued',
  'downloaded',
  'expired',
  'withdrawn',
  'cannot-identify',
  'self-access',
] as const satisfies readonly AccessRegisterKind[];
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** A register row of a kind timelines show. */
export type TimelineRow = RegisterRow & { kind: TimelineKind };

export function inTimeline(row: RegisterRow): row is TimelineRow {
  return (TIMELINE_KINDS as readonly string[]).includes(row.kind);
}

/** access.yaml `RegisterEntry`: one step of a request's timeline. */
export const registerEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(TIMELINE_KINDS),
  at: z.iso.datetime({ offset: true }),
  /** Who acted, by name; null for the service's own steps. */
  actor: z.string().nullable(),
  summary: z.string(),
  /** The request's reference (empty for self-access). */
  reference: z.string(),
});

export type RegisterEntry = z.infer<typeof registerEntrySchema>;

/** The plain-language line each step shows in a timeline (front ends may show their own copy). */
const SUMMARIES: Record<TimelineKind, string> = {
  received: 'Request received',
  verified: 'Request verified',
  notified: 'Declarant notified',
  representations: 'Declarant made representations',
  decided: 'Decision taken',
  'package-issued': 'Package issued',
  downloaded: 'Package downloaded',
  expired: 'Download window ended',
  withdrawn: 'Request withdrawn',
  'cannot-identify': 'Officer could not be identified',
  'self-access': 'Certified copy issued',
};

export function toRegisterEntry(row: TimelineRow): RegisterEntry {
  return {
    id: row.id,
    kind: row.kind,
    at: row.at.toISOString(),
    actor: row.actorName ?? null,
    summary: SUMMARIES[row.kind],
    reference: row.reference ?? '',
  };
}
