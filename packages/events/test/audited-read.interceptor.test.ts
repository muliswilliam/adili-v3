import 'reflect-metadata';

import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  AuditedRead,
  type AuthenticatedRequest,
  CurrentReadAudit,
  InternalApi,
  type Principal,
  type ReadAudit,
} from '@adili/api-kit';
import { DATABASE } from '@adili/data-access';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_READ, AuditedReadInterceptor } from '../src/audited-read.interceptor.js';
import type { NewEvent } from '../src/envelope.js';
import { EventPublisher } from '../src/event-publisher.js';

@Controller('v1/commissions/:slug/records')
class RecordsController {
  @Get(':recordId')
  @AuditedRead({ action: 'roster.record.viewed', resource: 'roster-record' })
  get(@Param('recordId') recordId: string) {
    if (recordId === 'missing') throw new NotFoundException();
    return { id: recordId };
  }

  @Get()
  list() {
    return [];
  }
}

/** A resource loaded by id: the handler says whose it is once loaded. */
@Controller('v1/things')
class ThingsController {
  @Get(':id')
  @AuditedRead({ action: 'thing.viewed', resource: 'thing' })
  get(@Param('id') id: string, @CurrentReadAudit() audit: ReadAudit) {
    if (id === 'mine') audit.ownRecord();
    else if (id === 'for-a-case') {
      audit.resource({ tenant: 'tsc', subjectPersonId: 'person-1' });
      audit.legalBasis({ basis: 'review-case', reference: 'case-1' });
    } else if (id === 'a-batch') audit.resource({ tenant: 'tsc', ids: ['thing-2', 'thing-3'] });
    else if (id === 'downloaded') {
      audit.resource({ tenant: 'tsc', subjectPersonId: 'person-1' });
      audit.alongside({ type: 'thing.downloaded.v1', subject: id, tenant: 'tsc', data: { id } });
    } else if (id === 'mine-downloaded') {
      audit.ownRecord();
      audit.alongside({ type: 'thing.downloaded.v1', subject: id, tenant: 'tsc', data: { id } });
    } else audit.resource({ tenant: 'tsc', subjectPersonId: 'person-1' });
    return { id };
  }
}

/** An internal route: a service reads for the subject and tenant it names. */
@Controller('internal/v1/records')
@InternalApi('records:internal')
class InternalRecordsController {
  @Get(':recordId')
  @AuditedRead({ action: 'roster.record.viewed', resource: 'roster-record' })
  get(@Param('recordId') recordId: string) {
    return { id: recordId };
  }

  @Get(':recordId/disclosure')
  @AuditedRead({ action: 'roster.record.disclosed', resource: 'roster-record' })
  disclose(@Param('recordId') recordId: string, @CurrentReadAudit() audit: ReadAudit) {
    audit.resource({ tenant: 'psc', subjectPersonId: 'person-1' });
    audit.disclosure({
      basis: 'act-s36-1',
      reference: 'ARQ-PSC-2028-0000012-N',
      recipient: 'applicant-7',
    });
    return { id: recordId };
  }
}

/** Under `/internal/` but without InternalApi(): nothing admitted the acting headers. */
@Controller('internal/v1/unguarded')
class UnguardedInternalController {
  @Get(':recordId')
  @AuditedRead({ action: 'roster.record.viewed', resource: 'roster-record' })
  get(@Param('recordId') recordId: string) {
    return { id: recordId };
  }
}

/** The records service's client credentials token. */
const SERVICE: Principal = {
  subject: 'service-account-records',
  tenant: null,
  roles: [],
  scopes: ['records:internal'],
  clientId: 'records',
  name: null,
  issuedAt: null,
  personId: null,
  acr: null,
  authTime: null,
  tokenId: null,
};

/** Stands in for the JWT guard: `authorization: service` is the service token, else anonymous. */
@Injectable()
class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.headers.authorization === 'service') request.principal = SERVICE;
    return true;
  }
}

const recorded: NewEvent[] = [];
/** The events of each outbox insert: one insert is written whole or not at all. */
const inserts: NewEvent[][] = [];
let failing = false;
const publisher = {
  recordAll: (_tx: unknown, events: readonly NewEvent[]) => {
    if (failing) return Promise.reject(new Error('outbox unavailable'));
    if (events.length > 0) inserts.push([...events]);
    recorded.push(...events);
    return Promise.resolve(events);
  },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      RecordsController,
      ThingsController,
      InternalRecordsController,
      UnguardedInternalController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: EventPublisher, useValue: publisher },
      { provide: DATABASE, useValue: {} },
      { provide: APP_INTERCEPTOR, useClass: AuditedReadInterceptor },
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  recorded.length = 0;
  inserts.length = 0;
  failing = false;
});

describe('AuditedReadInterceptor', () => {
  it('records a successful audited read with its action, resource and route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/commissions/psc/records/rec-1?search=12345678',
    });

    expect(response.statusCode).toBe(200);
    expect(recorded).toEqual([
      {
        type: AUDIT_READ,
        tenant: 'psc',
        data: {
          action: 'roster.record.viewed',
          // Path parameters only: the query may hold a search for a national ID.
          resource: {
            type: 'roster-record',
            params: { slug: 'psc', recordId: 'rec-1' },
            tenant: 'psc',
            subjectPersonId: null,
          },
          actor: { subject: 'anonymous', clientId: null, tenant: null, roles: [] },
          outcome: 'success',
          request: { method: 'GET', route: '/v1/commissions/:slug/records/:recordId' },
        },
      },
    ]);
  });

  it('records the subject and tenant a service acts for once InternalApi() admitted it', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/v1/records/rec-1',
      headers: {
        authorization: 'service',
        'x-acting-subject': 'analyst-e',
        'x-acting-tenant': 'psc',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(recorded).toMatchObject([
      {
        tenant: 'psc',
        data: {
          resource: { tenant: 'psc' },
          actor: {
            subject: 'service-account-records',
            clientId: 'records',
            tenant: null,
            roles: [],
            onBehalfOf: 'analyst-e',
          },
        },
      },
    ]);
  });

  it('names the legal basis, the reference and the recipient of a disclosure', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/v1/records/rec-1/disclosure',
      headers: {
        authorization: 'service',
        'x-acting-subject': 'access-officer-3',
        'x-acting-tenant': 'psc',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(recorded).toMatchObject([
      {
        type: AUDIT_READ,
        tenant: 'psc',
        data: {
          action: 'roster.record.disclosed',
          resource: { subjectPersonId: 'person-1' },
          actor: { subject: 'service-account-records', onBehalfOf: 'access-officer-3' },
          legalBasis: { basis: 'act-s36-1', reference: 'ARQ-PSC-2028-0000012-N' },
          recipient: 'applicant-7',
        },
      },
    ]);
  });

  it('ignores the acting headers on an internal path nothing admitted them on', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/v1/unguarded/rec-1',
      headers: {
        authorization: 'service',
        'x-acting-subject': 'someone-else',
        'x-acting-tenant': 'psc',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(recorded).toEqual([
      expect.objectContaining({
        tenant: undefined,
        data: expect.objectContaining({
          resource: expect.objectContaining({ tenant: null }) as unknown,
          actor: {
            subject: 'service-account-records',
            clientId: 'records',
            tenant: null,
            roles: [],
          },
        }) as unknown,
      }),
    ]);
  });

  it('ignores the acting headers on any other route: a caller cannot name whom it acts for', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/things/thing-2',
      headers: { 'x-acting-subject': 'someone-else', 'x-acting-tenant': 'psc' },
    });
    await app.inject({
      method: 'GET',
      url: '/v1/commissions/psc/records/rec-1',
      headers: { 'x-acting-subject': 'someone-else' },
    });

    expect(response.statusCode).toBe(200);
    expect(recorded.map((event) => (event.data as { actor: object }).actor)).toEqual([
      { subject: 'anonymous', clientId: null, tenant: null, roles: [] },
      { subject: 'anonymous', clientId: null, tenant: null, roles: [] },
    ]);
  });

  it('files the read under the tenant and person the handler names', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/things/thing-1' });

    expect(response.statusCode).toBe(200);
    expect(recorded).toMatchObject([
      {
        type: AUDIT_READ,
        tenant: 'tsc',
        data: {
          action: 'thing.viewed',
          resource: {
            type: 'thing',
            params: { id: 'thing-1' },
            tenant: 'tsc',
            subjectPersonId: 'person-1',
          },
        },
      },
    ]);
  });

  it('records the legal basis the handler names, and none when it names none', async () => {
    await app.inject({ method: 'GET', url: '/v1/things/for-a-case' });
    await app.inject({ method: 'GET', url: '/v1/things/thing-1' });

    expect(
      recorded.map((event) => {
        const data = event.data as { legalBasis?: unknown; recipient?: unknown };
        return { legalBasis: data.legalBasis, recipient: data.recipient };
      }),
    ).toEqual([
      { legalBasis: { basis: 'review-case', reference: 'case-1' }, recipient: undefined },
      { legalBasis: undefined, recipient: undefined },
    ]);
  });

  it('records the ids of a batch read the handler names, and none when it names none', async () => {
    await app.inject({ method: 'GET', url: '/v1/things/a-batch' });
    await app.inject({ method: 'GET', url: '/v1/things/thing-1' });

    expect(
      recorded.map((event) => (event.data as { resource: { ids?: string[] } }).resource.ids),
    ).toEqual([['thing-2', 'thing-3'], undefined]);
  });

  it('records nothing when the caller read their own record', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/things/mine' });

    expect(response.statusCode).toBe(200);
    expect(recorded).toEqual([]);
  });

  it('records the events the read causes with its audit event, in one insert', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/things/downloaded' });

    expect(response.statusCode).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.map((event) => event.type)).toEqual([AUDIT_READ, 'thing.downloaded.v1']);
    expect(inserts[0]?.[1]).toEqual({
      type: 'thing.downloaded.v1',
      subject: 'downloaded',
      tenant: 'tsc',
      data: { id: 'downloaded' },
    });
  });

  it('records the events a read of their own record causes, without an audit event', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/things/mine-downloaded' });

    expect(response.statusCode).toBe(200);
    expect(recorded.map((event) => event.type)).toEqual(['thing.downloaded.v1']);
  });

  it('fails the read, recording neither, when the audit trail cannot record it', async () => {
    failing = true;

    const response = await app.inject({ method: 'GET', url: '/v1/things/downloaded' });

    expect(response.statusCode).toBe(500);
    expect(recorded).toEqual([]);
  });

  it('records nothing for routes without the mark, or reads that failed', async () => {
    await app.inject({ method: 'GET', url: '/v1/commissions/psc/records' });
    const missing = await app.inject({ method: 'GET', url: '/v1/commissions/psc/records/missing' });

    expect(missing.statusCode).toBe(404);
    expect(recorded).toEqual([]);
  });

  it('fails the read when the audit trail cannot record it', async () => {
    failing = true;

    const response = await app.inject({ method: 'GET', url: '/v1/commissions/psc/records/rec-1' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('rec-1');
  });
});
