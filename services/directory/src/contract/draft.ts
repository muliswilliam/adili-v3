import type { OpenAPIObject } from '@nestjs/swagger';

type Components = NonNullable<OpenAPIObject['components']>;

/**
 * Operations and components drafted for specs not implemented yet (a partial OpenAPI document).
 * They may reference the implemented components, e.g. `#/components/schemas/Commission`.
 */
export interface Draft {
  paths?: OpenAPIObject['paths'];
  components?: Pick<Components, 'schemas' | 'parameters' | 'responses'>;
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/**
 * The implemented document plus the draft, with every drafted operation marked `x-draft: true`.
 * A draft that names an implemented operation or component is an error: once something is
 * implemented, its draft must be deleted so that the code alone defines it.
 */
export function withDraft(implemented: OpenAPIObject, draft: Draft): OpenAPIObject {
  const conflicts: string[] = [];
  const paths = { ...implemented.paths };
  for (const [path, draftItem] of Object.entries(draft.paths ?? {})) {
    const implementedItem = paths[path];
    const item: Record<string, unknown> = { ...implementedItem };
    for (const [key, value] of Object.entries(draftItem)) {
      if (implementedItem && key in implementedItem) {
        conflicts.push(`paths.${path}.${key}`);
      } else if (implementedItem && !HTTP_METHODS.has(key)) {
        // Path-level fields would change the implemented operations too.
        conflicts.push(`paths.${path}.${key} (move it into the drafted operations)`);
      } else {
        item[key] = HTTP_METHODS.has(key) ? { ...value, 'x-draft': true } : value;
      }
    }
    paths[path] = item;
  }

  const components: Components = { ...implemented.components };
  for (const section of ['schemas', 'parameters', 'responses'] as const) {
    const drafted = draft.components?.[section];
    if (!drafted) continue;
    const merged: Record<string, unknown> = { ...components[section] };
    for (const [name, value] of Object.entries(drafted)) {
      if (name in merged) conflicts.push(`components.${section}.${name}`);
      merged[name] = value;
    }
    components[section] = merged as never;
  }

  if (conflicts.length > 0) {
    throw new Error(
      `The draft redefines what the service implements; delete these from the draft:\n  ${conflicts.join('\n  ')}`,
    );
  }
  return { ...implemented, paths, components };
}
