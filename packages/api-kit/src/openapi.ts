import { applyDecorators, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import {
  ApiQuery,
  ApiResponse,
  DocumentBuilder,
  type OpenAPIObject,
  type ReferenceObject,
  type SchemaObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { z } from 'zod';

import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from './problem-details.filter.js';

/**
 * A service's OpenAPI document (ADR-009): operations come from the controllers' Swagger
 * decorators, named schemas from Zod. Served at `/docs` and exported to
 * `packages/schemas/internal/<service>.yaml`, which is the contract clients are generated from.
 */
export interface OpenApiOptions {
  name: string;
  description: string;
  /**
   * Named schemas (`#/components/schemas/<name>`), in document order. Reference them from
   * decorators with `schemaRef(name)`; a schema used inside another one becomes a `$ref` too.
   * `ProblemDetails` is always included.
   */
  schemas?: Record<string, z.ZodType>;
}

/** RFC 9457 body of every error response (see ProblemDetailsFilter). */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional()
    .meta({ description: 'Field-level errors; `path` is the dotted request field' }),
}) satisfies z.ZodType<ProblemDetails>;

const SCHEMA_PREFIX = '#/components/schemas/';

/**
 * A reference to a named schema, usable wherever the decorators take a schema (also
 * `@ApiParam`, whose type does not admit references although the document does).
 */
export function schemaRef(name: string): ReferenceObject & SchemaObject {
  return { $ref: `${SCHEMA_PREFIX}${name}` };
}

/**
 * Every route needs a bearer token unless it is `@Public()` (JwtAuthGuard is global), so the
 * requirement is declared once for the whole document.
 */
export function createOpenApiDocument(
  app: INestApplication,
  options: OpenApiOptions,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle(`${options.name} API`)
    .setDescription(options.description)
    .setVersion('1')
    .addServer('/', 'The service that serves this document')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  // DocumentBuilder always adds an empty contact.
  delete config.info.contact;
  config.components = {
    ...config.components,
    schemas: toOpenApiSchemas({ ...options.schemas, ProblemDetails: problemDetailsSchema }),
  };
  return SwaggerModule.createDocument(app, config);
}

/**
 * The OpenAPI document of `module` without starting it: preview mode builds the module graph
 * for the Swagger scan but instantiates no providers, so no database or broker is needed.
 * For exporting the contract (packages/schemas/internal/<service>.yaml).
 */
export async function scanOpenApiDocument(
  module: Type,
  options: OpenApiOptions,
): Promise<OpenAPIObject> {
  const app = await NestFactory.create(module, new FastifyAdapter(), {
    preview: true,
    logger: ['error'],
    abortOnError: false,
  });
  try {
    return createOpenApiDocument(app, options);
  } finally {
    await app.close();
  }
}

/** JSON Schemas of named Zod schemas, with references between them as `$ref`s. */
export function toOpenApiSchemas(schemas: Record<string, z.ZodType>): Record<string, SchemaObject> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(schemas)) {
    registry.add(schema, { id });
  }
  const { schemas: converted } = z.toJSONSchema(registry, {
    ...CONVERSION,
    uri: (id) => `${SCHEMA_PREFIX}${id}`,
  });
  return Object.fromEntries(
    Object.entries(converted).map(([id, schema]) => {
      const component = { ...schema };
      delete component.$schema;
      delete component.$id;
      return [id, component as SchemaObject];
    }),
  );
}

/**
 * Documents an error response carrying problem details.
 *
 * @example
 * @ApiProblemResponse(409, 'Tenant key or name already exists')
 */
export const ApiProblemResponse = (status: number, description: string) =>
  ApiResponse({
    status,
    description,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: schemaRef('ProblemDetails') } },
  });

/**
 * Documents every field of a Zod query schema as a query parameter, so the contract states
 * exactly what `ZodValidationPipe` accepts. Field descriptions come from `.meta()`.
 *
 * @example
 * @ApiQueryParameters(listCommissionsQuery)
 * list(@Query(new ZodValidationPipe(listCommissionsQuery)) query: ListCommissionsQuery) {}
 */
export const ApiQueryParameters = (schema: z.ZodObject) => {
  const { properties = {}, required = [] } = z.toJSONSchema(schema, CONVERSION);
  return applyDecorators(
    ...Object.entries(properties).map(([name, property]) => {
      const { description, ...parameterSchema } = property as SchemaObject;
      return ApiQuery({
        name,
        required: required.includes(name),
        ...(description === undefined ? {} : { description }),
        schema: parameterSchema,
      });
    }),
  );
};

/** Maximum and minimum Zod puts on every `.int()`; they say nothing to a client. */
const SAFE_INTEGER_BOUNDS = new Set([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);
/** Formats whose meaning is standard, so Zod's regex for them is noise in a contract. */
const WELL_KNOWN_FORMATS = new Set(['uuid', 'email', 'date-time', 'date']);

const CONVERSION = {
  target: 'draft-2020-12',
  // Requests are documented as clients send them (before transforms and defaults apply).
  // Responses have no transforms; as inputs, their plain objects do not forbid additional
  // properties, so adding a response field stays a compatible change.
  io: 'input',
  override: ({ jsonSchema }) => {
    if (typeof jsonSchema.format === 'string' && WELL_KNOWN_FORMATS.has(jsonSchema.format)) {
      delete jsonSchema.pattern;
    }
    const { maximum, minimum } = jsonSchema;
    if (maximum !== undefined && SAFE_INTEGER_BOUNDS.has(maximum)) delete jsonSchema.maximum;
    if (minimum !== undefined && SAFE_INTEGER_BOUNDS.has(minimum)) delete jsonSchema.minimum;
  },
} satisfies z.core.ToJSONSchemaParams;
