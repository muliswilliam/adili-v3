import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { type BudgetChunk, overBudget, pageSizes } from './bundle-budget';

const chunk = (fileName: string, bytes: number, rest: Partial<BudgetChunk> = {}): BudgetChunk => ({
  fileName,
  isEntry: false,
  facadeModuleId: null,
  imports: [],
  code: randomBytes(bytes).toString('hex'),
  ...rest,
});

describe('pageSizes', () => {
  const chunks = [
    chunk('index.js', 4000, { isEntry: true, imports: ['shared.js'] }),
    chunk('shared.js', 2000),
    chunk('result.js', 3000, {
      facadeModuleId: '/app/src/routes/v.$verificationId.tsx?tsr-split=component',
      imports: ['shared.js', 'details.js'],
    }),
    chunk('details.js', 1000),
    // Loaded on demand (a dynamic import), so no page pays for it up front.
    chunk('popover.js', 5000, { facadeModuleId: '/app/src/popover.tsx' }),
    chunk('about.js', 500, { facadeModuleId: '/app/src/routes/about.tsx?tsr-split=component' }),
  ];

  it('counts the entry and each route with what it imports statically, once each', () => {
    const sizes = pageSizes(chunks);

    const gzipped = (...fileNames: string[]) =>
      fileNames
        .map((fileName) => gzipSync(chunks.find((c) => c.fileName === fileName)?.code ?? '').length)
        .reduce((sum, bytes) => sum + bytes, 0);
    expect([...sizes.keys()].sort()).toEqual(['about', 'v.$verificationId']);
    expect(sizes.get('v.$verificationId')).toBe(
      gzipped('index.js', 'shared.js', 'result.js', 'details.js'),
    );
    expect(sizes.get('about')).toBe(gzipped('index.js', 'shared.js', 'about.js'));
  });

  it('names the pages over their budget', () => {
    const sizes = new Map([
      ['index', 90_000],
      ['v.$verificationId', 120_000],
    ]);

    expect(overBudget(sizes, 100_000)).toEqual([['v.$verificationId', 120_000]]);
  });
});
