#!/usr/bin/env node
// Meta-validates every First Schedule / Form K / Form M JSON Schema (draft 2020-12), then
// compiles it with the options @adili/forms generates its validators with
// (packages/forms/scripts/generate-validators.ts), so a schema ajv would refuse (an unknown
// keyword, say) fails here first. Fixtures are checked by the @adili/forms tests.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const formsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'forms');
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  validateSchema: true,
});
addFormats(ajv);

// Keep in step with packages/forms/scripts/generate-validators.ts.
const compileOptions = { allErrors: true, strictTypes: false };

const files = readdirSync(formsDir)
  .filter((name) => name.endsWith('.json'))
  .sort();
if (files.length === 0) {
  console.error(`No JSON Schema files in ${formsDir}`);
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const path = join(formsDir, name);
  const schema = JSON.parse(readFileSync(path, 'utf8'));
  if (!ajv.validateSchema(schema)) {
    failed += 1;
    console.error(`fail  ${name}`);
    console.error(ajv.errorsText(ajv.errors, { separator: '\n' }));
    continue;
  }
  try {
    const strict = new Ajv2020(compileOptions);
    addFormats(strict);
    strict.compile(schema);
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail  ${name}: ${error.message}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
