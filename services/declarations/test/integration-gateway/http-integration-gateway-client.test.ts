import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { HttpIntegrationGatewayClient } from '../../src/integration-gateway/http-integration-gateway-client.js';
import {
  DECLARANT_REQUEST,
  IntegrationGatewayUnavailable,
  type RegistryLookup,
} from '../../src/integration-gateway/integration-gateway-client.js';
import { ardhisasa, brs, kra, ntsa } from '../fixtures/registry-results.js';

/**
 * The gateway client against answers that conform to the integration-gateway's result schemas
 * (checked here): each registry's lookup with the national ID in the body, acting for the
 * Commission, with the declarant's request as legal basis, the declaration as case reference and
 * the declarant as subject (the routes of #461, spec 07b); anything unexpected is the gateway
 * being unavailable.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve(
  '@adili/schemas/internal/integration-gateway.yaml',
);
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'integration-gateway.yaml');

function conforming(schema: string, body: unknown): unknown {
  const validate = ajv.getSchema(`integration-gateway.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

const DECLARATION_ID = '0192f1a0-5a11-7000-8000-00000000d001';
const DECLARANT_ID = '0192f1a0-5a11-7000-8000-00000000a001';
const NATIONAL_ID = '27451863';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Sent {
  method: string;
  path: string;
  query: string;
  body: unknown;
  headers: Record<string, string | null>;
}

function clientAnswering(respond: (request: Request) => Response) {
  const requests: Sent[] = [];
  const client = new HttpIntegrationGatewayClient({
    gatewayUrl: 'http://gateway.test/',
    tokens: { token: () => Promise.resolve('token'), invalidate: () => undefined },
    fetch: async (input: string | URL | Request) => {
      const request = input as Request;
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: url.pathname,
        query: url.search,
        body: JSON.parse(await request.clone().text()) as unknown,
        headers: {
          tenant: request.headers.get('x-acting-tenant'),
          legalBasis: request.headers.get('x-legal-basis'),
          caseRef: request.headers.get('x-case-ref'),
          subject: request.headers.get('x-subject-person'),
        },
      });
      return respond(request);
    },
  });
  return { client, requests };
}

const lookup = (system: RegistryLookup['system']): RegistryLookup => ({
  system,
  tenant: 'psc',
  nationalId: NATIONAL_ID,
  legalBasis: DECLARANT_REQUEST,
  caseRef: DECLARATION_ID,
  subjectPersonId: DECLARANT_ID,
});

const HEADERS = {
  tenant: 'psc',
  legalBasis: 'declarant-request',
  caseRef: DECLARATION_ID,
  subject: DECLARANT_ID,
};

describe('HttpIntegrationGatewayClient', () => {
  it.each([
    ['kra', 'KraResult', kra.found, '/internal/v1/kra/taxpayer-lookups'],
    ['ntsa', 'NtsaResult', ntsa.found, '/internal/v1/ntsa/vehicle-lookups'],
    ['brs', 'BrsResult', brs.found, '/internal/v1/brs/directorship-lookups'],
    ['ardhisasa', 'ArdhisasaResult', ardhisasa.found, '/internal/v1/ardhisasa/parcel-lookups'],
  ] as const)(
    'looks a person up in %s with the national ID in the body, never the URL',
    async (system, schema, result, path) => {
      const { client, requests } = clientAnswering(() => json(conforming(schema, result)));

      await expect(client.lookup(lookup(system))).resolves.toEqual(result);
      expect(requests).toEqual([
        { method: 'POST', path, query: '', body: { nationalId: NATIONAL_ID }, headers: HEADERS },
      ]);
    },
  );

  it('passes an unavailable registry on as the result it is', async () => {
    const { client } = clientAnswering(() => json(conforming('KraResult', kra.unavailable)));

    await expect(client.lookup(lookup('kra'))).resolves.toMatchObject({
      outcome: 'unavailable',
      reason: 'timeout',
    });
  });

  it('passes a rate-limited registry on as unavailable', async () => {
    const { client } = clientAnswering(() => json({ ...ntsa.unavailable, reason: 'rate-limited' }));

    await expect(client.lookup(lookup('ntsa'))).resolves.toMatchObject({
      outcome: 'unavailable',
    });
  });

  it.each([
    ['a refusal', () => json({ type: 'about:blank', title: 'Bad', status: 400 }, 400)],
    [
      'a lookup it could not record',
      () => json({ type: 'lookup-not-recorded', title: 'Not recorded', status: 503 }, 503),
    ],
    ['a body off contract', () => json({ ...ntsa.found, vehicles: [{ make: 'Toyota' }] })],
    ['another system', () => json(kra.found)],
  ])('treats %s as the gateway being unavailable', async (_, respond) => {
    const { client } = clientAnswering(respond);

    await expect(client.lookup(lookup('ntsa'))).rejects.toBeInstanceOf(
      IntegrationGatewayUnavailable,
    );
  });
});
