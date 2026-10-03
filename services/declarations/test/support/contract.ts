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
  return responseBody(operationPath, method, 200);
}

/**
 * JSON pointer of an operation's response body for a status, e.g. `('/v1/declarations/
 * {declarationId}/submit', 'post', 409)`: the JSON body, or the problem body of an error.
 */
export function responseBody(
  operationPath: string,
  method: 'get' | 'post' | 'put' | 'delete',
  status: number,
): string {
  const escaped = operationPath.replaceAll('~', '~0').replaceAll('/', '~1');
  const mediaType = status >= 400 ? 'application~1problem+json' : 'application~1json';
  return `/paths/${escaped}/${method}/responses/${String(status)}/content/${mediaType}/schema`;
}

/** The validation errors of `body` against the schema at `pointer`; empty when it conforms. */
export function contractErrors(pointer: string, body: unknown): string[] {
  const validate = ajv.getSchema(`declarations.yaml#${pointer}`);
  if (!validate) throw new Error(`No schema at ${pointer}`);
  if (validate(body)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`);
}
