import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

/**
 * Validates bodies against the committed contracts (packages/schemas/internal/directory.yaml, and
 * documents.yaml and notifications.yaml for what the directory sends them), so tests fail when an API drifts
 * from its contract.
 */
type Contract = 'directory' | 'documents' | 'notifications';

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const resolve = createRequire(import.meta.url).resolve;
for (const contract of ['directory', 'documents', 'notifications'] satisfies Contract[]) {
  const path = resolve(`@adili/schemas/internal/${contract}.yaml`);
  ajv.addSchema(parse(readFileSync(path, 'utf8')) as object, `${contract}.yaml`);
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

/**
 * The validation errors of `body` against the schema at `pointer` of `contract` (the directory's
 * by default); empty when it conforms.
 */
export function contractErrors(
  pointer: string,
  body: unknown,
  contract: Contract = 'directory',
): string[] {
  const validate = ajv.compile({ $ref: `${contract}.yaml#${pointer}` });
  if (validate(body)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
}
