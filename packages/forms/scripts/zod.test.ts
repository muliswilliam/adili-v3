import { describe, expect, it } from 'vitest';

import { zodModule } from './zod.ts';

const generate = (schema: Record<string, unknown>, names: Record<string, string> = {}) =>
  zodModule(schema as Parameters<typeof zodModule>[0], { rootName: 'FormSchema', names });

describe('zodModule', () => {
  it('names each enumeration once and validates with it', () => {
    const source = generate(
      { type: 'object', properties: { kind: { type: 'string', enum: ['a', 'b'] } } },
      { '#/properties/kind': 'KINDS' },
    );

    expect(source).toContain('export const KINDS = ["a","b"] as const;');
    expect(source).toContain('"kind": z.enum(KINDS).optional()');
  });

  it('refuses an enumeration it has no name for', () => {
    expect(() =>
      generate({ type: 'object', properties: { kind: { type: 'string', enum: ['a'] } } }),
    ).toThrow('#/properties/kind: name this enum in the generator');
  });

  it('refuses a name that points at nothing', () => {
    expect(() => generate({ type: 'boolean' }, { '#/properties/gone': 'GONE' })).toThrow(
      'no enum or const at #/properties/gone',
    );
  });

  it.each([
    ['a keyword it does not translate', { type: 'string', oneOf: [] }, 'unsupported oneOf'],
    ['a format it does not translate', { type: 'string', format: 'email' }, 'format email'],
    [
      'a condition other than one constant',
      { type: 'object', if: { required: ['x'] }, then: {} },
      'only a single { properties: { key: { const } } } is supported',
    ],
    [
      'open-ended additional properties',
      { type: 'object', additionalProperties: { type: 'string' } },
      'additionalProperties must be false or absent',
    ],
  ])('refuses %s rather than validate less than the schema', (_name, schema, message) => {
    expect(() => generate(schema)).toThrow(message);
  });
});
