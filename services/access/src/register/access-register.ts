import { Injectable, Module } from '@nestjs/common';
import { EventPublisher } from '@adili/events';
import {
  ACCESS_CERTIFIED_COPY_ISSUED,
  ACCESS_REQUEST_EVENTS,
  type AccessCertifiedCopyIssuedData,
  type AccessEventType,
  type AccessLegalBasis,
  type AccessPackageDownloadedData,
  type AccessPackageExpiredData,
  type AccessPackageIssuedData,
  type AccessRegisterEventData,
  type AccessRequestCannotIdentifyData,
  type AccessRequestDecidedData,
  type AccessRequestEventKind,
  type AccessRequestNotifiedData,
  type AccessRequestReceivedData,
  type AccessSubjectKind,
  LEA_REQUEST_EVENTS,
  type LeaRequestEventKind,
} from '@adili/events/contracts';
import { v7 as uuidv7 } from 'uuid';

import type { AccessTransaction } from '../db/database.js';
import { accessRegister } from './schema.js';

export type RegisterRow = typeof accessRegister.$inferSelect;

/** The law each kind of subject rests on (the register's `legal_basis`). */
export const LEGAL_BASIS: Record<AccessSubjectKind, AccessLegalBasis> = {
  'access-request': 'act-s36-1',
  'lea-request': 'act-s36-2',
  'self-access': 'self-access',
};

/** `T`'s declared properties, without the index signature event data have. */
type Declared<T> = { [K in keyof T as string extends K ? never : K]: T[K] };

/** What an event carries beyond the register entry it reports. */
type Extra<T extends AccessRegisterEventData> = Omit<
  Declared<T>,
  keyof Declared<AccessRegisterEventData>
>;

/**
 * The facts each kind of step's event carries beyond the entry (packages/events access
 * contracts), per kind of subject: identifiers, outcomes, grounds and deadlines only. A kind not
 * listed carries the entry alone.
 */
interface EventExtras {
  'access-request': {
    received: Extra<AccessRequestReceivedData>;
    notified: Extra<AccessRequestNotifiedData>;
    decided: Extra<AccessRequestDecidedData>;
    'package-issued': Extra<AccessPackageIssuedData>;
    downloaded: Extra<AccessPackageDownloadedData>;
    expired: Extra<AccessPackageExpiredData>;
    'cannot-identify': Extra<AccessRequestCannotIdentifyData>;
  };
  'lea-request': {
    received: Extra<AccessRequestReceivedData>;
    decided: Extra<AccessRequestDecidedData>;
    'package-issued': Extra<AccessPackageIssuedData>;
    downloaded: Extra<AccessPackageDownloadedData>;
    expired: Extra<AccessPackageExpiredData>;
  };
  'self-access': { 'self-access': Extra<AccessCertifiedCopyIssuedData> };
}

/** The steps each kind of subject records. */
interface StepKinds {
  'access-request': AccessRequestEventKind;
  'lea-request': LeaRequestEventKind;
  'self-access': 'self-access';
}

/** A step a kind of subject records: a Form K request is never `self-access`, say. */
export type RegisterStep = {
  [S in AccessSubjectKind]: { subjectKind: S; kind: StepKinds[S] };
}[AccessSubjectKind];

/** What every register entry records, whatever its step. */
export interface RegisterEntryBase {
  /** The Commission whose declarant the step is about. */
  tenant: string;
  subjectId: string;
  /** The request's `ARQ` or `LEA` reference; null for self-access. */
  reference: string | null;
  /** The declarant, once known. */
  personId: string | null;
  /** Who acted (token subject and name); null for the service's own steps. */
  actor: { subject: string; name: string | null } | null;
  at: Date;
  /** Facts for the timeline and who-accessed views; stored, never published. No free text. */
  details?: Record<string, unknown>;
}

type ExtrasOf<S extends AccessSubjectKind, K> = K extends keyof EventExtras[S]
  ? EventExtras[S][K]
  : undefined;

/** One step of subject kind `S`: its event carries exactly the facts its kind declares. */
type RegisterEntryOf<S extends AccessSubjectKind, K extends StepKinds[S]> = RegisterEntryBase & {
  subjectKind: S;
  kind: K;
} & (ExtrasOf<S, K> extends undefined ? { eventData?: never } : { eventData: ExtrasOf<S, K> });

/** A step to record in the access register: a kind its subject records, with its event's facts. */
export type RegisterEntryInput = {
  [S in AccessSubjectKind]: { [K in StepKinds[S]]: RegisterEntryOf<S, K> }[StepKinds[S]];
}[AccessSubjectKind];

/**
 * The event type of an entry (packages/events access contracts): `access.request.<kind>.v1`,
 * `lea.request.<kind>.v1`, or `access.certified-copy.issued.v1` for self-access.
 */
export function registerEventType(step: RegisterStep): AccessEventType {
  switch (step.subjectKind) {
    case 'access-request':
      return ACCESS_REQUEST_EVENTS[step.kind];
    case 'lea-request':
      return LEA_REQUEST_EVENTS[step.kind];
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
      type: registerEventType(entry),
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
