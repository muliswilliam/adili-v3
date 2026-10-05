import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  demoModeSetting,
  demoWindowFor,
  demoWindowSetting,
  demoWindowTenantsSetting,
  isoDurationMs,
  refuseDemoWindowsOutsideDemo,
} from '../src/demo-windows.js';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DEMO_MODE: demoModeSetting,
    DEMO_WINDOW: demoWindowSetting,
  })
  .superRefine((env, ctx) => {
    refuseDemoWindowsOutsideDemo(env, ['DEMO_WINDOW'], ctx);
  });

describe('isoDurationMs', () => {
  it('reads days, hours, minutes and seconds', () => {
    expect(isoDurationMs('PT2M')).toBe(120_000);
    expect(isoDurationMs('P1DT12H')).toBe(36 * 3_600_000);
    expect(isoDurationMs('PT90S')).toBe(90_000);
    expect(isoDurationMs('PT0.5S')).toBe(500);
  });

  it('refuses what is not a positive duration of days to seconds', () => {
    for (const value of ['', 'P', 'PT', 'P1M', 'P1Y', 'PT0S', '2 minutes', '-PT1M', 'P1DT']) {
      expect(isoDurationMs(value)).toBeNull();
    }
  });
});

describe('demo windows', () => {
  it('leaves every window legal when none is set', () => {
    expect(schema.parse({})).toEqual({ NODE_ENV: 'development', DEMO_MODE: false });
  });

  it('shortens a window when the service runs in demo mode', () => {
    expect(schema.parse({ DEMO_MODE: 'true', DEMO_WINDOW: 'PT2M' }).DEMO_WINDOW).toBe(120_000);
  });

  it('refuses a window outside demo mode', () => {
    const result = schema.safeParse({ DEMO_WINDOW: 'PT2M' });
    expect(result.error?.issues[0]?.message).toBe('Set DEMO_MODE=true to use demo windows');
  });

  it('refuses a window in production, even in demo mode', () => {
    const result = schema.safeParse({
      NODE_ENV: 'production',
      DEMO_MODE: 'true',
      DEMO_WINDOW: 'PT2M',
    });
    expect(result.error?.issues[0]?.message).toBe('Demo windows are refused in production');
  });

  it('refuses a malformed window', () => {
    expect(schema.safeParse({ DEMO_MODE: 'true', DEMO_WINDOW: '2m' }).success).toBe(false);
  });
});

describe('demo window tenants', () => {
  it('applies a window to every Commission when no tenants are named', () => {
    expect(demoWindowFor(120_000, undefined, 'psc')).toBe(120_000);
  });

  it('applies it only to the named Commissions', () => {
    const tenants = demoWindowTenantsSetting.parse(' jsc, npsc ,');
    expect(tenants).toEqual(['jsc', 'npsc']);
    expect(demoWindowFor(120_000, tenants, 'jsc')).toBe(120_000);
    expect(demoWindowFor(120_000, tenants, 'psc')).toBeUndefined();
  });

  it('is the legal window when no demo window is set', () => {
    expect(demoWindowFor(undefined, ['jsc'], 'jsc')).toBeUndefined();
  });
});
