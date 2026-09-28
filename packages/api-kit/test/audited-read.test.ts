import 'reflect-metadata';

import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditedRead, auditedReadOf, createOpenApiDocument } from '../src/index.js';

@Controller('v1/records')
class RecordsController {
  @Get(':id')
  @AuditedRead({ action: 'record.viewed', resource: 'record' })
  get() {
    return {};
  }

  @Get()
  list() {
    return [];
  }
}

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [RecordsController],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('AuditedRead', () => {
  it('marks the route for the audit interceptor', () => {
    const reflector = app.get(Reflector);
    const handler = (name: 'get' | 'list') =>
      Reflect.get(RecordsController.prototype, name) as object;

    expect(auditedReadOf(reflector, handler('get'))).toEqual({
      action: 'record.viewed',
      resource: 'record',
    });
    expect(auditedReadOf(reflector, handler('list'))).toBeUndefined();
  });

  it('documents the audited read on the operation', () => {
    const document = createOpenApiDocument(app, { name: 'Test', description: 'Test' });

    expect(document.paths['/v1/records/{id}']?.get).toMatchObject({
      'x-audited-read': { action: 'record.viewed', resource: 'record' },
    });
    expect(document.paths['/v1/records']?.get).not.toHaveProperty('x-audited-read');
  });
});
