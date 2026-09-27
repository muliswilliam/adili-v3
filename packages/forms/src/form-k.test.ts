import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type FormKV1, validateFormK } from './index.js';

const require = createRequire(import.meta.url);
const fixturesDir = join(
  dirname(require.resolve('@adili/schemas/package.json')),
  'forms/fixtures/form-k.v1',
);

function fixtures(kind: 'valid' | 'invalid') {
  const dir = join(fixturesDir, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown] as const);
}

interface InvalidFixture {
  errors: string[];
  document: Record<string, unknown>;
}

const complete = fixtures('valid').find(([name]) => name === 'complete.json')?.[1] as FormKV1;

describe('validateFormK', () => {
  it.each(fixtures('valid'))('accepts %s', (_name, document) => {
    const result = validateFormK(document);

    expect(result).toEqual({ ok: true, value: document });
  });

  it.each(fixtures('invalid'))('rejects %s with the expected paths', (_name, fixture) => {
    const { errors, document } = fixture as InvalidFixture;

    const result = validateFormK(document);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((error) => error.path)).toEqual(errors);
  });

  it('names the missing reason in the message', () => {
    const document = structuredClone(complete);
    delete (document.partIII as Partial<FormKV1['partIII']>).reason;

    expect(validateFormK(document)).toEqual({
      ok: false,
      errors: [{ path: 'partIII.reason', message: 'is required' }],
    });
  });

  it('points at the offending field and array item', () => {
    const document = structuredClone(complete);
    document.partI.telephone = '0712345678';
    document.scope.years = [2026, 2019];
    document.scope.sections = [];

    const result = validateFormK(document);

    expect(result.ok ? [] : result.errors).toEqual([
      { path: 'partI.telephone', message: 'must match pattern "^\\+[1-9][0-9]{6,14}$"' },
      { path: 'scope.years.1', message: 'must be >= 2025' },
      { path: 'scope.sections', message: 'must NOT have fewer than 1 items' },
    ]);
  });

  it('names a property the form does not have', () => {
    const document = structuredClone(complete);
    Object.assign(document.partII, { nickname: 'Annie' });

    const result = validateFormK(document);

    expect(result.ok ? [] : result.errors).toEqual([
      { path: 'partII.nickname', message: 'is not allowed' },
    ]);
  });

  it('checks formats', () => {
    const document = structuredClone(complete);
    document.partI.email = 'not-an-email';
    document.partIV.declaredAt = 'yesterday';

    const result = validateFormK(document);

    expect(result.ok ? [] : result.errors.map((error) => error.path)).toEqual([
      'partI.email',
      'partIV.declaredAt',
    ]);
  });

  it('rejects a document that is not an object at the root', () => {
    expect(validateFormK('form-k')).toEqual({
      ok: false,
      errors: [{ path: '', message: 'must be object' }],
    });
  });
});
