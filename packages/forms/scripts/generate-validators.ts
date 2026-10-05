#!/usr/bin/env node
// Writes src/<form>.validate.gen.ts: each prescribed form's ajv validators as standalone code
// (ajv/dist/standalone), generated here instead of at module load. ajv compiles a schema with
// `new Function`, which the apps' CSP (no 'unsafe-eval') forbids, and the apps' pages import
// these validators. Build runs it after generate-types.ts; CI fails when the committed copy is
// stale. The ajv options are those packages/schemas/scripts/validate-forms.mjs compiles with.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _, type AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import ucs2length from 'ajv/dist/runtime/ucs2length.js';
// CommonJS, with its function also exported as `default`, as ajv-formats.
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';
import { format, resolveConfig } from 'prettier';

import { FIXED_SECTION_FIELDS, type FixedSectionKey } from '../src/declaration-section-fields.ts';

type Schema = Record<string, unknown>;

const require = createRequire(import.meta.url);
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const style = (await resolveConfig(join(srcDir, 'index.ts'))) ?? {};

const readSchema = (file: string) =>
  JSON.parse(readFileSync(require.resolve(`@adili/schemas/forms/${file}.json`), 'utf8')) as Schema;

/**
 * One validator per capture section of declaration.v1, so a draft's section can be checked on its
 * own when it is saved. Each refers into the root schema, by its $id, so the sections share the
 * root's code for the parts they have in common.
 */
function declarationValidators(schema: Schema): Record<string, AnySchema> {
  const at = (pointer: string) => ({ $ref: `${String(schema.$id)}#${pointer}` });
  const fixed = (key: FixedSectionKey): AnySchema => {
    const { fields, keepsFieldName } = FIXED_SECTION_FIELDS[key];
    return keepsFieldName
      ? {
          type: 'object',
          required: fields,
          additionalProperties: false,
          properties: Object.fromEntries(
            fields.map((field) => [field, at(`/properties/${field}`)]),
          ),
        }
      : at(`/properties/${fields[0]}`);
  };
  return {
    declaration: schema,
    bioSection: fixed('bio'),
    householdSection: fixed('household'),
    otherSection: fixed('other'),
    statementSection: at('/$defs/Statement'),
  };
}

const FORMS: { file: string; validators: (schema: Schema) => Record<string, AnySchema> }[] = [
  { file: 'declaration.v1', validators: declarationValidators },
  { file: 'form-k.v1', validators: (schema) => ({ formK: schema }) },
  { file: 'form-m.v1', validators: (schema) => ({ formM: schema }) },
];

// ajv's code refers to its runtime helpers and the formats with require(); the module imports
// the formats instead and carries the one helper it uses.
const UCS2LENGTH = 'require("ajv/dist/runtime/ucs2length").default';

for (const { file, validators } of FORMS) {
  // Strict (an unknown keyword throws), but untyped keywords are allowed as in declaration.v1.
  const ajv = new Ajv2020({
    allErrors: true,
    strictTypes: false,
    code: { source: true, esm: true, formats: _`fullFormats` },
  });
  // ajv-formats is CommonJS; its function is also exported as `default`.
  addFormats.default(ajv);
  const exports: Record<string, string> = {};
  for (const [name, schema] of Object.entries(validators(readSchema(file)))) {
    ajv.addSchema(schema, name);
    exports[name] = name;
  }
  let code = standaloneCode.default(ajv, exports).replace(/^"use strict";/, '');
  const helpers: string[] = [];
  if (code.includes(UCS2LENGTH)) {
    code = code.replaceAll(UCS2LENGTH, 'ucs2length');
    helpers.push(ucs2length.default.toString());
  }
  if (code.includes('require(')) {
    throw new Error(`${file}: ajv's code needs a runtime helper this script does not provide`);
  }
  const imports = code.includes('fullFormats')
    ? "import { fullFormats } from 'ajv-formats/dist/formats.js';"
    : '';
  const source = [
    `/* Generated from @adili/schemas/forms/${file}.json by scripts/generate-validators.ts. Do not edit. */`,
    '// @ts-nocheck: ajv standalone code, untyped JavaScript; validate.ts types its validators.',
    imports,
    ...helpers,
    code,
  ].join('\n');
  writeFileSync(
    join(srcDir, `${file}.validate.gen.ts`),
    await format(source, { ...style, parser: 'typescript' }),
  );
}
