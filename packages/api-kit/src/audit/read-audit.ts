import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** The resource an audited read served, as the handler knows it once loaded (ADR-008 `resource`). */
export interface AuditedResource {
  /** The tenant whose data was read; the event is filed under it. */
  tenant: string;
  /** The person the data is about, when known (ADR-008 "subject person id"). */
  subjectPersonId?: string | null;
}

/**
 * A read that hands the data to someone under a legal basis, a disclosure (ADR-008
 * `legal_basis`): a scoped disclosure for a Form K or law-enforcement grant, or a declarant's
 * certified copy of their own declaration.
 */
export interface ReadDisclosure {
  /**
   * The provision the disclosure rests on, e.g. `act-s36-1` (Form K), `act-s36-2` (law
   * enforcement), `self-access` (Administrative Mechanism 32).
   */
  legalBasis: string;
  /** The act under it that authorises this read, e.g. the grant's `ARQ` or `LEA` reference; null when none. */
  reference: string | null;
  /** The subject the data read is handed to (the grant's recipient, the declarant). */
  recipient: string;
}

/**
 * What the handler of an `@AuditedRead` route tells the audit trail about the read it served,
 * injected with `@CurrentReadAudit()`. A route whose path names the tenant needs none of it: the
 * event is then filed under the route's `slug`, else the tenant a service acts for, else the
 * caller's. A route that loads the resource by id says whose it is once loaded (`resource`), or
 * that the caller read their own record (`ownRecord`), which is not audited. A read that hands
 * the data to someone on a legal basis says so (`disclosure`).
 */
export class ReadAudit {
  #resource: AuditedResource | undefined;
  #ownRecord = false;
  #disclosure: ReadDisclosure | undefined;

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

  /**
   * The read hands the data to `recipient` on a legal basis (a disclosure): the event names the
   * basis, the reference that authorises it and the recipient.
   */
  disclosure(disclosure: ReadDisclosure): void {
    this.#disclosure = disclosure;
  }

  /** The resource the handler named, if any. */
  get describedResource(): AuditedResource | undefined {
    return this.#resource;
  }

  /** The disclosure the handler named, if any. */
  get describedDisclosure(): ReadDisclosure | undefined {
    return this.#disclosure;
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
