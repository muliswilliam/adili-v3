import 'reflect-metadata';

import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuditedRead, CurrentReadAudit, type ReadAudit } from '@adili/api-kit';
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
    else audit.resource({ tenant: 'tsc', subjectPersonId: 'person-1' });
    return { id };
  }
}

/** An internal route: a service reads for the subject and tenant it names. */
@Controller('internal/v1/records')
class InternalRecordsController {
  @Get(':recordId')
  @AuditedRead({ action: 'roster.record.viewed', resource: 'roster-record' })
  get(@Param('recordId') recordId: string) {
    return { id: recordId };
  }
}

const recorded: NewEvent[] = [];
let failing = false;
const publisher = {
  record: (_tx: unknown, event: NewEvent) => {
    if (failing) return Promise.reject(new Error('outbox unavailable'));
    recorded.push(event);
    return Promise.resolve(event);
  },
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [RecordsController, ThingsController, InternalRecordsController],
    providers: [
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

  it('records the subject and tenant a service acts for on an internal route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/v1/records/rec-1',
      headers: { 'x-acting-subject': 'analyst-e', 'x-acting-tenant': 'psc' },
    });

    expect(response.statusCode).toBe(200);
    expect(recorded).toMatchObject([
      {
        tenant: 'psc',
        data: {
          actor: {
            subject: 'anonymous',
            clientId: null,
            tenant: null,
            roles: [],
            onBehalfOf: 'analyst-e',
          },
        },
      },
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

  it('records nothing when the caller read their own record', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/things/mine' });

    expect(response.statusCode).toBe(200);
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
