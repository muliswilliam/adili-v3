import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body, query or param against a Zod schema.
 * Failures surface as RFC 9457 validation problems via ProblemDetailsFilter.
 *
 * @example
 * create(@Body(new ZodValidationPipe(createTenantSchema)) body: CreateTenant) {}
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    return this.schema.parse(value);
  }
}
