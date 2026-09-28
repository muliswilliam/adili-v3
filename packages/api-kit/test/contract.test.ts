import type { OpenAPIObject } from '@nestjs/swagger';
import { describe, expect, it } from 'vitest';

import { withDraft } from '../src/contract.js';

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
