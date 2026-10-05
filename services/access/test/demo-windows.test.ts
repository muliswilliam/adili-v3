import { describe, expect, it } from 'vitest';

import { checkedEnvSchema, config } from '../src/config.js';
import { packageValidUntil } from '../src/grant-documents.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const issuedAt = new Date('2026-10-05T09:00:00Z');

describe('demo package validity (#371)', () => {
  it('is off with the committed defaults: a package is in force for its download window', () => {
    expect(config.DEMO_MODE).toBe(false);
    expect(config.DEMO_PACKAGE_VALIDITY).toBeUndefined();
    expect(packageValidUntil(issuedAt, 14, config.DEMO_PACKAGE_VALIDITY)).toEqual(
      new Date(issuedAt.getTime() + 14 * DAY_MS),
    );
  });

  it('shortens it on a demo stack only', () => {
    const env = { ...process.env, DEMO_PACKAGE_VALIDITY: 'PT2M' };
    expect(checkedEnvSchema.safeParse(env).success).toBe(false);
    const demo = checkedEnvSchema.parse({ ...env, DEMO_MODE: 'true' });
    expect(packageValidUntil(issuedAt, 14, demo.DEMO_PACKAGE_VALIDITY)).toEqual(
      new Date(issuedAt.getTime() + 120_000),
    );
  });
});
