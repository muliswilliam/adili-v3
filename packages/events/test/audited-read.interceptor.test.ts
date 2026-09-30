import 'reflect-metadata';

import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuditedRead } from '@adili/api-kit';
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
    controllers: [RecordsController],
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
          resource: { type: 'roster-record', params: { slug: 'psc', recordId: 'rec-1' } },
          actor: { subject: 'anonymous', clientId: null, tenant: null, roles: [] },
          outcome: 'success',
          request: { method: 'GET', route: '/v1/commissions/:slug/records/:recordId' },
        },
      },
    ]);
  });

  it('records the subject a service acts for as the actor onBehalfOf', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/commissions/psc/records/rec-1',
      headers: { 'x-acting-subject': 'analyst-e' },
    });

    expect(response.statusCode).toBe(200);
    expect(recorded.map((event) => (event.data as { actor: unknown }).actor)).toEqual([
      { subject: 'anonymous', clientId: null, tenant: null, roles: [], onBehalfOf: 'analyst-e' },
    ]);
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
