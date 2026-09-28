#!/usr/bin/env node
// Writes src/<form>.gen.ts, the TypeScript types of each prescribed form, from its JSON Schema in
// @adili/schemas. Build runs it (and turbo runs build before typecheck, lint and test, so they
// never read a half-written file); CI fails when the committed copy is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

const FORMS = [{ file: 'form-k.v1', typeName: 'FormKV1' }];

const require = createRequire(import.meta.url);
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

for (const { file, typeName } of FORMS) {
  const schema = JSON.parse(
    readFileSync(require.resolve(`@adili/schemas/forms/${file}.json`), 'utf8'),
  ) as JSONSchema;
  // The schema's title is prose, not an identifier; name the root type here instead.
  const source = await compile({ ...schema, title: typeName }, typeName, {
    bannerComment: `/* Generated from @adili/schemas/forms/${file}.json by scripts/generate-types.ts. Do not edit. */`,
    additionalProperties: false,
    // Array lengths are the validator's job; tuple types would make partial form state awkward.
    ignoreMinAndMaxItems: true,
    format: true,
    style: { singleQuote: true, printWidth: 100 },
  });
  writeFileSync(join(srcDir, `${file}.gen.ts`), source);
}
