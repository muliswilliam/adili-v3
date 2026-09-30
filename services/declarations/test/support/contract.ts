import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * Validates response bodies against the committed contract (packages/schemas/internal/
 * declarations.yaml), so tests fail when the API drifts from what the portal and console were
 * built against.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const path = createRequire(import.meta.url).resolve('@adili/schemas/internal/declarations.yaml');
ajv.addSchema(parse(readFileSync(path, 'utf8')) as object, 'declarations.yaml');

/** JSON pointer of the 200 response body of an operation, e.g. `('/v1/me/obligations', 'get')`. */
export function okResponse(operationPath: string, method: 'get'): string {
  const escaped = operationPath.replaceAll('~', '~0').replaceAll('/', '~1');
  return `/paths/${escaped}/${method}/responses/200/content/application~1json/schema`;
}

/** The validation errors of `body` against the schema at `pointer`; empty when it conforms. */
export function contractErrors(pointer: string, body: unknown): string[] {
  const validate = ajv.getSchema(`declarations.yaml#${pointer}`);
  if (!validate) throw new Error(`No schema at ${pointer}`);
  if (validate(body)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`);
}
