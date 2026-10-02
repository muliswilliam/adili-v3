import { ACCESS_REGISTER_KINDS } from '@adili/events/contracts';
import { z } from 'zod';

import type { RegisterRow } from './access-register.js';

/** The register kinds a timeline shows: every one the register records. */
export const TIMELINE_KINDS = ACCESS_REGISTER_KINDS;
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
  identified: 'Officer identified',
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
