import { Injectable, Module } from '@nestjs/common';
import { EventPublisher } from '@adili/events';
import {
  ACCESS_CERTIFIED_COPY_ISSUED,
  type AccessLegalBasis,
  type AccessRegisterEventData,
  type AccessRegisterKind,
  type AccessSubjectKind,
} from '@adili/events/contracts';
import { v7 as uuidv7 } from 'uuid';

import type { AccessTransaction } from '../db/database.js';
import { accessRegister } from './schema.js';

export type RegisterRow = typeof accessRegister.$inferSelect;

/** The law each kind of subject rests on (the register's `legal_basis`). */
export const LEGAL_BASIS: Record<AccessSubjectKind, AccessLegalBasis> = {
  'access-request': 'act-s36-1',
  'lea-request': 'act-s36-2',
  'self-access': 'admin-mechanism-32',
};

/** A step to record in the access register. */
export interface RegisterEntryInput {
  /** The Commission whose declarant the step is about. */
  tenant: string;
  subjectKind: AccessSubjectKind;
  subjectId: string;
  /** The request's `ARQ` or `LEA` reference; null for self-access. */
  reference: string | null;
  /** The declarant, once known. */
  personId: string | null;
  kind: AccessRegisterKind;
  /** Who acted (token subject and name); null for the service's own steps. */
  actor: { subject: string; name: string | null } | null;
  at: Date;
  /** Facts for the timeline and who-accessed views; stored, never published. No free text. */
  details?: Record<string, unknown>;
  /**
   * Facts the event carries beyond the entry (outcome, grounds, deadline): identifiers, outcomes
   * and grounds only.
   */
  eventData?: Record<string, unknown>;
}

/**
 * The event type of an entry: `access.request.<kind>.v1`, `lea.request.<kind>.v1`, or
 * `access.certified-copy.issued.v1` for self-access.
 */
export function registerEventType(
  subjectKind: AccessSubjectKind,
  kind: AccessRegisterKind,
): string {
  switch (subjectKind) {
    case 'access-request':
      return `access.request.${kind}.v1`;
    case 'lea-request':
      return `lea.request.${kind}.v1`;
    case 'self-access':
      return ACCESS_CERTIFIED_COPY_ISSUED;
  }
}

/**
 * The access register (ADR-008): every step of every request is an append-only entry and an
 * event, written in the caller's transaction, so the state change, its entry and its event commit
 * together or not at all. The transaction must run in the Commission's context (`app.tenant`).
 */
@Injectable()
export class AccessRegister {
  constructor(private readonly events: EventPublisher) {}

  async record(tx: AccessTransaction, entry: RegisterEntryInput): Promise<RegisterRow> {
    const legalBasis = LEGAL_BASIS[entry.subjectKind];
    const [row] = await tx
      .insert(accessRegister)
      .values({
        id: uuidv7(),
        tenant: entry.tenant,
        subjectKind: entry.subjectKind,
        subjectId: entry.subjectId,
        reference: entry.reference,
        personId: entry.personId,
        kind: entry.kind,
        actor: entry.actor?.subject ?? null,
        actorName: entry.actor?.name ?? null,
        legalBasis,
        at: entry.at,
        details: entry.details ?? {},
      })
      .returning();
    if (!row) throw new Error('The register entry was not written');
    const data: AccessRegisterEventData = {
      ...entry.eventData,
      registerEntryId: row.id,
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      reference: row.reference,
      tenant: row.tenant,
      kind: row.kind,
      legalBasis,
      personId: row.personId,
      actor: row.actor,
      at: row.at.toISOString(),
    };
    await this.events.record(tx, {
      type: registerEventType(entry.subjectKind, entry.kind),
      subject: entry.subjectId,
      tenant: entry.tenant,
      data,
    });
    return row;
  }
}

/** `AccessRegister` for the modules that record steps. */
@Module({ providers: [AccessRegister], exports: [AccessRegister] })
export class RegisterModule {}
