import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

import {
  clarificationCountsRequest,
  clarificationDisclosureRequest,
} from '../../src/clarifications/disclosure.js';

/**
 * review.yaml is still hand-written (the review service does not export its contract), while
 * the disclosure routes validate their bodies with Zod. This holds the two together: the
 * committed request schemas must say what the Zod schemas accept, field for field. Responses are
 * checked against the contract by the integration tests (`contractErrors`).
 */
const contract = parse(
  readFileSync(
    createRequire(import.meta.url).resolve('@adili/schemas/internal/review.yaml'),
    'utf8',
  ),
) as { components: { schemas: Record<string, JsonSchema> } };

interface JsonSchema {
  $ref?: string;
  type?: string;
  format?: string;
  pattern?: string;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  additionalProperties?: unknown;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

function resolve(schema: JsonSchema): JsonSchema {
  const name = schema.$ref?.replace('#/components/schemas/', '');
  return name === undefined ? schema : resolve(contract.components.schemas[name] ?? {});
}

/** What a schema validates, without descriptions or examples, for comparing the two sources. */
function constraints(input: JsonSchema): unknown {
  const schema = resolve(input);
  return {
    type: schema.type,
    format: schema.format,
    // A uuid format carries its own pattern in Zod's output; the format says it.
    pattern: schema.format === undefined ? schema.pattern : undefined,
    enum: schema.enum ? [...schema.enum].map(String).sort() : undefined,
    minLength: schema.minLength,
    maxLength: schema.maxLength,
    minItems: schema.minItems,
    maxItems: schema.maxItems,
    minimum: schema.minimum,
    maximum: schema.maximum,
    closed: schema.additionalProperties === false || undefined,
    required: schema.required ? [...schema.required].sort() : undefined,
    properties: schema.properties
      ? Object.fromEntries(
          Object.entries(schema.properties)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, constraints(value)]),
        )
      : undefined,
    items: schema.items ? constraints(schema.items) : undefined,
  };
}

describe('review.yaml clarification disclosure bodies', () => {
  it.each([
    ['ClarificationDisclosureRequest', clarificationDisclosureRequest],
    ['ClarificationCountsRequest', clarificationCountsRequest],
  ] as const)('%s says what the route accepts', (name, body) => {
    const committed = contract.components.schemas[name];
    expect(committed, `${name} in review.yaml`).toBeDefined();
    expect(constraints(committed ?? {})).toEqual(
      constraints(z.toJSONSchema(body, { io: 'input' }) as JsonSchema),
    );
  });
});
