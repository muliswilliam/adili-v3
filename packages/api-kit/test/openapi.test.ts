import 'reflect-metadata';

import { Body, Controller, Module, Post } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiJsonBody, scanOpenApiDocument } from '../src/index.js';

const noteBody = z.object({
  text: z.string().trim().min(1).max(2000),
  pinned: z.boolean().default(false),
});

@Controller('v1/notes')
class NotesController {
  @Post()
  @ApiJsonBody(noteBody)
  add(@Body() body: unknown) {
    return body;
  }
}

@Module({ controllers: [NotesController] })
class NotesModule {}

describe('ApiJsonBody', () => {
  it('documents a required body as clients send it, without a JSON Schema dialect', async () => {
    const { paths } = await scanOpenApiDocument(NotesModule, { name: 'test', description: 'test' });

    expect(paths['/v1/notes']?.post?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              text: { type: 'string', minLength: 1, maxLength: 2000 },
              pinned: { type: 'boolean', default: false },
            },
            required: ['text'],
          },
        },
      },
    });
  });
});
