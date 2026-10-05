import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * Validates response bodies against the committed contract (packages/schemas/internal/audit.yaml),
 * so tests fail when the API drifts from it.
 */
const CONTRACT_ID = 'audit.yaml';
const contractPath = createRequire(import.meta.url).resolve('@adili/schemas/internal/audit.yaml');

const contract = parse(readFileSync(contractPath, 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(contract, CONTRACT_ID);

/** JSON pointer of the success response body of an operation. */
export function okResponse(path: string, method: 'get', status = 200): string {
  const escaped = path.replaceAll('~', '~0').replaceAll('/', '~1');
  return `/paths/${escaped}/${method}/responses/${String(status)}/content/application~1json/schema`;
}

/** The validation errors of `body` against the schema at `pointer`; empty when it conforms. */
export function contractErrors(pointer: string, body: unknown): string[] {
  const validate = ajv.compile({ $ref: `${CONTRACT_ID}#${pointer}` });
  if (validate(body)) return [];
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || '/'} ${error.message ?? ''}`,
  );
}
