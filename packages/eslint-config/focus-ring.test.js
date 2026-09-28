import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';

import { focusRingPlugin, focusRingProblems } from './focus-ring.js';

// A copy of `focusRing` in packages/ui/src/lib/focus.ts, which this package cannot import; the
// first test fails if the two drift apart.
const focusRing =
  'outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring';

it('uses the same focusRing as @adili/ui', () => {
  const source = readFileSync(new URL('../ui/src/lib/focus.ts', import.meta.url), 'utf8');
  assert.ok(source.includes(`'${focusRing}'`), 'update focusRing here to match focus.ts');
});

describe('focusRingProblems', () => {
  it('flags hand-written rings that use outline-none', () => {
    for (const text of [
      // Solid, so they draw, but they skip focusRing and its forced-colours fallback.
      'relative z-10 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring',
      'rounded-sm outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring',
      // Box-shadow rings.
      'inline-flex rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
      '-mx-1 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
      // Rings on a pseudo-element.
      'underline-offset-4 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset',
    ]) {
      assert.equal(focusRingProblems(text).length, 1, text);
    }
  });

  it('flags an outline width on focus without outline-solid under the same variants', () => {
    assert.equal(focusRingProblems('outline-hidden focus-visible:outline-2').length, 1);
    assert.equal(
      focusRingProblems(
        'rounded-sm outline-hidden after:absolute focus-visible:after:outline-2 focus-visible:outline-solid focus-visible:after:outline-ring',
      ).length,
      1,
    );
    // Both problems at once.
    assert.equal(
      focusRingProblems(
        'rounded-sm outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring',
      ).length,
      2,
    );
  });

  it('accepts focusRing, rings drawn another way and plain outline-none', () => {
    for (const text of [
      focusRing,
      `${focusRing} focus-visible:-outline-offset-2`,
      'rounded-sm outline-hidden after:absolute focus-visible:after:outline-2 focus-visible:after:outline-solid focus-visible:after:outline-ring',
      'underline-offset-4 outline-hidden after:absolute focus-visible:after:ring-2 focus-visible:after:ring-inset',
      'rounded-lg shadow-control outline-none focus-visible:shadow-control-focus',
      'outline-none empty:hidden',
      'rounded-lg has-focus-visible:outline-3 has-focus-visible:outline-ring/15',
      'focus-visible:outline-2',
    ]) {
      assert.deepEqual(focusRingProblems(text), [], text);
    }
  });
});

describe('adili/focus-ring', () => {
  it('reports string and template literals', () => {
    new RuleTester().run('focus-ring', focusRingPlugin.rules['focus-ring'], {
      valid: [`const a = '${focusRing}';`, 'const b = `outline-none ${x}`;'],
      invalid: [
        { code: `const a = 'outline-none focus-visible:ring-2';`, errors: 1 },
        { code: 'const b = `outline-hidden focus-visible:outline-2 ${x}`;', errors: 1 },
      ],
    });
  });
});
