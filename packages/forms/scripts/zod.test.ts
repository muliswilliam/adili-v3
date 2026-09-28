import { describe, expect, it } from 'vitest';

import { type JsonSchema, zodModule } from './zod.ts';

const generate = (schema: JsonSchema, names: Record<string, string> = {}) =>
  zodModule(schema, { rootName: 'FormSchema', names });

describe('zodModule', () => {
  it('names each enumeration once and validates with it', () => {
    const source = generate(
      { type: 'object', properties: { kind: { type: 'string', enum: ['a', 'b'] } } },
      { '#/properties/kind': 'KINDS' },
    );

    expect(source).toContain('export const KINDS = ["a","b"] as const;');
    expect(source).toContain('"kind": z.enum(KINDS).optional()');
  });

  it('compiles patterns as Unicode regular expressions, as ajv does', () => {
    const source = generate({ type: 'string', pattern: '^\\p{Lu}/' });

    expect(source).toContain(String.raw`z.string().regex(/^\p{Lu}\//u)`);
  });

  it('escapes a slash in a pattern once, even when it is already escaped', () => {
    const source = generate({ type: 'string', pattern: String.raw`^a/b\/c$` });

    expect(source).toContain(String.raw`z.string().regex(/^a\/b\/c$/u)`);
  });

  it.each(['maxLength', 'minLength'])('refuses a format with %s, which Zod would drop', (bound) => {
    expect(() => generate({ type: 'string', format: 'date', [bound]: 10 })).toThrow(
      `#: a format with ${bound} is not supported`,
    );
  });

  it('makes a type that also allows null nullable', () => {
    const source = generate({ type: ['string', 'null'], format: 'date' });

    expect(source).toContain('export const FormSchema = z.iso.date().nullable();');
  });

  it('refuses a union of types other than one type and null', () => {
    expect(() => generate({ type: ['string', 'integer'] })).toThrow(
      '#: only one type, or one type and null, is supported',
    );
  });

  it('validates email addresses', () => {
    expect(generate({ type: 'string', format: 'email' })).toContain('z.email()');
  });

  const base = {
    type: 'object',
    additionalProperties: false,
    properties: { extra: { type: 'boolean' } },
  };

  it('intersects an allOf, making a loose member strict beside a strict one', () => {
    // Zod rejects a key only if every side of an intersection does; JSON Schema rejects it if
    // any strict member lacks it. With the loose member strict too, both agree.
    const source = generate({
      $defs: { Base: base },
      allOf: [
        { $ref: '#/$defs/Base' },
        { type: 'object', properties: { extra: { type: 'boolean' } } },
      ],
    });

    expect(source.replace(/\s/gu, '')).toContain(
      'exportconstFormSchema=z.intersection(BaseSchema,z.strictObject({"extra":z.boolean().optional(),}));',
    );
  });

  it('refuses a loose allOf member with a property a strict member forbids', () => {
    expect(() =>
      generate({
        $defs: { Base: base },
        allOf: [
          { $ref: '#/$defs/Base' },
          { type: 'object', properties: { other: { type: 'string' } } },
        ],
      }),
    ).toThrow('#/allOf/1: other is forbidden by a strict allOf member');
  });

  it('refuses a count on an optional array, which a refinement cannot read', () => {
    expect(() =>
      generate({
        type: 'object',
        properties: {
          nil: { type: 'boolean' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['nil'],
        if: { properties: { nil: { const: true } } },
        then: { properties: { items: { maxItems: 0 } } },
      }),
    ).toThrow('#/then/properties/items: a count needs items to be required');
  });

  it('refuses a reference to a loose definition beside a strict member, which it cannot tighten', () => {
    expect(() =>
      generate({
        $defs: {
          Strict: { type: 'object', additionalProperties: false, properties: {} },
          Loose: { type: 'object', properties: {} },
        },
        allOf: [{ $ref: '#/$defs/Strict' }, { $ref: '#/$defs/Loose' }],
      }),
    ).toThrow('#/allOf/1: a loose $ref beside a strict allOf member is not supported');
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
    ['a format it does not translate', { type: 'string', format: 'hostname' }, 'format hostname'],
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
