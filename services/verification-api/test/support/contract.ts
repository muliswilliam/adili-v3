import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * Validates response bodies against the committed contract
 * (packages/schemas/internal/verification-api.yaml), so tests fail when the API drifts from it.
 */
const CONTRACT_ID = 'verification-api.yaml';
const contractPath = createRequire(import.meta.url).resolve(
  '@adili/schemas/internal/verification-api.yaml',
);

const contract = parse(readFileSync(contractPath, 'utf8')) as {
  paths: Record<string, Record<string, Record<string, unknown>>>;
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(contract, CONTRACT_ID);

/** The contract's operation object for a path and method, e.g. to read its extensions. */
export function contractOperation(path: string, method: 'get' | 'post'): Record<string, unknown> {
  const operation = contract.paths[path]?.[method];
  if (!operation) throw new Error(`No operation ${method} ${path} in the contract`);
  return operation;
}

/**
 * JSON pointer of the success response body of an operation, e.g. `('/v1/commissions', 'get')`
 * or `('/v1/commissions', 'post', 201)`.
 */
export function okResponse(path: string, method: 'get' | 'post' | 'put', status = 200): string {
  const escaped = path.replaceAll('~', '~0').replaceAll('/', '~1');
  return `/paths/${escaped}/${method}/responses/${status}/content/application~1json/schema`;
}

export function componentSchema(name: string): string {
  return `/components/schemas/${name}`;
}

/** The validation errors of `body` against the schema at `pointer`; empty when it conforms. */
export function contractErrors(pointer: string, body: unknown): string[] {
  const validate = ajv.compile({ $ref: `${CONTRACT_ID}#${pointer}` });
  if (validate(body)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
}
