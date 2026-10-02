import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** The resource an audited read served, as the handler knows it once loaded (ADR-008 `resource`). */
export interface AuditedResource {
  /** The tenant whose data was read; the event is filed under it. */
  tenant: string;
  /** The person the data is about, when known (ADR-008 "subject person id"). */
  subjectPersonId?: string | null;
  /**
   * Why the data is read, when the caller names it (ADR-008 `legal_basis`), e.g.
   * `review-case:<id>` for a declaration read for a review case.
   */
  legalBasis?: string;
  /**
   * The ids of the resources a batch read served (ADR-008 resource id), e.g. the obligations
   * whose officers a details request returned. A read of one resource names it in its path.
   */
  ids?: readonly string[];
}

/**
 * What the handler of an `@AuditedRead` route tells the audit trail about the read it served,
 * injected with `@CurrentReadAudit()`. A route whose path names the tenant needs none of it: the
 * event is then filed under the route's `slug`, else the tenant a service acts for, else the
 * caller's. A route that loads the resource by id says whose it is once loaded (`resource`), or
 * that the caller read their own record (`ownRecord`), which is not audited.
 */
export class ReadAudit {
  #resource: AuditedResource | undefined;
  #ownRecord = false;

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

  /** The resource the handler named, if any. */
  get describedResource(): AuditedResource | undefined {
    return this.#resource;
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
