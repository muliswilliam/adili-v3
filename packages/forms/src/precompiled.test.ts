import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import declarationSchema from '@adili/schemas/forms/declaration.v1.json' with { type: 'json' };
import formKSchema from '@adili/schemas/forms/form-k.v1.json' with { type: 'json' };
import formMSchema from '@adili/schemas/forms/form-m.v1.json' with { type: 'json' };
import { type AnySchema, type ErrorObject } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIXED_SECTION_FIELDS, FIXED_SECTION_KEYS } from './declaration-section-fields.js';
import * as declarationValidators from './declaration.v1.validate.gen.js';
import { formK } from './form-k.v1.validate.gen.js';
import { formM } from './form-m.v1.validate.gen.js';
import type { PrecompiledValidator } from './validate.js';

// ajv compiles a schema into a function with `new Function`; the apps' CSP (script-src with a
// nonce and 'strict-dynamic', no 'unsafe-eval') makes that throw in the browser (#686).
function forbidCodeGeneration() {
  // A function, not an arrow, so `new Function(...)` reaches the throw.
  function refuse(): never {
    throw new EvalError('code generation from strings is disallowed (CSP)');
  }
  vi.stubGlobal('Function', refuse);
  vi.stubGlobal('eval', refuse);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the browser entry', () => {
  it('stops ajv compiling while code generation is forbidden', () => {
    const ajv = new Ajv2020();
    forbidCodeGeneration();

    expect(() => ajv.compile({ type: 'string' })).toThrow(/disallowed/);
  });

  it('loads and validates every form without generating code (#686)', async () => {
    vi.resetModules();
    forbidCodeGeneration();

    const forms = await import('./index.js');
    const declaration = { schemaVersion: 'declaration.v1' };

    expect(forms.validateDeclaration(declaration).ok).toBe(false);
    expect(forms.declarationIssues(declaration).issues).not.toHaveLength(0);
    expect(forms.sectionIssues('bio', {})).not.toHaveLength(0);
    expect(forms.sectionIssues('statement:officer', {})).not.toHaveLength(0);
    expect(forms.validateFormK({}).ok).toBe(false);
    expect(forms.formMIssues({}).report).not.toHaveLength(0);
  });
});

// The runtime compile the precompiled validators replace (scripts/generate-validators.ts), with
// the same options, so the services' and apps' problems are what they were.
const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
addFormats.default(ajv);

const what = (errors: ErrorObject[] | null | undefined) =>
  (errors ?? []).map(({ instancePath, keyword, params, message }) => ({
    instancePath,
    keyword,
    params,
    message,
  }));

function expectSameProblems(
  precompiled: PrecompiledValidator,
  schema: AnySchema,
  documents: unknown[],
) {
  const compiled = ajv.compile(schema);
  for (const document of documents) {
    const valid = compiled(document);
    expect(precompiled(document)).toBe(valid);
    expect(what(precompiled.errors as ErrorObject[] | null)).toEqual(what(compiled.errors));
  }
}

const schemasDir = dirname(createRequire(import.meta.url).resolve('@adili/schemas/package.json'));

/** Every fixture document of a form, valid and invalid. */
function documents(form: string): Record<string, unknown>[] {
  return (['valid', 'invalid'] as const).flatMap((kind) => {
    const dir = join(schemasDir, 'forms/fixtures', form, kind);
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const json = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
        return (kind === 'invalid' ? json.document : json) as Record<string, unknown>;
      });
  });
}

describe('the precompiled validators', () => {
  it('report what ajv compiling declaration.v1 reports', () => {
    expectSameProblems(declarationValidators.declaration, declarationSchema, [
      ...documents('declaration.v1'),
      {},
      null,
    ]);
  });

  it('report what ajv compiling each capture section of declaration.v1 reports', () => {
    const { $defs, properties } = declarationSchema;
    const fixtures = documents('declaration.v1');
    const section = (sectionSchema: object) => ({ $defs, ...sectionSchema });
    for (const key of FIXED_SECTION_KEYS) {
      const { fields, keepsFieldName } = FIXED_SECTION_FIELDS[key];
      const schema = keepsFieldName
        ? section({
            type: 'object',
            required: fields,
            additionalProperties: false,
            properties: Object.fromEntries(fields.map((field) => [field, properties[field]])),
          })
        : section(properties[fields[0]]);
      const contents = fixtures.map((document) =>
        keepsFieldName
          ? Object.fromEntries(fields.map((field) => [field, document[field]]))
          : document[fields[0]],
      );
      expectSameProblems(declarationValidators[`${key}Section`], schema, [...contents, {}]);
    }
    const statements = fixtures.flatMap(({ statements }) =>
      Array.isArray(statements) ? (statements as unknown[]) : [],
    );
    expectSameProblems(
      declarationValidators.statementSection,
      section({ $ref: '#/$defs/Statement' }),
      [...statements, {}],
    );
  });

  it('report what ajv compiling form-k.v1 reports', () => {
    expectSameProblems(formK, formKSchema, [{}, { schemaVersion: 'form-k.v1' }]);
  });

  it('report what ajv compiling form-m.v1 reports', () => {
    expectSameProblems(formM, formMSchema, [...documents('form-m.v1'), {}]);
  });
});
