import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * Validates bodies against the committed contract (packages/schemas/internal/access.yaml), so
 * tests fail when the API drifts from it.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const path = createRequire(import.meta.url).resolve('@adili/schemas/internal/access.yaml');
ajv.addSchema(parse(readFileSync(path, 'utf8')) as object, 'access.yaml');

/** JSON pointer of the success response body of an operation, e.g. `('/v1/access/requests', 'post', 201)`. */
export function okResponse(apiPath: string, method: 'get' | 'post' | 'put', status = 200): string {
  const escaped = apiPath.replaceAll('~', '~0').replaceAll('/', '~1');
  return `/paths/${escaped}/${method}/responses/${String(status)}/content/application~1json/schema`;
}

/** The validation errors of `body` against the schema at `pointer`; empty when it conforms. */
export function contractErrors(pointer: string, body: unknown): string[] {
  const validate = ajv.compile({ $ref: `access.yaml#${pointer}` });
  if (validate(body)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
}
