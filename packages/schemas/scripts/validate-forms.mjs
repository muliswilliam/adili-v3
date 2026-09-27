#!/usr/bin/env node
// Meta-validates every First Schedule / Form K / Form M JSON Schema (draft 2020-12), then checks
// each form's fixtures in forms/fixtures/<form>/: every valid/*.json must validate, and every
// invalid/*.json ({ description, errors, document }) must fail with exactly the dotted `errors`
// paths, as @adili/forms reports them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const jsonFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .sort()
    : [];

// A missing or unexpected property is reported against the property, not its parent object.
function errorPath(error) {
  const segments = error.instancePath.split('/').slice(1);
  if (error.keyword === 'required') segments.push(error.params.missingProperty);
  if (error.keyword === 'additionalProperties') segments.push(error.params.additionalProperty);
  return segments.map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~')).join('.');
}

let failed = 0;
for (const name of files) {
  const schema = readJson(join(formsDir, name));
  if (!ajv.validateSchema(schema)) {
    failed += 1;
    console.error(`fail  ${name}`);
    console.error(ajv.errorsText(ajv.errors, { separator: '\n' }));
    continue;
  }
  console.log(`ok    ${name}`);

  const fixturesDir = join(formsDir, 'fixtures', name.replace(/\.json$/, ''));
  const validate = ajv.compile(schema);
  for (const fixture of jsonFiles(join(fixturesDir, 'valid'))) {
    const label = `${name} valid/${fixture}`;
    if (validate(readJson(join(fixturesDir, 'valid', fixture)))) {
      console.log(`ok    ${label}`);
    } else {
      failed += 1;
      console.error(`fail  ${label}: ${ajv.errorsText(validate.errors)}`);
    }
  }
  for (const fixture of jsonFiles(join(fixturesDir, 'invalid'))) {
    const label = `${name} invalid/${fixture}`;
    const { errors: expected, document } = readJson(join(fixturesDir, 'invalid', fixture));
    const actual = validate(document) ? [] : validate.errors.map(errorPath);
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      console.log(`ok    ${label}`);
    } else {
      failed += 1;
      console.error(
        `fail  ${label}: expected errors at ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
}

process.exit(failed === 0 ? 0 : 1);
