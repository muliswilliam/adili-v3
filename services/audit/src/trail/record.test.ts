import { AUDIT_READ, type AuditReadData, createEnvelope } from '@adili/events';
import {
  AUDIT_DEMO_SWITCH,
  type DemoSwitchData,
  VERIFICATION_AUDITED,
  type VerificationAuditedData,
} from '@adili/events/contracts';
import { describe, expect, it } from 'vitest';

import { actionOf, recordOf } from './record.js';

const PERSON = '0192f1c4-0000-7000-8000-00000000aaaa';

describe('recordOf', () => {
  it('files a read under the tenant read, with its actor, basis and route', () => {
    const data: AuditReadData = {
      action: 'review.case.viewed',
      resource: {
        type: 'review-case',
        params: { caseId: 'case-1' },
        tenant: 'psc',
        subjectPersonId: PERSON,
      },
      actor: {
        subject: 'reviewer-sub',
        clientId: 'console',
        tenant: 'psc',
        roles: ['reviewer'],
      },
      legalBasis: { basis: 'review-case', reference: 'case-1' },
      outcome: 'success',
      request: { method: 'GET', route: '/v1/review/cases/:caseId' },
    };
    const record = recordOf(
      createEnvelope('adili/review', { type: AUDIT_READ, tenant: 'psc', data }),
    );
    expect(record).toMatchObject({
      tenant: 'psc',
      kind: 'read',
      action: 'review.case.viewed',
      actorType: 'user',
      actorId: 'reviewer-sub',
      actorClientId: 'console',
      actorRoles: ['reviewer'],
      resourceType: 'review-case',
      resourceId: 'case-1',
      subjectPersonId: PERSON,
      legalBasis: 'review-case',
      legalReference: 'case-1',
      requestRoute: '/v1/review/cases/:caseId',
    });
  });

  it('names the ids a batch read served, and a service token as a service', () => {
    const record = recordOf(
      createEnvelope('adili/declarations', {
        type: AUDIT_READ,
        tenant: 'psc',
        data: {
          action: 'obligations.officers.read',
          resource: {
            type: 'obligation',
            params: {},
            tenant: 'psc',
            subjectPersonId: null,
            ids: ['o1', 'o2'],
          },
          actor: { subject: 'svc', clientId: 'review', tenant: null, roles: [] },
          outcome: 'success',
          request: { method: 'POST', route: '/internal/v1/obligations/officers' },
        } satisfies AuditReadData,
      }),
    );
    expect(record).toMatchObject({ actorType: 'service', resourceId: 'o1,o2' });
  });

  it('files a verify lookup as anonymous, by its coarse network only', () => {
    const data: VerificationAuditedData = {
      verificationId: 'ADL-7Q4K',
      outcome: 'valid',
      origin: { network: '203.0.113.0/24' },
    };
    const record = recordOf(
      createEnvelope('adili/verification-api', {
        type: VERIFICATION_AUDITED,
        tenant: 'platform',
        data,
      }),
    );
    expect(record).toMatchObject({
      tenant: 'platform',
      kind: 'verification',
      action: 'document.verified',
      actorType: 'anonymous',
      actorId: '203.0.113.0/24',
      resourceId: 'ADL-7Q4K',
    });
  });

  it('files a demo switch under the platform, from one account to another', () => {
    const data: DemoSwitchData = {
      app: 'console',
      from: { username: 'reviewer', subject: 'sub-1', tenant: 'psc', roles: ['reviewer'] },
      to: { username: 'supervisor', subject: null, tenant: null, roles: [] },
      outcome: 'success',
    };
    const record = recordOf(createEnvelope('adili/console', { type: AUDIT_DEMO_SWITCH, data }));
    expect(record).toMatchObject({
      tenant: 'platform',
      kind: 'auth',
      action: 'demo.account-switched',
      actorId: 'sub-1',
      actorClientId: 'console',
      resourceType: 'account',
      resourceId: 'supervisor',
    });
  });

  it('files any other event as the write it records, by its producing service', () => {
    const record = recordOf(
      createEnvelope('adili/access', {
        type: 'access.request.decided.v1',
        tenant: 'psc',
        subject: 'req-1',
        data: { personId: PERSON, outcome: 'grant' },
      }),
    );
    expect(record).toMatchObject({
      tenant: 'psc',
      kind: 'write',
      action: 'access.request.decided',
      actorType: 'service',
      actorId: 'adili/access',
      resourceType: 'access',
      resourceId: 'req-1',
      subjectPersonId: PERSON,
    });
  });

  it('files an event without a tenant under the platform', () => {
    expect(
      recordOf(createEnvelope('adili/directory', { type: 'commission.created.v1', data: {} }))
        .tenant,
    ).toBe('platform');
  });
});

describe('actionOf', () => {
  it('drops the version', () => {
    expect(actionOf('declaration.submitted.v1')).toBe('declaration.submitted');
    expect(actionOf('review.copilot.updated.v12')).toBe('review.copilot.updated');
  });
});
