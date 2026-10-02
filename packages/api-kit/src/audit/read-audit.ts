import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** The resource an audited read served, as the handler knows it once loaded (ADR-008 `resource`). */
export interface AuditedResource {
  /** The tenant whose data was read; the event is filed under it. */
  tenant: string;
  /** The person the data is about, when known (ADR-008 "subject person id"). */
  subjectPersonId?: string | null;
  /**
   * The ids of the resources a batch read served (ADR-008 resource id), e.g. the obligations
   * whose officers a details request returned. A read of one resource names it in its path.
   */
  ids?: readonly string[];
}

/**
 * The bases a read can be made on (ADR-008 `legal_basis`): a provision (`act-s36-1` for Form K,
 * `act-s36-2` for law enforcement, `self-access` for a declarant's access to their own declaration
 * under Administrative Mechanism 32) or the work the read serves (`review-case`). One word per
 * basis across the audit trail: the access register uses the same ones.
 */
export const READ_LEGAL_BASES = ['act-s36-1', 'act-s36-2', 'self-access', 'review-case'] as const;
export type ReadLegalBasisCode = (typeof READ_LEGAL_BASES)[number];

/**
 * Why a read was allowed (ADR-008 `legal_basis`): the basis and the act under it that authorises
 * this read.
 */
export interface ReadLegalBasis {
  basis: ReadLegalBasisCode;
  /**
   * The act under it that authorises this read, e.g. a grant's `ARQ` or `LEA` reference or the
   * review case's id; null when none.
   */
  reference: string | null;
}

/**
 * A read that hands the data to someone under a legal basis, a disclosure: a scoped disclosure
 * for a Form K or law-enforcement grant, or a declarant's certified copy of their own declaration.
 */
export interface ReadDisclosure extends ReadLegalBasis {
  /** The subject the data read is handed to (the grant's recipient, the declarant). */
  recipient: string;
}

/**
 * An event the read itself causes (a download registered for the access register), recorded with
 * the read's audit event in one statement: both are written, or neither. The shape of
 * `@adili/events`' `NewEvent`, which this package does not import.
 */
export interface EventAlongsideRead {
  type: string;
  data: Record<string, unknown>;
  subject?: string;
  tenant?: string;
}

/**
 * What the handler of an `@AuditedRead` route tells the audit trail about the read it served,
 * injected with `@CurrentReadAudit()`. A route whose path names the tenant needs none of it: the
 * event is then filed under the route's `slug`, else the tenant a service acts for, else the
 * caller's. A route that loads the resource by id says whose it is once loaded (`resource`), or
 * that the caller read their own record (`ownRecord`), which is not audited. A read made on a
 * named legal basis says so (`legalBasis`); one that hands the data to someone on a legal basis
 * names the recipient too (`disclosure`). An event the read causes is recorded with its audit
 * event (`alongside`).
 */
export class ReadAudit {
  #resource: AuditedResource | undefined;
  #ownRecord = false;
  #legalBasis: ReadLegalBasis | undefined;
  #recipient: string | undefined;
  readonly #alongside: EventAlongsideRead[] = [];

  /** The resource read: the event is filed under its tenant and names the person it is about. */
  resource(resource: AuditedResource): void {
    this.#resource = resource;
  }

  /**
   * The caller read their own record (a declarant their own obligation): not audited, as a
   * declarant reading their own profile is not (ADR-008 audits reads of someone's sensitive
   * data by others).
   */
  ownRecord(): void {
    this.#ownRecord = true;
  }

  /** The read is made on a legal basis: the event names the basis and the reference under it. */
  legalBasis(legalBasis: ReadLegalBasis): void {
    this.#legalBasis = { basis: legalBasis.basis, reference: legalBasis.reference };
  }

  /**
   * The read hands the data to `recipient` on a legal basis (a disclosure): the event names the
   * basis, the reference that authorises it and the recipient.
   */
  disclosure(disclosure: ReadDisclosure): void {
    this.legalBasis(disclosure);
    this.#recipient = disclosure.recipient;
  }

  /**
   * Records `event` with the audit event, atomically: an event the read causes is then never
   * written without the read's audit, nor the audit without it.
   */
  alongside(event: EventAlongsideRead): void {
    this.#alongside.push(event);
  }

  /** The events the handler asked to record with the audit event. */
  get eventsAlongside(): readonly EventAlongsideRead[] {
    return this.#alongside;
  }

  /** The resource the handler named, if any. */
  get describedResource(): AuditedResource | undefined {
    return this.#resource;
  }

  /** The legal basis the handler named, if any. */
  get describedLegalBasis(): ReadLegalBasis | undefined {
    return this.#legalBasis;
  }

  /** Whom the read hands the data to, when the handler named a disclosure. */
  get describedRecipient(): string | undefined {
    return this.#recipient;
  }

  /** Whether the handler said the caller read their own record. */
  get isOwnRecord(): boolean {
    return this.#ownRecord;
  }
}

const READ_AUDIT = Symbol('READ_AUDIT');

/** The request's `ReadAudit`, created on first use; the interceptor reads it after the handler. */
export function readAuditOf(request: object): ReadAudit {
  const holder = request as { [READ_AUDIT]?: ReadAudit };
  return (holder[READ_AUDIT] ??= new ReadAudit());
}

/**
 * Injects the request's `ReadAudit` into the handler of an `@AuditedRead` route.
 *
 * @example
 * @Get('obligations/:id')
 * @AuditedRead({ action: 'obligation.viewed', resource: 'filing-obligation' })
 * async one(@Param('id') id: string, @CurrentReadAudit() audit: ReadAudit) {
 *   const read = await this.obligations.one(id);
 *   audit.resource({ tenant: read.tenant, subjectPersonId: read.personId });
 *   return read.obligation;
 * }
 */
export const CurrentReadAudit = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ReadAudit =>
    readAuditOf(context.switchToHttp().getRequest<object>()),
);
