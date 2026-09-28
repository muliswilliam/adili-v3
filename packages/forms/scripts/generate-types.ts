#!/usr/bin/env node
// Writes src/<form>.gen.ts, the TypeScript types of each prescribed form, from its JSON Schema in
// @adili/schemas, and src/<form>.zod.gen.ts, its enumerations and Zod schemas, for the forms that
// are edited capture section by capture section. Build runs it (and turbo runs build before
// typecheck, lint and test, so they never read a half-written file); CI fails when the committed
// copy is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';
import { format, resolveConfig } from 'prettier';

import { zodModule, type ZodModuleOptions } from './zod.ts';

interface Form {
  file: string;
  typeName: string;
  zod?: ZodModuleOptions;
}

const FORMS: Form[] = [
  {
    file: 'declaration.v1',
    typeName: 'DeclarationV1',
    zod: {
      rootName: 'DeclarationSchema',
      names: {
        '#/properties/type': 'DECLARATION_TYPES',
        '#/properties/incomePeriod/properties/fromSource': 'INCOME_PERIOD_SOURCES',
        '#/properties/officer/properties/maritalStatus': 'MARITAL_STATUSES',
        '#/properties/officer/properties/employment/properties/nature': 'EMPLOYMENT_NATURES',
        '#/properties/attestation/properties/text': 'ATTESTATION_TEXT',
        '#/$defs/ChangeFlag/properties/kind': 'CHANGE_KINDS',
        '#/$defs/ItemSource/properties/kind': 'ITEM_SOURCE_KINDS',
        '#/$defs/Spouse/properties/occupationSector': 'OCCUPATION_SECTORS',
        '#/$defs/IncomeItem/properties/type': 'INCOME_TYPES',
        '#/$defs/AssetItem/properties/type': 'ASSET_TYPES',
        '#/$defs/LiabilityItem/properties/type': 'LIABILITY_TYPES',
        '#/$defs/MaterialChangeEntry/properties/kind': 'MATERIAL_CHANGE_KINDS',
        '#/$defs/RegistrableInterests/properties/memberships/items/properties/kind':
          'MEMBERSHIP_KINDS',
      },
    },
  },
  { file: 'form-k.v1', typeName: 'FormKV1' },
];

const require = createRequire(import.meta.url);
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
// The repo's Prettier config, so generated files read like the code around them.
const style = (await resolveConfig(join(srcDir, 'index.ts'))) ?? {};

for (const { file, typeName, zod } of FORMS) {
  const schema = JSON.parse(
    readFileSync(require.resolve(`@adili/schemas/forms/${file}.json`), 'utf8'),
  ) as JSONSchema;
  const banner = (generator: string) =>
    `/* Generated from @adili/schemas/forms/${file}.json by scripts/${generator}. Do not edit. */`;

  // The schema's title is prose, not an identifier; name the root type here instead.
  const source = await compile({ ...schema, title: typeName }, typeName, {
    bannerComment: banner('generate-types.ts'),
    additionalProperties: false,
    // Array lengths are the validator's job; tuple types would make partial form state awkward.
    ignoreMinAndMaxItems: true,
    format: true,
    style,
  });
  writeFileSync(join(srcDir, `${file}.gen.ts`), source);

  if (zod) {
    const module = zodModule(schema, zod);
    writeFileSync(
      join(srcDir, `${file}.zod.gen.ts`),
      await format(`${banner('zod.ts')}\n\n${module}\n`, { ...style, parser: 'typescript' }),
    );
  }
}
