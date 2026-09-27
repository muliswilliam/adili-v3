#!/usr/bin/env node
// Meta-validates every First Schedule / Form K / Form M JSON Schema (draft 2020-12).
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
  const valid = ajv.validateSchema(schema);
  if (valid) {
    console.log(`ok    ${name}`);
  } else {
    failed += 1;
    console.error(`fail  ${name}`);
    console.error(ajv.errorsText(ajv.errors, { separator: '\n' }));
  }
}

process.exit(failed === 0 ? 0 : 1);
