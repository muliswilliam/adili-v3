import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

describe('AppModule', () => {
  it('resolves its dependency graph', async () => {
    // Connections are lazy, so this runs without infrastructure.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
    await moduleRef.close();
  });
});
