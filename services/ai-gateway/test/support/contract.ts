import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * Validates bodies against the committed contract (packages/schemas/internal/ai-gateway.yaml),
 * so tests fail when the API drifts from it.
 */
const CONTRACT_ID = 'ai-gateway.yaml';
const contractPath = createRequire(import.meta.url).resolve(
  '@adili/schemas/internal/ai-gateway.yaml',
);

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(parse(readFileSync(contractPath, 'utf8')) as object, CONTRACT_ID);

/** The validation errors of `body` against a component schema; empty when it conforms. */
export function contractErrors(component: string, body: unknown): string[] {
  const validate = ajv.compile({ $ref: `${CONTRACT_ID}#/components/schemas/${component}` });
  if (validate(body)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
}
