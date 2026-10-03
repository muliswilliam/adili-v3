import 'reflect-metadata';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Controller, Headers, HttpCode, Module, Post } from '@nestjs/common';
import { ApiHeader, type OpenAPIObject } from '@nestjs/swagger';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exportContract, withDraft } from '../src/contract.js';

const implemented: OpenAPIObject = {
  openapi: '3.1.0',
  info: { title: 'directory API', version: '1' },
  paths: {
    '/v1/commissions': {
      get: { operationId: 'listCommissions', responses: { '200': { description: 'Page' } } },
    },
  },
  components: { schemas: { Commission: { type: 'object' } } },
};

describe('withDraft', () => {
  it('adds drafted operations marked x-draft, next to the implemented ones', () => {
    const document = withDraft(implemented, {
      paths: {
        '/v1/commissions': {
          post: { operationId: 'createCommission', responses: { '201': { description: 'Made' } } },
        },
        '/v1/roster/template': {
          parameters: [{ name: 'format', in: 'query' }],
          get: { operationId: 'getRosterTemplate', responses: { '200': { description: 'File' } } },
        },
      },
      components: {
        schemas: { RosterImport: { type: 'object' } },
        responses: { NotFound: { description: 'Not found' } },
      },
    });

    expect(document.paths['/v1/commissions']).toEqual({
      get: implemented.paths['/v1/commissions']?.get,
      post: {
        operationId: 'createCommission',
        'x-draft': true,
        responses: { '201': { description: 'Made' } },
      },
    });
    expect(document.paths['/v1/roster/template']).toMatchObject({
      parameters: [{ name: 'format', in: 'query' }],
      get: { operationId: 'getRosterTemplate', 'x-draft': true },
    });
    expect(document.components).toEqual({
      schemas: { Commission: { type: 'object' }, RosterImport: { type: 'object' } },
      responses: { NotFound: { description: 'Not found' } },
    });
  });

  it('refuses a draft of an implemented operation or component', () => {
    expect(() =>
      withDraft(implemented, {
        paths: {
          '/v1/commissions': {
            get: { operationId: 'listCommissions', responses: {} },
            parameters: [{ name: 'search', in: 'query' }],
          },
        },
        components: { schemas: { Commission: { type: 'string' } } },
      }),
    ).toThrow(
      /paths\.\/v1\/commissions\.get\n {2}paths\.\/v1\/commissions\.parameters .*\n {2}components\.schemas\.Commission/,
    );
  });
});

@Controller('v1/closures')
class HeaderTwiceController {
  @Post()
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  approve(@Headers('idempotency-key') key: string) {
    return { key };
  }
}

@Module({ controllers: [HeaderTwiceController] })
class HeaderTwiceModule {}

@Controller('v1/closures')
class HeaderOnceController {
  @Post()
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  approve() {
    return {};
  }
}

@Module({ controllers: [HeaderOnceController] })
class HeaderOnceModule {}

describe('exportContract', () => {
  let scratch = '';
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'api-kit-contract-'));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('refuses an operation that documents one header twice, whatever its case', async () => {
    // As `@Headers('idempotency-key')` next to `@RequireIdempotencyKey()` did on review's
    // `approveBulkClosures`: every generated client then had to send the header twice.
    await expect(
      exportContract(HeaderTwiceModule, {
        name: 'test',
        description: 'test',
        outputFile: join(scratch, 'twice.yaml'),
      }),
    ).rejects.toThrow(/POST \/v1\/closures: header idempotency-key, Idempotency-Key/);
  });

  it('exports an operation that documents each header once', async () => {
    await expect(
      exportContract(HeaderOnceModule, {
        name: 'test',
        description: 'test',
        outputFile: join(scratch, 'once.yaml'),
      }),
    ).resolves.toBeUndefined();
  });
});
