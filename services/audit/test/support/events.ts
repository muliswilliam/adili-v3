import { randomUUID } from 'node:crypto';

import { AUDIT_READ, type AuditReadData, createEnvelope, type EventEnvelope } from '@adili/events';

/** An `audit.read.v1` of a review case of `tenant`, by a reviewer, about `personId`. */
export function caseRead(
  tenant: string,
  personId: string = randomUUID(),
  actor = 'reviewer-sub',
): EventEnvelope<AuditReadData> {
  const caseId = randomUUID();
  return createEnvelope('adili/review', {
    type: AUDIT_READ,
    tenant,
    data: {
      action: 'review.case.viewed',
      resource: { type: 'review-case', params: { caseId }, tenant, subjectPersonId: personId },
      actor: { subject: actor, clientId: 'console', tenant, roles: ['reviewer'] },
      legalBasis: { basis: 'review-case', reference: caseId },
      outcome: 'success',
      request: { method: 'GET', route: '/v1/review/cases/:caseId' },
    },
  });
}

/** A domain event of `tenant`: the record of a write. */
export function submitted(tenant: string, personId: string = randomUUID()): EventEnvelope {
  const declarationId = randomUUID();
  return createEnvelope('adili/declarations', {
    type: 'declaration.submitted.v1',
    tenant,
    subject: declarationId,
    data: { declarationId, personId, version: 1 },
  });
}

/** A unique tenant key per test, so suites and tests share no chain. */
export function freshTenant(): string {
  return `t${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
