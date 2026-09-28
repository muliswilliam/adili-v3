// Emits Zod 4 source for a prescribed form's JSON Schema: named constants for its enumerations,
// one exported schema per $defs entry and one for the root. It covers the subset the forms use
// and throws on anything else, so a schema change it cannot express fails the generate step
// instead of producing a validator that is quietly looser than the JSON Schema.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** A JSON Schema, or any schema object inside one. */
export type JsonSchema = Record<string, Json>;

export interface ZodModuleOptions {
  /** Name of the root schema, e.g. `DeclarationSchema`. */
  rootName: string;
  /** Exported constant names for every `enum` (required) and any `const` (optional), by JSON pointer. */
  names: Record<string, string>;
}

const KNOWN = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'enum',
  'const',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'if',
  'then',
  'else',
  'allOf',
]);

const FORMATS: Record<string, string> = {
  date: 'z.iso.date()',
  'date-time': 'z.iso.datetime({ offset: true })',
  // Ajv's uuid format accepts any version, as z.guid() does; z.uuid() would insist on RFC 9562.
  uuid: 'z.guid()',
  // Ajv-formats and Zod check email with different expressions that disagree on rare edge cases;
  // submission validates with Ajv.
  email: 'z.email()',
};

export function zodModule(schema: JsonSchema, { rootName, names }: ZodModuleOptions): string {
  const used = new Set<string>();
  const constants: string[] = [];
  const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>;

  function name(pointer: string, kind: 'enum' | 'const'): string | undefined {
    const found = names[pointer];
    if (found) used.add(pointer);
    else if (kind === 'enum') throw new Error(`${pointer}: name this enum in the generator`);
    return found;
  }

  function expression(node: JsonSchema, pointer: string): string {
    const unknown = Object.keys(node).filter((key) => !KNOWN.has(key));
    if (unknown.length > 0) throw new Error(`${pointer}: unsupported ${unknown.join(', ')}`);

    // `type: [T, "null"]`: the schema for T, also accepting null.
    if (Array.isArray(node.type)) {
      const [only, ...more] = node.type.filter((type) => type !== 'null');
      if (more.length > 0 || only === undefined || node.type.length !== 2) {
        throw new Error(`${pointer}: only one type, or one type and null, is supported`);
      }
      return `${expression({ ...node, type: only }, pointer)}.nullable()`;
    }

    const members = allOfMembers(node, pointer);
    const ownSchema = ['type', '$ref', 'enum', 'const'].some((key) => node[key] !== undefined);
    const [first, ...rest] = ownSchema ? [baseExpression(node, pointer), ...members] : members;
    if (first === undefined) throw new Error(`${pointer}: no type, $ref, enum, const or allOf`);
    const base = rest.reduce((all, member) => `z.intersection(${all}, ${member})`, first);

    const checks = conditionals(node, pointer);
    return checks.length === 0
      ? base
      : `${base}.superRefine((value, ctx) => {\n${checks.join('\n')}\n})`;
  }

  /**
   * The Zod source of an allOf's members other than if/then/else, which all apply and are
   * intersected. Zod rejects an unknown key only when every side of an intersection does, JSON
   * Schema when any strict member does; so beside a strict member a loose one is made strict,
   * which is the same only while its properties are ones the strict members allow.
   */
  function allOfMembers(node: JsonSchema, pointer: string): string[] {
    const intersected = ((node.allOf ?? []) as JsonSchema[])
      .map((member, index) => [member, `${pointer}/allOf/${String(index)}`] as const)
      .filter(([member]) => member.if === undefined);
    const strictMembers = intersected.map(([member]) => resolve(member)).filter(isStrictObject);
    return intersected.map(([member, at]) => {
      const loose = member.type === 'object' && member.additionalProperties === undefined;
      const resolved = resolve(member);
      // A referenced definition is emitted once, as it is; it cannot be made strict here.
      if (
        strictMembers.length > 0 &&
        member !== resolved &&
        resolved.type === 'object' &&
        resolved.additionalProperties === undefined
      ) {
        throw new Error(`${at}: a loose $ref beside a strict allOf member is not supported`);
      }
      if (strictMembers.length === 0 || !loose) return expression(member, at);
      for (const key of Object.keys((member.properties ?? {}) as JsonSchema)) {
        if (strictMembers.some((strict) => !(key in ((strict.properties ?? {}) as JsonSchema)))) {
          throw new Error(`${at}: ${key} is forbidden by a strict allOf member`);
        }
      }
      return expression({ ...member, additionalProperties: false }, at);
    });
  }

  /** A member as written, or the $defs entry it refers to. */
  function resolve(member: JsonSchema): JsonSchema {
    const name = typeof member.$ref === 'string' ? member.$ref.replace('#/$defs/', '') : undefined;
    return (name === undefined ? undefined : defs[name]) ?? member;
  }

  function baseExpression(node: JsonSchema, pointer: string): string {
    if (typeof node.$ref === 'string') {
      const match = /^#\/\$defs\/(\w+)$/.exec(node.$ref);
      if (!match?.[1] || !(match[1] in defs)) throw new Error(`${pointer}: unknown ${node.$ref}`);
      return `${match[1]}Schema`;
    }
    if (Array.isArray(node.enum)) {
      const constName = name(pointer, 'enum');
      constants.push(`export const ${constName} = ${JSON.stringify(node.enum)} as const;`);
      return `z.enum(${constName})`;
    }
    if (node.const !== undefined) {
      const constName = name(pointer, 'const');
      if (!constName) return `z.literal(${JSON.stringify(node.const)})`;
      constants.push(`export const ${constName} = ${JSON.stringify(node.const)};`);
      return `z.literal(${constName})`;
    }
    switch (node.type) {
      case 'object':
        return objectExpression(node, pointer);
      case 'array': {
        if (typeof node.items !== 'object' || Array.isArray(node.items) || node.items === null) {
          throw new Error(`${pointer}: an array needs one items schema`);
        }
        return `z.array(${expression(node.items, `${pointer}/items`)})${bounds(node, 'minItems', 'maxItems')}`;
      }
      case 'string':
        return stringExpression(node, pointer);
      case 'integer':
      case 'number': {
        let source = node.type === 'integer' ? 'z.int()' : 'z.number()';
        if (typeof node.minimum === 'number') source += `.min(${node.minimum})`;
        if (typeof node.exclusiveMinimum === 'number') source += `.gt(${node.exclusiveMinimum})`;
        if (typeof node.maximum === 'number') source += `.max(${node.maximum})`;
        return source;
      }
      case 'boolean':
        return 'z.boolean()';
      default:
        throw new Error(`${pointer}: unsupported type ${JSON.stringify(node.type)}`);
    }
  }

  function objectExpression(node: JsonSchema, pointer: string): string {
    const properties = (node.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((node.required ?? []) as string[]);
    const fields = Object.entries(properties).map(([key, property]) => {
      const source = expression(property, `${pointer}/properties/${key}`);
      return `${JSON.stringify(key)}: ${required.has(key) ? source : `${source}.optional()`},`;
    });
    if (node.additionalProperties === false) return `z.strictObject({\n${fields.join('\n')}\n})`;
    if (node.additionalProperties === undefined) return `z.looseObject({\n${fields.join('\n')}\n})`;
    throw new Error(`${pointer}: additionalProperties must be false or absent`);
  }

  function stringExpression(node: JsonSchema, pointer: string): string {
    if (typeof node.format === 'string') {
      const source = FORMATS[node.format];
      if (!source) throw new Error(`${pointer}: unsupported format ${node.format}`);
      // A format schema (z.iso.date() and the like) takes no further bounds; refuse rather than drop them.
      for (const bound of ['pattern', 'minLength', 'maxLength']) {
        if (node[bound] !== undefined) {
          throw new Error(`${pointer}: a format with ${bound} is not supported`);
        }
      }
      return source;
    }
    let source = `z.string()${bounds(node, 'minLength', 'maxLength')}`;
    if (typeof node.pattern === 'string') {
      // Ajv compiles patterns with the u flag (unicodeRegExp), so Zod must too or they can differ.
      // Escape only the slashes a regex literal would end on; an escaped one stays as it is.
      source += `.regex(/${node.pattern.replace(/(?<!\\)\//gu, '\\/')}/u)`;
    }
    return source;
  }

  // `if: { properties: { flag: { const } } }` with `then`/`else` of `required` or item counts, as
  // the forms use them for flagged changes, joint shares and nil categories. As in JSON Schema,
  // the condition also holds when the flag is absent.
  function conditionals(node: JsonSchema, pointer: string): string[] {
    const branches: [JsonSchema, string][] = [];
    if (node.if !== undefined) branches.push([node, pointer]);
    for (const [index, entry] of ((node.allOf ?? []) as JsonSchema[]).entries()) {
      // Members without `if` are intersected in expression().
      if (entry.if === undefined) continue;
      const extra = Object.keys(entry).filter((key) => !['if', 'then', 'else'].includes(key));
      if (extra.length > 0) {
        throw new Error(
          `${pointer}/allOf/${String(index)}: a condition in allOf must be only if/then/else`,
        );
      }
      branches.push([entry, `${pointer}/allOf/${String(index)}`]);
    }
    // A required field is always there by the time a refinement runs.
    const required = new Set((node.required ?? []) as string[]);
    return branches.map(([branch, at]) => {
      const condition = conditionSource(branch.if as JsonSchema, required, `${at}/if`);
      const then = assertions(branch.then as JsonSchema | undefined, required, `${at}/then`);
      const otherwise = assertions(branch.else as JsonSchema | undefined, required, `${at}/else`);
      return otherwise
        ? `if (${condition}) {\n${then}\n} else {\n${otherwise}\n}`
        : `if (${condition}) {\n${then}\n}`;
    });
  }

  function conditionSource(condition: JsonSchema, required: Set<string>, pointer: string): string {
    const entries = Object.entries((condition.properties ?? {}) as Record<string, JsonSchema>);
    const [only] = entries;
    if (Object.keys(condition).join() !== 'properties' || entries.length !== 1 || !only) {
      throw new Error(`${pointer}: only a single { properties: { key: { const } } } is supported`);
    }
    const [key, test] = only;
    if (Object.keys(test).join() !== 'const')
      throw new Error(`${pointer}: only const is supported`);
    const equals = `value.${key} === ${JSON.stringify(test.const)}`;
    return required.has(key) ? equals : `value.${key} === undefined || ${equals}`;
  }

  function assertions(
    branch: JsonSchema | undefined,
    required: Set<string>,
    pointer: string,
  ): string {
    if (branch === undefined) return '';
    const lines: string[] = [];
    for (const [key, value] of Object.entries(branch)) {
      if (key === 'required') {
        for (const field of (value as string[]).filter((field) => !required.has(field))) {
          lines.push(
            `if (value.${field} === undefined) ctx.addIssue({ code: 'custom', path: [${JSON.stringify(field)}], message: 'is required' });`,
          );
        }
      } else if (key === 'properties') {
        for (const [field, rule] of Object.entries(value as Record<string, JsonSchema>)) {
          const at = `${pointer}/properties/${field}`;
          // The refinement reads `value.<field>.length`, which needs the array to be there.
          if (!required.has(field)) throw new Error(`${at}: a count needs ${field} to be required`);
          lines.push(...countAssertions(field, rule, at));
        }
      } else {
        throw new Error(`${pointer}: unsupported ${key}`);
      }
    }
    return lines.join('\n');
  }

  function countAssertions(field: string, rule: JsonSchema, pointer: string): string[] {
    return Object.entries(rule).map(([key, limit]) => {
      if (key === 'minItems' && typeof limit === 'number') {
        return `if (value.${field}.length < ${limit}) ctx.addIssue({ code: 'custom', path: [${JSON.stringify(field)}], message: 'must NOT have fewer than ${limit} items' });`;
      }
      if (key === 'maxItems' && typeof limit === 'number') {
        return `if (value.${field}.length > ${limit}) ctx.addIssue({ code: 'custom', path: [${JSON.stringify(field)}], message: 'must NOT have more than ${limit} items' });`;
      }
      throw new Error(`${pointer}: unsupported ${key}`);
    });
  }

  // $defs refer to each other, so emit each after the ones it uses.
  const emitted = new Map<string, string>();
  const visiting = new Set<string>();
  function emitDef(defName: string): void {
    if (emitted.has(defName)) return;
    if (visiting.has(defName))
      throw new Error(`#/$defs/${defName}: recursive $defs are not supported`);
    const def = defs[defName];
    if (!def) throw new Error(`#/$defs/${defName} does not exist`);
    visiting.add(defName);
    for (const dependency of refsIn(def)) emitDef(dependency);
    emitted.set(
      defName,
      `${docComment(def)}export const ${defName}Schema = ${expression(def, `#/$defs/${defName}`)};`,
    );
    visiting.delete(defName);
  }
  for (const defName of Object.keys(defs)) emitDef(defName);

  const root = { ...schema };
  delete root.$defs;
  const rootSource = `${docComment(root)}export const ${rootName} = ${expression(root, '#')};`;

  const unused = Object.keys(names).filter((pointer) => !used.has(pointer));
  if (unused.length > 0) throw new Error(`no enum or const at ${unused.join(', ')}`);

  return ["import { z } from 'zod';", ...constants, ...emitted.values(), rootSource].join('\n\n');
}

function refsIn(node: Json): string[] {
  if (Array.isArray(node)) return node.flatMap(refsIn);
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === '$ref' && typeof value === 'string' ? [value.replace('#/$defs/', '')] : refsIn(value),
  );
}

function docComment(node: JsonSchema): string {
  return typeof node.description === 'string' ? `/** ${node.description} */\n` : '';
}

function bounds(node: JsonSchema, min: string, max: string): string {
  let source = '';
  if (typeof node[min] === 'number') source += `.min(${node[min]})`;
  if (typeof node[max] === 'number') source += `.max(${node[max]})`;
  return source;
}

function isStrictObject(node: JsonSchema): boolean {
  return node.type === 'object' && node.additionalProperties === false;
}
